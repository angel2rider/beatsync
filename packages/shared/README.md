# @beatsync/shared

Shared package for the Beatsync monorepo. Contains type-safe Zod schemas, constants, and utility functions shared between the client and server.

## Contents

### Types (`types/`)

| File | Purpose |
|---|---|
| `basic.ts` | Core schemas: `AudioSourceSchema` (url + optional name), `ClientSchema` |
| `WSRequest.ts` | Client→Server WebSocket message schemas (discriminated union) |
| `WSResponse.ts` | Server→Client WebSocket response union |
| `WSBroadcast.ts` | Server broadcast schemas (room events, scheduled actions) |
| `WSUnicast.ts` | Server unicast schemas (NTP responses, search results) |
| `HTTPRequest.ts` | HTTP request schemas |
| `provider.ts` | Music provider schemas |
| `index.ts` | Re-exports |

### Utils (`utils.ts`)

- `stringifyQuery(query: Record<string, string | number>)` — URL query string builder
- `getOrCreateInstance<T>(key, factory)` — Singleton factory with cleanup

### Constants (`constants.ts`)

- `AUDIO_EXTENSIONS` — Supported audio file extensions
- `AUDIO_DIR` — Default audio data directory
- `BACKUP_DIR` — State backup directory

### Geolocation (`geolocation.ts`)

- `getGeolocation()` — Browser geolocation wrapper (returns lat/lng or null)

## Usage

```typescript
import { AudioSourceSchema } from "@beatsync/shared";

const source = AudioSourceSchema.parse({
  url: "https://example.com/audio.mp3",
  name: "My Song Title",
});
```

## Development

```bash
cd packages/shared
bun install
```
