import { DurableObject } from 'cloudflare:workers';

export interface Env {
  LOBBY: DurableObjectNamespace<Lobby>;
  /** Comma-separated list of allowed browser origins. Unset or "*" allows any origin. */
  ALLOWED_ORIGINS?: string;
}

const MAX_PLAYERS = 5;
const NAME_MAX_LENGTH = 20;
const CODE_LENGTH = 4;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O for clarity
/** Lobby data is deleted this long after the last activity once nobody is connected. */
const RETENTION_MS = 2 * 60 * 60 * 1000;
/** While sockets are open, the lobby wakes this often to drop dead ones. */
const SWEEP_INTERVAL_MS = 60 * 1000;
/** A socket that hasn't pinged for this long is treated as disconnected (clients ping every 25s; background tabs may throttle to ~1/min). */
const STALE_SOCKET_MS = 150 * 1000;

interface StoredPlayer {
  id: string;
  name: string;
  isHost: boolean;
}

interface LobbyRecord {
  code: string;
  createdAt: number;
  /** Set when the host broadcasts game_start; new joins are rejected after that. */
  started: boolean;
  players: StoredPlayer[];
}

interface Presence {
  playerIndex: number;
  playerId: string;
}

interface SocketAttachment {
  playerId: string;
  connectedAt: number;
  presence?: Presence;
}

export interface LobbyInfo {
  lobbyCode: string;
  playerId: string;
  playerName: string;
  isHost: boolean;
  players: StoredPlayer[];
}

type LobbyResult = LobbyInfo | { error: string; status: number };

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().slice(0, NAME_MAX_LENGTH);
  return name.length > 0 ? name : null;
}

function toInfo(lobby: LobbyRecord, player: StoredPlayer): LobbyInfo {
  return {
    lobbyCode: lobby.code,
    playerId: player.id,
    playerName: player.name,
    isHost: player.isHost,
    players: lobby.players,
  };
}

