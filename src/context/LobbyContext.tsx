'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  subscribeToLobbyPlayers,
  getPersistedLobby,
  getLobbyForReconnect,
  persistLobbyForReconnect,
  clearPersistedLobby,
} from '@/lib/lobby';
import { isRealtimeConfigured } from '@/lib/realtime';

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost?: boolean;
}

export interface LobbyState {
  lobbyCode: string;
  playerName: string;
  isHost: boolean;
  players: LobbyPlayer[];
  /** Set for server-backed online lobbies (same as lobbyCode); used for realtime and leave. */
  lobbyId?: string;
  /** This client's player id in the server lobby; used for realtime and leave. */
  playerId?: string;
}

type SetLobbyArg = LobbyState | ((prev: LobbyState | null) => LobbyState | null);

interface LobbyContextValue {
  lobby: LobbyState | null;
  setLobby: (arg: SetLobbyArg) => void;
  leaveLobby: () => void;
  generateLobbyCode: () => string;
}

const LobbyContext = createContext<LobbyContextValue | null>(null);

const LOBBY_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O for clarity

function generateCode(length: number = 4): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += LOBBY_CODE_CHARS[Math.floor(Math.random() * LOBBY_CODE_CHARS.length)];
  }
  return code;
}

export function useLobby() {
  const ctx = useContext(LobbyContext);
  if (!ctx) {
    return {
      lobby: null,
      setLobby: () => {},
      leaveLobby: () => {},
      generateLobbyCode: () => '',
    };
  }
  return ctx;
}

export function LobbyProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [lobby, setLobbyState] = useState<LobbyState | null>(null);
  const hasRestoredRef = useRef(false);

  const setLobby = useCallback((arg: SetLobbyArg) => {
    setLobbyState((prev) =>
      typeof arg === 'function' ? arg(prev) : arg
    );
  }, []);

  const leaveLobby = useCallback(() => {
    setLobbyState(null);
    clearPersistedLobby();
  }, []);

  const generateLobbyCode = useCallback(() => generateCode(4), []);

  // Restore lobby from sessionStorage on load (reconnection)
  useEffect(() => {
    if (!isRealtimeConfigured() || hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    const persisted = getPersistedLobby();
    if (!persisted) return;
    getLobbyForReconnect(persisted.lobbyId, persisted.playerId).then((result) => {
      if ('error' in result) {
        clearPersistedLobby();
        return;
      }
      setLobbyState({
        lobbyCode: result.lobbyCode,
        playerName: result.playerName,
        isHost: result.isHost,
        players: result.players,
        lobbyId: result.lobbyId,
        playerId: result.playerId,
      });
      router.replace(`/?mode=online&lobby=${encodeURIComponent(result.lobbyCode)}`);
    });
  }, [router]);

  // Persist lobby for reconnection when we have lobbyId and playerId
  useEffect(() => {
    if (lobby?.lobbyId && lobby?.playerId && lobby?.playerName) {
      persistLobbyForReconnect({
        lobbyId: lobby.lobbyId,
        playerId: lobby.playerId,
        playerName: lobby.playerName,
      });
    } else if (!lobby) {
      clearPersistedLobby();
    }
  }, [lobby?.lobbyId, lobby?.playerId, lobby?.playerName, lobby]);

  // Subscribe to player-list updates when we have a server lobby
  useEffect(() => {
    if (!isRealtimeConfigured() || !lobby?.lobbyId || !lobby.playerId) return;
    const unsubscribe = subscribeToLobbyPlayers(lobby.lobbyId, lobby.playerId, (players) => {
      setLobbyState((prev) => (prev ? { ...prev, players } : null));
    });
    return unsubscribe;
  }, [lobby?.lobbyId, lobby?.playerId]);

  const value = useMemo(
    () => ({ lobby, setLobby, leaveLobby, generateLobbyCode }),
    [lobby, setLobby, leaveLobby, generateLobbyCode]
  );

  return (
    <LobbyContext.Provider value={value}>
      {children}
    </LobbyContext.Provider>
  );
}
