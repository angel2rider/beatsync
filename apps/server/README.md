# Beatsync Server

Bun HTTP + WebSocket server for the Beatsync multi-device synchronized audio player.

## Tech Stack

- **Runtime:** Bun 1.x (native `Bun.serve`, no Express/Hono)
- **Validation:** Zod (schemas from `@beatsync/shared`)
- **Storage:** Local filesystem or Oracle Object Storage (S3-compatible)
- **Testing:** Bun test runner + sinon stubs

## Getting Started

```bash
cd apps/server
bun install
bun dev           # Start dev server on http://localhost:8080
bun test          # Run tests
bun run type-check  # tsc --noEmit
bun run build     # Build dist for deployment
```

## Environment Variables

See `KNOWLEDGE.md` (root) for full documentation.

## Project Structure

```
src/
├── index.ts                    # HTTP routing (pathname switch)
├── config.ts                   # Configuration
├── lib/
│   ├── objectStorage.ts        # Oracle Object Storage client
│   └── localStorage.ts         # Local filesystem + conditional Oracle
├── managers/
│   ├── GlobalManager.ts        # Room management (singleton)
│   ├── RoomManager.ts          # Per-room state & playback
│   ├── ChatManager.ts          # Message history
│   ├── BackupManager.ts        # State backup/restore
│   ├── MusicProviderManager.ts # Tidal streaming + search cache
│   └── EndpointManager.ts      # Provider failover/cooldown
├── websocket/
│   ├── registry.ts             # Message type → handler map
│   ├── dispatch.ts             # Message dispatch
│   ├── middlewares.ts           # Validation middleware
│   └── handlers/               # Per-message handlers
├── routes/                     # HTTP route handlers
└── __tests__/                  # Test suite (98 tests)
```
