# Beatsync — Knowledge Base

> Multi-device synchronized audio player. A room-based system where multiple clients join a room and listen to music in perfect sync over WebSocket. Uses NTP-inspired time synchronization for millisecond-accurate cross-device playback.

---

## 1. Project Structure (Monorepo)

```
beatsync/
├── apps/
│   ├── client/          # Next.js 15 (App Router, React 19, Tailwind v4)
│   └── server/          # Bun HTTP + WebSocket server
├── packages/
│   └── shared/          # @beatsync/shared — Zod schemas, constants, utils
├── backups/             # State backups (auto-generated)
├── KNOWLEDGE.md         # ← You are here
├── CLAUDE.md            # Legacy AI guidance (consider merging)
├── bun.lock
├── turbo.json           # Turborepo config
└── lefthook.yml         # Git hooks
```

### apps/client

- **Framework:** Next.js 15 App Router, React 19
- **Styling:** Tailwind CSS v4, shadcn/ui components
- **State:** 3 Zustand stores — `global.tsx` (audio, WebSocket, NTP, playback, ~1500 lines), `room.tsx` (metadata), `chat.tsx` (messages)
- **HTTP:** Axios + TanStack React Query
- **Build:** `output: "standalone"` in next.config.ts for production deployment

### apps/server

- **Runtime:** Bun 1.x (`Bun.serve` — native, no Express/Hono routing)
- **HTTP routing:** Simple `pathname` switch statement in `index.ts`
- **Validation:** Zod schemas from `@beatsync/shared`
- **Storage:** Local filesystem (`apps/server/src/lib/localStorage.ts`) — audio files in `./audio-data/room-{roomId}/`, JSON backups in `./backups/`
- **Testing:** Bun test runner with sinon stubs (98 tests)
- **Build output:** `apps/server/dist/index.js` (pre-built for deployment)

---

## 2. Architecture

### 2.1 Server Manager Hierarchy

| Manager | Scope | File | Role |
|---|---|---|---|
| `GlobalManager` | Singleton | `GlobalManager.ts` | Manages all rooms, caches active user count |
| `RoomManager` | Per-room | `RoomManager.ts` | Clients, audio sources, playback, spatial audio, chat, cleanup |
| `ChatManager` | Per-room | `ChatManager.ts` | Message history with incremental IDs |
| `BackupManager` | Singleton | `BackupManager.ts` | Periodic state backup/restore to filesystem (every 60s) |
| `MusicProviderManager` | Singleton | `MusicProviderManager.ts` | External music search (Tidal via hifi-api proxy) |
| `EndpointManager` | Singleton | `EndpointManager.ts` | hifi-api provider failover/cooldown for rate-limit recovery |

### 2.2 WebSocket Protocol

All messages validated with Zod discriminated unions.

**Flow:**
1. Client connects → `handleOpen()` subscribes to room topic, sends initial state (audio sources, playback controls, volume, chat history)
2. Incoming messages validated against `WSRequestSchema` → dispatched via `WebsocketRegistry` (type-safe handler map in `registry.ts`)
3. Each handler is a separate file in `websocket/handlers/`

**Response types** (in `packages/shared/types/`):
- **`WSBroadcast`** — Sent to all room clients via `ws.publish(roomId)` / `sendBroadcast()`
- **`WSUnicast`** — Sent to a single client via `ws.send()` / `sendUnicast()`
- **`WSResponse`** — Union of broadcast + unicast

**Key message types:**
- `ROOM_EVENT` → wraps typed events: `SET_AUDIO_SOURCES`, `CLIENT_CHANGE`, `LOAD_AUDIO_SOURCE`, etc.
- `SCHEDULED_ACTION` → time-synchronized playback/volume/spatial commands with `serverTimeToExecute`
- `NTP_REQUEST` / `NTP_RESPONSE` — Fast path (skips Zod validation) for time sync
- `STREAM_UPDATE` / `STREAM_ERROR` — Track download progress

Adding a new WebSocket message type requires:
1. Add to `ClientActionEnum` in `packages/shared/types/WSRequest.ts`
2. Create a Zod schema for the message payload
3. Add a handler file in `apps/server/src/websocket/handlers/`
4. Register it in `websocket/registry.ts`

