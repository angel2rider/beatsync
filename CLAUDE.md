# CLAUDE.md

> 📖 **Full project documentation is in [`KNOWLEDGE.md`](./KNOWLEDGE.md)** — read that first for architecture, deployment, env vars, and common tasks.

This file provides quick reference for Claude Code when working with this repository.

## Key Commands

```bash
bun install              # Install all dependencies (run from root)
bun dev                  # Start both client and server (Turborepo)
bun test                 # Run server tests (apps/server)
bun run type-check       # tsc --noEmit (apps/server)
```

## Quick Architecture

- **`apps/server`** — Bun WebSocket + HTTP server (native `Bun.serve`, manager pattern, no database)
- **`apps/client`** — Next.js 15 App Router, Zustand stores, Tailwind v4
- **`packages/shared`** — Zod schemas shared across client/server

See [`KNOWLEDGE.md`](./KNOWLEDGE.md) for full architecture, WebSocket protocol, NTP sync, spatial audio, deployment guides, and troubleshooting.
