# Beatsync Client

Next.js 15 frontend for the Beatsync multi-device synchronized audio player.

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **React:** 19
- **Styling:** Tailwind CSS v4 + Shadcn/ui
- **State Management:** Zustand (3 stores: global, room, chat)
- **HTTP Client:** Axios + TanStack React Query
- **Build Output:** Standalone mode for production deployment

## Getting Started

```bash
cd apps/client
bun install
bun dev        # Start dev server on http://localhost:3000
bun run build  # Production build (standalone)
bun lint       # next lint
```

## Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
```

When not set, auto-detects from `window.location` and tries `hostname:8080`.

## Key Components

| Directory | Purpose |
|---|---|
| `src/app/` | Next.js pages (room, home, layout) |
| `src/components/` | UI components (Player, Queue, Dashboard, room components) |
| `src/store/` | Zustand state (global.tsx ~1600 lines, room.tsx, chat.tsx) |
| `src/hooks/` | Custom React hooks (NTP heartbeat, WebSocket reconnection, beat timing) |
| `src/lib/` | Utilities (API client, audio context, NTP, LRC parsing) |
| `src/utils/` | WebSocket helpers, time utils |
