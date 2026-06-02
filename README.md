# Beatsync

Beatsync is a high-precision web audio player built for multi-device synchronized playback. The official app is [beatsync.gg](https://www.beatsync.gg/).

https://github.com/user-attachments/assets/2aa385a7-2a07-4ab5-80b1-fda553efc57b

## Features

- **Millisecond-accurate synchronization**: NTP-inspired time synchronization protocol for cross-device playback accuracy
- **Cross-platform**: Works on any device with a modern browser (Chrome recommended for best performance)
- **Spatial audio**: Virtual listening source with configurable gain falloff algorithms (exponential, linear, quadratic)
- **Repeat modes**: Three-mode repeat (off, all, one) for queue playback
- **Shuffle**: Randomized queue playback order
- **Search caching**: Client- and server-side LRU caches for fast music search responses
- **Polished interface**: Smooth loading states, status indicators, and all UI elements come built-in
- **Self-hostable**: Run your own instance with a few commands
- **Flexible storage**: Local filesystem or Oracle Object Storage (S3-compatible)

> [!NOTE]
> Beatsync is in early development. Mobile support is working, but experimental. Please consider creating an issue or contributing with a PR if you run into problems!

## Quickstart

This project uses [Turborepo](https://turbo.build/repo).

Fill in the `.env` file in `apps/client` with the following:

```sh
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
```

Run the following commands to start the server and client:

```sh
bun install          # installs once for all workspaces
bun dev              # starts both client (:3000) and server (:8080)
```

| Directory         | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `apps/server`     | Bun HTTP + WebSocket server (manager pattern, no database)     |
| `apps/client`     | Next.js 15 frontend with React 19, Tailwind v4, Shadcn/ui      |
| `packages/shared` | Type-safe Zod schemas, constants, and utils shared across apps |

### Environment Variables

**apps/client/.env**

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
```

When not set, the client auto-detects from `window.location` (same-origin with reverse proxy) and tries `hostname:8080` at runtime.

**apps/server/.env**

```env
PORT=8080
HOST=0.0.0.0

# Music provider endpoints (comma-separated)
PROVIDER_URLS=https://ohio-1.monochrome.tf,https://frankfurt-1.monochrome.tf

# Oracle Object Storage (optional — falls back to local filesystem)
OCI_ACCESS_KEY=your_access_key
OCI_SECRET_KEY=your_secret_key
OCI_BUCKET=your_bucket
OCI_NAMESPACE=your_namespace
OCI_REGION=ap-hyderabad-1

# VPS hosting
SERVER_HOST=beatsync.example.com
SERVER_SECURE=1
```