/** One Durable Object per lobby code: holds the player list and relays game messages between sockets. */
export class Lobby extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answer client pings without waking the object from hibernation.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async create(code: string, hostName: string): Promise<LobbyResult> {
    if (await this.load()) return { error: 'Lobby code taken', status: 409 };
    const host: StoredPlayer = { id: crypto.randomUUID(), name: hostName, isHost: true };
    const lobby: LobbyRecord = { code, createdAt: Date.now(), started: false, players: [host] };
    await this.save(lobby);
    return toInfo(lobby, host);
  }

  async join(name: string): Promise<LobbyResult> {
    const lobby = await this.load();
    if (!lobby) return { error: 'Lobby not found.', status: 404 };
    if (lobby.started) return { error: 'That game has already started.', status: 409 };
    if (lobby.players.length >= MAX_PLAYERS) return { error: 'Lobby is full.', status: 409 };
    if (lobby.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return { error: 'That name is already taken in this lobby.', status: 409 };
    }
    const player: StoredPlayer = { id: crypto.randomUUID(), name, isHost: false };
    lobby.players.push(player);
    await this.save(lobby);
    this.broadcastPlayers(lobby);
    return toInfo(lobby, player);
  }

  async leave(playerId: string): Promise<void> {
    const lobby = await this.load();
    if (!lobby) return;
    lobby.players = lobby.players.filter((p) => p.id !== playerId);
    if (lobby.players.length === 0) {
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.save(lobby);
    this.broadcastPlayers(lobby);
  }

  async getPlayer(playerId: string): Promise<LobbyResult> {
    const lobby = await this.load();
    if (!lobby) return { error: 'Lobby not found.', status: 404 };
    const player = lobby.players.find((p) => p.id === playerId);
    if (!player) return { error: 'You are no longer in this lobby.', status: 404 };
    return toInfo(lobby, player);
  }

  /** WebSocket upgrade; the worker has already checked the Upgrade header. */
  async fetch(request: Request): Promise<Response> {
    const playerId = new URL(request.url).searchParams.get('playerId') ?? '';
    const lobby = await this.load();
    if (!lobby || !lobby.players.some((p) => p.id === playerId)) {
      return new Response('Not in this lobby', { status: 403 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const attachment: SocketAttachment = { playerId, connectedAt: Date.now() };
    server.serializeAttachment(attachment);
    server.send(JSON.stringify({ type: 'players', players: lobby.players }));

    const alarm = await this.ctx.storage.getAlarm();
    const sweepAt = Date.now() + SWEEP_INTERVAL_MS;
    if (alarm === null || alarm > sweepAt) await this.ctx.storage.setAlarm(sweepAt);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    let message: { type?: unknown; event?: unknown; payload?: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === 'broadcast' && typeof message.event === 'string') {
      if (message.event === 'game_start') {
        const lobby = await this.load();
        if (lobby && !lobby.started) {
          lobby.started = true;
          await this.save(lobby);
        }
      }
      // Relay as-is to everyone, sender included (matches the old broadcast `self: true`).
      this.sendAll(raw);
      return;
    }

    if (message.type === 'track') {
      const payload = message.payload as Partial<Presence> | undefined;
      if (typeof payload?.playerIndex !== 'number' || typeof payload.playerId !== 'string') return;
      const attachment = ws.deserializeAttachment() as SocketAttachment;
      if (attachment.presence?.playerIndex === payload.playerIndex) return;
      const presence: Presence = { playerIndex: payload.playerIndex, playerId: payload.playerId };
      ws.serializeAttachment({ ...attachment, presence });
      this.sendAll(JSON.stringify({ type: 'presence', event: 'join', payload: presence }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.socketGone(ws);
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment;
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? attachment.connectedAt;
      if (now - lastPing > STALE_SOCKET_MS) {
        try {
          ws.close(4000, 'Ping timeout');
        } catch {
          // already closed
        }
        await this.socketGone(ws);
      }
    }

    if (this.openSockets().length > 0) {
      await this.ctx.storage.setAlarm(now + SWEEP_INTERVAL_MS);
      return;
    }
    const lastActive = (await this.ctx.storage.get<number>('lastActive')) ?? 0;
    if (now - lastActive >= RETENTION_MS) {
      await this.ctx.storage.deleteAll();
    } else {
      await this.ctx.storage.setAlarm(lastActive + RETENTION_MS);
    }
  }

  private async load(): Promise<LobbyRecord | undefined> {
    return this.ctx.storage.get<LobbyRecord>('lobby');
  }

  private async save(lobby: LobbyRecord): Promise<void> {
    await this.ctx.storage.put({ lobby, lastActive: Date.now() });
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }

  private openSockets(exclude?: WebSocket): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws !== exclude && ws.readyState === WebSocket.OPEN);
  }

  private sendAll(message: string, exclude?: WebSocket): void {
    for (const ws of this.openSockets(exclude)) {
      try {
        ws.send(message);
      } catch {
        // socket closed mid-send; the close handler deals with it
      }
    }
  }

  private broadcastPlayers(lobby: LobbyRecord): void {
    this.sendAll(JSON.stringify({ type: 'players', players: lobby.players }));
  }

  /** A socket closed: announce presence leave unless the same player still has another socket open (e.g. a reload that reconnected first). */
  private async socketGone(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    const others = this.openSockets(ws);
    if (attachment?.presence) {
      const stillHere = others.some(
        (other) => (other.deserializeAttachment() as SocketAttachment).presence?.playerId === attachment.playerId
      );
      if (!stillHere) {
        this.sendAll(JSON.stringify({ type: 'presence', event: 'leave', payload: attachment.presence }), ws);
      }
    }
    if (others.length === 0) {
      await this.ctx.storage.put('lastActive', Date.now());
    }
  }
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '*').split(',').map((o) => o.trim());
  const allowOrigin = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function lobbyStub(env: Env, code: string): DurableObjectStub<Lobby> {
  return env.LOBBY.get(env.LOBBY.idFromName(code));
}

async function readName(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { name?: unknown };
    return cleanName(body.name);
  } catch {
    return null;
  }
}

/**
 * Routes:
 *   POST   /lobbies                          { name } → create lobby (caller is host)
 *   POST   /lobbies/:code/players            { name } → join
 *   GET    /lobbies/:code/players/:playerId           → reconnect lookup
 *   DELETE /lobbies/:code/players/:playerId           → leave
 *   GET    /lobbies/:code/ws?playerId=...             → WebSocket
 */
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'lobbies') return Response.json({ error: 'Not found' }, { status: 404 });

  const reply = (result: LobbyResult) =>
    'error' in result ? Response.json({ error: result.error }, { status: result.status }) : Response.json(result);

  if (parts.length === 1 && request.method === 'POST') {
    const name = await readName(request);
    if (!name) return Response.json({ error: 'Name is required.' }, { status: 400 });
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateCode();
      const result = await lobbyStub(env, code).create(code, name);
      if (!('error' in result) || result.status !== 409) return reply(result);
    }
    return Response.json({ error: 'Could not allocate a lobby code. Try again.' }, { status: 503 });
  }

  const code = (parts[1] ?? '').toUpperCase();
  if (code.length !== CODE_LENGTH) return Response.json({ error: 'Lobby code must be 4 letters.' }, { status: 400 });
  const stub = lobbyStub(env, code);

  if (parts[2] === 'ws' && parts.length === 3) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    return stub.fetch(request);
  }

  if (parts[2] === 'players') {
    if (parts.length === 3 && request.method === 'POST') {
      const name = await readName(request);
      if (!name) return Response.json({ error: 'Name is required.' }, { status: 400 });
      return reply(await stub.join(name));
    }
    const playerId = parts[3];
    if (parts.length === 4 && playerId) {
      if (request.method === 'GET') return reply(await stub.getPlayer(playerId));
      if (request.method === 'DELETE') {
        await stub.leave(playerId);
        return Response.json({ ok: true });
      }
    }
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const response = await route(request, env);
    if (response.status === 101) return response;
    const withCors = new Response(response.body, response);
    for (const [key, value] of Object.entries(cors)) withCors.headers.set(key, value);
    return withCors;
  },
} satisfies ExportedHandler<Env>;
