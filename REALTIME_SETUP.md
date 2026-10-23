# Online multiplayer setup (Cloudflare realtime worker)

Online play runs through a small Cloudflare Worker in `realtime/`. The Next.js app stays on Vercel; the worker handles lobbies and relays game messages. There is no database to manage.

## How it works

- **One Durable Object per lobby**, addressed by the 4-letter lobby code. It stores the player list and holds every player's WebSocket.
- **HTTP** for lobby create / join / leave / reconnect lookup.
- **WebSocket** (`/lobbies/:code/ws?playerId=...`) for live player-list updates, game broadcasts (`game_start`, `game_state`, `action`, `player_left`, `request_state`), and presence (join/leave, used for disconnect detection and host migration).
- **Game state is not stored on the server.** The host's browser is authoritative, the same as before; the worker only relays.
- **Cleanup is automatic.** A lobby deletes itself 2 hours after its last activity once nobody is connected, or immediately when the last player leaves. No cron jobs.

| Route | Purpose |
|---|---|
| `POST /lobbies` `{ name }` | Create lobby (caller is host) |
| `POST /lobbies/:code/players` `{ name }` | Join |
| `GET /lobbies/:code/players/:playerId` | Reconnect lookup |
| `DELETE /lobbies/:code/players/:playerId` | Leave |
| `GET /lobbies/:code/ws?playerId=...` | WebSocket |

## Local development

```bash
cd realtime
npm install
npm run dev          # worker on http://127.0.0.1:8787
```

In the project root `.env.local`:

```
NEXT_PUBLIC_REALTIME_URL=http://127.0.0.1:8787
```

Then `npm run dev` in the root. Without `NEXT_PUBLIC_REALTIME_URL`, the app runs local hot-seat only.

## Deploy

1. Deploy the worker (needs `CLOUDFLARE_API_TOKEN` with Workers edit permission, and `CLOUDFLARE_ACCOUNT_ID`, in the environment or via `npx wrangler login`):
   ```bash
   cd realtime
   npm run deploy
   ```
   Wrangler prints the URL, e.g. `https://heroes-wizards-realtime.<subdomain>.workers.dev`.
2. In Vercel → Project → Settings → Environment Variables, set `NEXT_PUBLIC_REALTIME_URL` to that URL, then redeploy (it is inlined at build time).
3. Optional: restrict which sites can call the worker by setting `ALLOWED_ORIGINS` in `realtime/wrangler.jsonc` (comma-separated, e.g. `https://www.heroesandwizards.online,http://localhost:3000`). The default `*` allows any origin.

## Free tier

Durable Objects (SQLite-backed) are on the Workers Free plan. Idle sockets hibernate, so a quiet lobby costs nothing, and nothing gets paused or deleted for inactivity.