### 2.3 Time Synchronization (NTP)

NTP-inspired protocol for millisecond-accurate cross-device playback:
- Client sends `NTP_REQUEST` with `t0` → server stamps `t1`/`t2` → client receives at `t3`
- Exponential moving average smoothing (α=0.2) for RTT estimation
- Minimum 10 measurements before "synced" state
- Play/pause commands are **scheduled actions**: server broadcasts `serverTimeToExecute` and clients execute at that synchronized moment
- Scheduling delay = `max(400ms, maxRTT * 1.5 + 200, maxCompensation + 200)`, capped at 3s
- Fast path: NTP requests skip Zod validation entirely for minimum latency
- Coded probe pairs (two requests ~5ms apart) for better RTT estimation

### 2.4 Audio Pipeline

**Stream flow (Tidal → Server → Clients):**
1. User searches → WebSocket `SEARCH_MUSIC` → server queries hifi-api proxy → returns results
2. User clicks a track → WebSocket `STREAM_MUSIC` → server queries hifi-api `/track/` endpoint → decodes base64 manifest → fetches actual audio from Tidal CDN → saves to `./audio-data/room-{roomId}/` → broadcasts `SET_AUDIO_SOURCES`
3. Play requested → server broadcasts `LOAD_AUDIO_SOURCE` → clients fetch from `/audio-data/` → respond `AUDIO_SOURCE_LOADED` → server waits for all clients (3s timeout) → broadcasts `SCHEDULED_ACTION` with play command

**Upload flow (user direct upload):**
1. `POST /upload` with multipart form data → server saves to local filesystem → broadcasts `SET_AUDIO_SOURCES`

### 2.5 Music Provider (Tidal via hifi-api)

The server uses public hifi-api endpoints to proxy Tidal:
- **Search:** `GET {endpoint}/search/?s={query}&offset={n}&limit={n}`
- **Stream info:** `GET {endpoint}/track/?id={trackId}&quality=LOSSLESS`

**Endpoint failover** (EndpointManager):
- Multiple public endpoints configured via `PROVIDER_URLS` env var
- Failed endpoints go into cooldown (linear backoff: 30s → 60s → 90s → ... → 150s)
- Round-robin within healthy endpoints, picks soonest-recovering if all in cooldown
- Client 4xx errors (except 429) are NOT retried; 429/5xx/network errors are retried on next endpoint

**Manifest decoding:** hifi-api returns base64-encoded play manifests in BTS (JSON) or DASH (MPD XML) format. The `decodeManifest()` function handles both formats to extract the first audio URL.

### 2.6 Client State Management

Three Zustand stores:
- **`global.tsx`** — Main store (~1500 lines). Audio sources, WebSocket connection, NTP sync state, spatial audio, playback state, volume, search results, stream jobs. Uses LRU buffer cache (max 3 audio buffers).
- **`room.tsx`** — Room metadata (roomId, username, loading state)
- **`chat.tsx`** — Chat messages

### 2.7 Spatial Audio

Grid-based positioning system:
- Clients placed on a grid via `positionClientsInCircle()`
- A "listening source" position determines gain per client using distance calculation
- Three gain falloff algorithms: exponential, linear, quadratic (quadratic is default)
- Server broadcasts spatial gain config at 100ms intervals
- Client applies: `effectiveGain = globalVolume × spatialGain`

### 2.8 Room Cleanup

- 60 seconds after the last client disconnects, the room's audio files are deleted and the room is removed from memory
- If a client rejoins within the 60-second window, the cleanup timer is cancelled
- Cleanup happens at both `GlobalManager.scheduleRoomCleanup()` and `RoomManager.cleanup()` levels
- Demo mode rooms are NOT cleaned up (audio files are server-bundled)

---

## 3. Common Tasks

### 3.1 Adding a New WebSocket Handler

