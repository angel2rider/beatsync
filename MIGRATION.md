# Beatsync Migration Documentation

---

## Oracle Object Storage Migration

**Date:** 2026-05  \
**Reason:** Replace Cloudflare R2 with Oracle Object Storage for lower latency in the India/APAC region and simpler public access configuration.  \
**Result:** Lower latency for audio delivery, simpler public URL scheme, mandatory Content-MD5 for batch delete (worked around with individual deletes).

### Architecture Changes

**Before (Cloudflare R2):**
```
Client → Server (get presigned URL) → R2 API
Client → R2 (direct upload via presigned URL)
Client → Server (upload confirmation)
Client ← R2 Public CDN (direct audio access)
```

**After (Oracle Object Storage):**
```
Client → Server (stream/download from Tidal CDN) → Server saves to Oracle
Client ← Server (broadcast Oracle public URL)
Client ← Oracle CDN (direct audio access)
```

**Key differences from R2:**
- Server-side audio download (from Tidal CDN) then server-side upload to Oracle (no presigned URL client flow)
- Flat `audio/{id}.mp3` key structure (no room prefix, no timestamps)
- Public URLs are deterministic `objectstorage.{region}.oraclecloud.com` URLs
- Batch delete uses individual `DeleteObjectCommand` calls (Oracle requires Content-MD5 for `DeleteObjects`)

### Key Files Added/Modified

- **`apps/server/src/lib/objectStorage.ts`** (new) — S3-compatible client for Oracle Object Storage
- **`apps/server/src/lib/localStorage.ts`** — Added conditional Oracle logic (`isOracleConfigured()`), `generateUploadFileName()`, Oracle-aware `deleteRoomDirectory()`
- **`apps/server/src/routes/upload.ts`** — Uses clean UUID-based names for direct uploads
- **`apps/server/src/websocket/handlers/handleStreamMusic.ts`** — Uses `audio/{trackId}.mp3` naming, includes `name` field for UI display
- **`apps/server/src/managers/RoomManager.ts`** — Passes audio source URLs for proper Oracle object cleanup

### Configuration

```bash
# Required for Oracle storage (if not set, local filesystem is used)
OCI_ACCESS_KEY=your_access_key
OCI_SECRET_KEY=your_secret_key
OCI_BUCKET=your_bucket_name
OCI_NAMESPACE=your_object_storage_namespace
OCI_REGION=ap-hyderabad-1
```

### Bucket Structure

```
Kalam/
├── audio/186443937.mp3        # Streamed track (trackId-based)
├── audio/a1b2c3d4-e5f6.mp3    # Uploaded track (UUID-based)
└── ... (flat key structure, no room prefixes)
```

### Audio Source `name` Field

Added an optional `name` field to `AudioSourceSchema` to fix a UI issue where clean Oracle filenames (`audio/186443937.mp3`) couldn't be parsed back into human-readable display names.

- Streamed tracks: `name` set to the original track title from the music provider
- Uploaded tracks: `name` set to the original filename (minus extension)
- UI uses `source.name` with fallback to URL-derived extraction for backward compatibility

### Dependencies Added

- `@aws-sdk/client-s3@^3.828.0` — AWS SDK v3 (Oracle S3-compatible API)

### Cleanup

Old `room-{roomId}/` prefixed objects from the previous R2 naming scheme are cleaned up by:
1. Trying `extractKeyFromPublicUrl()` to parse Oracle URLs from audio source data
2. Falling back to `deleteObjectsWithPrefix("room-{roomId}/")` for legacy objects

### Rollback (if needed)

1. Remove `OCI_*` env vars → server falls back to local filesystem automatically
2. No code changes needed — `isOracleConfigured()` gates all Oracle logic

---

## Cloudflare R2 Migration (Historical)

**Date:** 2025-06-15  \
**Reason:** Reduce server bandwidth costs on Render by moving audio storage to Cloudflare R2  \
**Status:** Superseded by Oracle Object Storage

### Architecture Changes (R2)

**Before (Filesystem Storage):**
```
Client → Server (multipart/form-data) → Local filesystem (/uploads/audio/)
Client ← Server (direct file serving) ← Local filesystem
```

**After (Cloudflare R2):**
```
Client → Server (get presigned URL) → R2 API
Client → R2 (direct upload via presigned URL)
Client → Server (upload confirmation)
Client ← R2 Public CDN (direct audio access)
```

### Implementation Details (R2)

**New Server Endpoints:**
- `POST /api/upload-url` — Generate presigned upload URLs
- `POST /api/upload-complete` — Confirm successful uploads
- `POST /audio` — Now redirects to R2 public URLs (was direct file serving)
- `POST /upload` — Deprecated with helpful error message

**Configuration Requirements (R2):**
```bash
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_R2_ACCESS_KEY_ID=your_r2_access_key_id
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
CLOUDFLARE_R2_BUCKET_NAME=beatsync-audio
```

**R2 Bucket Structure:**
```
beatsync-audio/
├── room-000000/
│   └── 1749916933051.mp3
└── room-232344/
    └── 1745553666739.mp3
```

### Cost Analysis (R2 vs Filesystem)

**Before (Server Bandwidth):**
- **Upload:** 5MB file = 5MB server bandwidth
- **Distribution:** 5MB × 9 users = 45MB server bandwidth
- **Total per file:** 50MB server bandwidth

**After (R2 + CDN):**
- **Upload:** Direct to R2, zero server bandwidth
- **Distribution:** R2 CDN, zero egress costs
- **Storage:** ~$0.015 per GB/month
- **Total bandwidth cost:** $0

### Rollback Plan (R2) — kept for reference

1. Revert `apps/server/src/routes/upload.ts` to original implementation
2. Revert `apps/server/src/routes/audio.ts` to file serving
3. Revert `apps/client/src/lib/api.ts` to FormData upload
4. Remove R2 dependencies and configuration
5. Ensure `/uploads/audio/` directory exists on server
