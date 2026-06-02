# CLAUDE.md

> 📖 **Full project documentation is in [`KNOWLEDGE.md`](./KNOWLEDGE.md)** — read that first for architecture, deployment, env vars, and common tasks.

This file provides quick reference for Claude Code when working with this repository.

## Key Commands

```bash
bun install              # Install all dependencies (run from root)
bun dev                  # Start both client and server (Turborepo)
bun client               # Client only (port 3000)
bun server               # Server only (port 8080)
bun build                # Build all packages

# Server-specific (run from apps/server/)
bun test                 # Run server tests (Bun test runner)
bun test --watch         # Watch mode
bun run type-check       # tsc --noEmit
bun run build            # Build server dist

# Client-specific (run from apps/client/)
bun run build            # Next.js standalone build
npx tsc --noEmit         # Client type-check
bun lint                 # next lint
```

## Quick Architecture

- **`apps/server`** — Bun WebSocket + HTTP server (native `Bun.serve`, manager pattern, no database)
  - Storage: Local filesystem or Oracle Object Storage (S3-compatible)
  - Music: Tidal streaming via hifi-api proxy with endpoint failover
- **`apps/client`** — Next.js 15 App Router, 3 Zustand stores, Tailwind v4, Shadcn/ui
- **`packages/shared`** — Zod schemas shared across client/server

## Key Recent Changes

- **Oracle Object Storage**: Optional S3-compatible storage backend (`OCI_*` env vars). Flat `audio/{id}.mp3` key structure.
- **AudioSource `name` field**: Tracks now carry a `name` property for UI display instead of URL-derived filenames.
- **Repeat modes**: Three-mode repeat (off → all → one) in player controls.
- **Search caching**: Client (60s TTL) and server (30s TTL) LRU caches for music search.

See [`KNOWLEDGE.md`](./KNOWLEDGE.md) for full architecture, WebSocket protocol, NTP sync, spatial audio, deployment guides, and troubleshooting.
