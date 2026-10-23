import { acquireRoom, realtimeRequest, releaseRoom } from './realtime';
import type { LobbyPlayer } from '@/context/LobbyContext';

export interface CreateLobbyResult {
  lobbyId: string;
  lobbyCode: string;
  playerId: string;
  playerName: string;
  isHost: true;
  players: LobbyPlayer[];
}

export interface JoinLobbyResult {
  lobbyId: string;
  lobbyCode: string;
  playerId: string;
  playerName: string;
  isHost: false;
  players: LobbyPlayer[];
}

export type LobbyResult = CreateLobbyResult | JoinLobbyResult;

/** Shape returned by the realtime worker for create/join/reconnect. The lobby code doubles as the lobby id. */
interface WorkerLobbyInfo {
  lobbyCode: string;
  playerId: string;
  playerName: string;
  isHost: boolean;
  players: LobbyPlayer[];
}

/** Create a new lobby; host is the first player. */
export async function createLobby(hostName: string): Promise<CreateLobbyResult | { error: string }> {
  const result = await realtimeRequest<WorkerLobbyInfo>('/lobbies', { method: 'POST', body: { name: hostName } });
  if ('error' in result) return result;
  return { ...result, lobbyId: result.lobbyCode, isHost: true };
}

/** Join an existing lobby by code. */
export async function joinLobby(
  code: string,
  playerName: string
): Promise<JoinLobbyResult | { error: string }> {
  const normalizedCode = code.trim().toUpperCase();
  if (normalizedCode.length !== 4) return { error: 'Lobby code must be 4 letters.' };

  const result = await realtimeRequest<WorkerLobbyInfo>(`/lobbies/${normalizedCode}/players`, {
    method: 'POST',
    body: { name: playerName },
  });
  if ('error' in result) return result;
  return { ...result, lobbyId: result.lobbyCode, isHost: false };
}

/** Remove this player from the lobby (the lobby is deleted when the last player leaves). */
export async function leaveLobby(
  lobbyId: string,
  playerId: string
): Promise<{ error?: string }> {
  const result = await realtimeRequest<{ ok: true }>(
    `/lobbies/${encodeURIComponent(lobbyId)}/players/${encodeURIComponent(playerId)}`,
    { method: 'DELETE' }
  );
  return 'error' in result ? result : {};
}

const LOBBY_STORAGE_KEY = 'hw_lobby';

export interface RestoredLobby {
  lobbyId: string;
  lobbyCode: string;
  playerId: string;
  playerName: string;
  isHost: boolean;
  players: LobbyPlayer[];
}

/** Restore lobby state for reconnection: fetch lobby and players if this player is still in the lobby. */
export async function getLobbyForReconnect(
  lobbyId: string,
  playerId: string
): Promise<RestoredLobby | { error: string }> {
  const result = await realtimeRequest<WorkerLobbyInfo>(
    `/lobbies/${encodeURIComponent(lobbyId)}/players/${encodeURIComponent(playerId)}`
  );
  if ('error' in result) return result;
  return { ...result, lobbyId: result.lobbyCode };
}

/** Persist lobby for reconnection (sessionStorage). */
export function persistLobbyForReconnect(lobby: {
  lobbyId: string;
  playerId: string;
  playerName: string;
}): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(LOBBY_STORAGE_KEY, JSON.stringify(lobby));
  } catch {
    // ignore
  }
}

/** Clear persisted lobby (e.g. on explicit leave). */
export function clearPersistedLobby(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(LOBBY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Read persisted lobby from sessionStorage (for reconnection on load). */
export function getPersistedLobby(): {
  lobbyId: string;
  playerId: string;
  playerName: string;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(LOBBY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lobbyId?: string; playerId?: string; playerName?: string };
    if (parsed.lobbyId && parsed.playerId && parsed.playerName) {
      return {
        lobbyId: parsed.lobbyId,
        playerId: parsed.playerId,
        playerName: parsed.playerName,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Subscribe to the lobby's player list; callback receives the updated list. */
export function subscribeToLobbyPlayers(
  lobbyId: string,
  playerId: string,
  onPlayers: (players: LobbyPlayer[]) => void
): () => void {
  const room = acquireRoom(lobbyId, playerId);
  const off = room.on((message) => {
    if (message.type === 'players') onPlayers(message.players);
  });
  return () => {
    off();
    releaseRoom(lobbyId, playerId);
  };
}
