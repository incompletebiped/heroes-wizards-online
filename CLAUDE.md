# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Heroes & Wizards is a fan-made web app for playing the card game "Heroes & Wizards" in the browser. Built with Next.js 14 (App Router) and deployed on Vercel. Supports local hot-seat play (2-5 players, same device) and online multiplayer via a Cloudflare Worker (`realtime/`).

## Commands

```bash
npm run dev        # Start dev server at localhost:3000
npm run build      # Production build
npm run lint       # ESLint
npm test           # Jest (tests in tests/engine/) — currently has dependency issues
npm run test:watch # Jest watch mode
npx jest tests/engine/actions.test.ts  # Run a single test file
```

## Architecture

### Engine/UI Separation

The core pattern: **pure game logic in `src/engine/`** is completely decoupled from React. Engine functions are pure transformations: `(state) → newState`. Never mutate state — always return new objects via spread/map/filter.

- `src/engine/state.ts` — `GameState`, `Player`, `Party` types
- `src/engine/setup.ts` — `createGame()`, deck shuffling
- `src/engine/validation.ts` — `getLegalActions()`, `canPlayQuest()`
- `src/engine/actions.ts` — `drawCard`, `playCard`, `dumpCard`, `passTurn`
- `src/engine/events.ts` — event card resolution (steal, swap, feast, etc.)
- `src/engine/index.ts` — barrel export; import engine functions via `@/engine`

### Data Layer

`src/data/cards.ts` defines all 72 cards. `src/data/types.ts` has card type definitions with type guards (`isHeroCard`, `isWizardCard`, etc.). `src/data/constants.ts` has game constants.

### State Management

- **Local play:** `src/hooks/useGameState.ts` hook wraps engine calls in React state
- **Online play:** Three React contexts in `src/context/`:
  - `LobbyContext` — lobby creation/joining, player list sync
  - `OnlineGameContext` — host-authoritative game sync
  - `LeaveGameContext` — leave game confirmation

### Multiplayer (Cloudflare Worker + Durable Objects)

`realtime/` is a separate Cloudflare Worker (own `package.json`, deployed with `npm run deploy` there). One Durable Object per lobby code stores the player list and relays WebSocket messages; it never runs the engine. See `REALTIME_SETUP.md`.

- `src/lib/realtime.ts` — HTTP client + shared, auto-reconnecting `RoomConnection` (one socket per lobby, ref-counted)
- `src/lib/lobby.ts` — create/join/leave/reconnect; `lobbyId` is the 4-letter lobby code
- `src/lib/gameSync.ts` — host-authoritative sync: host applies actions locally and broadcasts state; clients send actions and wait for the host's broadcast
- Features: host migration, disconnect detection via presence (3-min grace), session reconnection, re-sync after a socket drop

### Component Hierarchy

```
GameWrapper → StartScreen | LobbyScreen | GameScreen | WinScreen
GameScreen → Deck, EventPile, Party, Hand, ActionBar, [Modals]
```

Components are presentation-only — callbacks like `onDraw`, `onPlayCard` etc. delegate to engine logic.

## Conventions

- **Imports:** Use `@/*` path alias for all `src/` imports
- **Components:** PascalCase files. Props use explicit interfaces.
- **Utils/lib:** camelCase files
- **Strict TypeScript** — no `any` in engine code, type guards for card discrimination
- **Engine functions never throw** — return unchanged state on invalid input

### Deployment

Next.js app on Vercel; realtime worker on Cloudflare (`cd realtime && npm run deploy`). Lobbies expire on their own via Durable Object alarms, so there are no cron jobs.

## Environment Variables

For online multiplayer, set the realtime worker URL in `.env.local` (and in Vercel). See `REALTIME_SETUP.md`.

```
NEXT_PUBLIC_REALTIME_URL    # e.g. http://127.0.0.1:8787 locally, or the workers.dev URL
```
`````
testing: GitShift 