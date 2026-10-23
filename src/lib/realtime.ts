/**
 * Client for the realtime worker (realtime/ — Cloudflare Worker + one Durable Object per lobby).
 * HTTP for lobby create/join/leave; one shared WebSocket per lobby for player-list updates,
 * game broadcasts, and presence.
 */

const realtimeUrl = (process.env.NEXT_PUBLIC_REALTIME_URL ?? '').replace(/\/+$/, '');

export const isRealtimeConfigured = (): boolean => Boolean(realtimeUrl);

export const NETWORK_ERROR_MESSAGE = 'Could not reach the game server. Check your connection and try again.';

/** Call the realtime worker's HTTP API. Returns the parsed JSON body or an `{ error }`. */
export async function realtimeRequest<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T | { error: string }> {
  if (!realtimeUrl) return { error: 'Online play is not configured' };
  try {
    const res = await fetch(`${realtimeUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { error: data.error ?? `Request failed (${res.status})` };
    return data;
  } catch {
    return { error: NETWORK_ERROR_MESSAGE };
  }
}

/** Messages the worker sends to clients. */
export type ServerMessage =
  | { type: 'players'; players: { id: string; name: string; isHost: boolean }[] }
  | { type: 'broadcast'; event: string; payload: unknown }
  | { type: 'presence'; event: 'join' | 'leave'; payload: { playerIndex: number; playerId: string } };

type Listener = (message: ServerMessage) => void;

const PING_INTERVAL_MS = 25_000;
const MAX_RECONNECT_DELAY_MS = 5_000;

/** A lobby's WebSocket. Reconnects automatically, queues sends while down, and re-sends presence after reconnecting. */
export class RoomConnection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectListeners = new Set<() => void>();
  private queue: string[] = [];
  private presence: Record<string, unknown> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 500;
  private hasConnected = false;
  private closed = false;
  refCount = 0;

  constructor(private readonly code: string, private readonly playerId: string) {
    this.connect();
  }

  /** Listen to server messages; returns an unsubscribe function. */
  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called after the socket comes back from a drop (not on the first connect). */
  onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  async send(message: object): Promise<void> {
    this.sendRaw(JSON.stringify(message));
  }

  track(payload: Record<string, unknown>): void {
    this.presence = payload;
    this.sendRaw(JSON.stringify({ type: 'track', payload }));
  }

  close(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, 'Left lobby');
    this.ws = null;
  }

  private sendRaw(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this.queue.push(data);
    }
  }

  private connect(): void {
    if (this.closed) return;
    const wsUrl = realtimeUrl.replace(/^http/, 'ws');
    const ws = new WebSocket(
      `${wsUrl}/lobbies/${encodeURIComponent(this.code)}/ws?playerId=${encodeURIComponent(this.playerId)}`
    );
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 500;
      if (this.presence) ws.send(JSON.stringify({ type: 'track', payload: this.presence }));
      for (const data of this.queue.splice(0)) ws.send(data);
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, PING_INTERVAL_MS);
      if (this.hasConnected) this.reconnectListeners.forEach((l) => l());
      this.hasConnected = true;
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data === 'pong') return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      this.listeners.forEach((l) => l(message));
    };

    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.closed || this.ws !== ws) return;
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    };
  }
}

const rooms = new Map<string, RoomConnection>();

/** Get the shared connection for a lobby (lobby screen and game sync use the same socket). Pair with releaseRoom. */
export function acquireRoom(code: string, playerId: string): RoomConnection {
  const key = `${code}:${playerId}`;
  let room = rooms.get(key);
  if (!room) {
    room = new RoomConnection(code, playerId);
    rooms.set(key, room);
  }
  room.refCount++;
  return room;
}

export function releaseRoom(code: string, playerId: string): void {
  const key = `${code}:${playerId}`;
  const room = rooms.get(key);
  if (!room) return;
  room.refCount--;
  if (room.refCount <= 0) {
    room.close();
    rooms.delete(key);
  }
}