```typescript
// 1. Create handler file: apps/server/src/websocket/handlers/handleYourThing.ts
import type { Handler } from "../registry";

export const handleYourThing: Handler<"YOUR_ACTION"> = (ws, { message, server }) => {
  // Handle the message
};

// 2. Register in registry.ts: add to the handler map
```

### 3.2 Adding a Shared Type

```typescript
// packages/shared/types/WSBroadcast.ts (or WSRequest.ts)
export const YourSchema = z.object({ ... });
export type YourType = z.infer<typeof YourSchema>;
```

### 3.3 Adding a REST Endpoint

Add a new `case` to the switch statement in `apps/server/src/index.ts`:

```typescript
case "/your-route":
  return handleYourRoute(req);
```

### 3.4 Running Tests

```bash
cd apps/server && bun test
```

### 3.5 Adding a Dependency

```bash
cd apps/server && bun add <package>
# or
cd apps/client && bun add <package>
```

---

## 4. Environment Variables

### apps/server/.env

```env
# Server binding
PORT=8080
HOST=0.0.0.0

# Audio data directory (default: ./audio-data)
AUDIO_DATA_DIR=./audio-data

# Music provider endpoints (comma-separated, highest priority)
PROVIDER_URLS=https://ohio-1.monochrome.tf,https://frankfurt-1.monochrome.tf,...

# Single provider URL (fallback if PROVIDER_URLS not set)
PROVIDER_URL=https://ohio-1.monochrome.tf

# VPS hosting
SERVER_HOST=beatsync.example.com
SERVER_SECURE=1        # Set to "1" or "true" for HTTPS/WSS URLs
```

### apps/client/.env

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
```

When these are NOT set, the client auto-detects from `window.location` (same-origin with reverse proxy) and tries `hostname:8080` at runtime via `/api/server-info`.

---

## 5. Deployment

### Local Dev
```bash
bun install         # Install all deps
bun dev             # Start client (3000) + server (8080) via Turborepo
bun server          # Server only
bun client          # Client only
```

### VPS (Oracle, etc.)
```bash
# Pre-build locally to save VPS resources:
cd apps/server && bun build src/index.ts --target=bun --outdir=dist
cd apps/client && bun run build    # output: standalone mode

# Rsync to VPS (exclude node_modules, .git, .next/cache)
rsync -avz --exclude=node_modules --exclude=.git ./ user@VPS_IP:~/beatsync/

# On VPS:
cd ~/beatsync && bun install
# For standalone client:
cp -r apps/client/.next/static apps/client/.next/standalone/apps/client/.next/
cp -r apps/client/public apps/client/.next/standalone/apps/client/

# Start:
bun apps/server/dist/index.js &
node apps/client/.next/standalone/apps/client/server.js &
```

### Docker
```dockerfile
FROM oven/bun:1
EXPOSE 8080
CMD ["bun", "start"]
```

### PM2
```bash
pm2 start pm2.config.js
```

---

## 6. Code Conventions

- **No database** — everything is in-memory with periodic file system backups
- **Room IDs** — 6-digit numeric codes
- **Admin auto-promotion** — if last admin leaves, a random client is promoted
- **Demo mode** (`DEMO=1`) — skips audio downloads, uses bundled files, no backups
- **No `any` type casts** — always prefer proper Zod validation or discriminated unions
- **URL resolution** — client resolves server URL via: env vars → window.location → runtime `/api/server-info` fetch
- **All state is ephemeral** — rooms live only as long as clients are connected (+60s cleanup grace)

---

## 7. Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Search returns no results | hifi-api endpoint rate-limited or down | EndpointManager auto-failover handles this; check `PROVIDER_URLS` |
| Can't play audio | CORB/403 on audio URL | Check `/api/server-info` response — client may be on wrong port |
| Room not syncing | NTP not completing | Check WebSocket connection; verify NTP heartbeats are flowing |
| Client shows "No tracks yet" | Audio not downloaded or broadcast missed | Refresh page or re-add track; check server logs for file save |
| Audio upload fails | Room doesn't exist | Join the room first before uploading |
| Server won't start on VPS | Port in use | Change `PORT` env var or kill existing process |
| Backup too large | Many rooms in memory | Rooms with no clients auto-cleanup after 60s |
