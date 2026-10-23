'use client';

import { useCallback, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import GameLogo from './GameLogo';
import { useLeaveGame } from '@/context/LeaveGameContext';
import { useLobby } from '@/context/LobbyContext';
import { useOnlineGame } from '@/context/OnlineGameContext';
import { createLobby, joinLobby } from '@/lib/lobby';
import { isRealtimeConfigured } from '@/lib/realtime';
import { getRandomThemedName } from '@/utils/themedNames';

const NAME_MAX_LENGTH = 20;
const LOBBY_CODE_LENGTH = 4;

interface OnlineSetupScreenProps {
  /** When provided (from StartScreen), clears view and navigates home so logo/Change Mode work. */
  onGoToStart?: () => void;
}

export default function OnlineSetupScreen({ onGoToStart }: OnlineSetupScreenProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setLobby, generateLobbyCode, leaveLobby } = useLobby();
  const { leaveOnlineGame } = useOnlineGame();
  const lobbyFromUrl = searchParams.get('lobby')?.trim().toUpperCase().slice(0, LOBBY_CODE_LENGTH) ?? '';
  const [joinLobbyCode, setJoinLobbyCode] = useState('');
  const [joinName, setJoinName] = useState('');
  const [createName, setCreateName] = useState('');
  const [joinError, setJoinError] = useState('');
  const [createError, setCreateError] = useState('');
  const [loading, setLoading] = useState(false);

  const goToStartLocal = useCallback(() => {
    leaveLobby();
    leaveOnlineGame();
    router.replace('/');
  }, [leaveLobby, leaveOnlineGame, router]);

  const goToStart = onGoToStart ?? goToStartLocal;

  const { registerGoToStart } = useLeaveGame();
  useEffect(() => {
    registerGoToStart(goToStart);
  }, [registerGoToStart, goToStart]);

  // Pre-fill lobby code when user opens invite link (?mode=online&lobby=XXXX)
  useEffect(() => {
    if (lobbyFromUrl.length === LOBBY_CODE_LENGTH) {
      setJoinLobbyCode(lobbyFromUrl);
    }
  }, [lobbyFromUrl]);

  const handleCreateLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setLoading(true);
    const name = createName.trim() || 'Player';

    try {
      if (isRealtimeConfigured()) {
        const result = await createLobby(name);
        if ('error' in result) {
          setCreateError(result.error);
          return;
        }
        setLobby({
          lobbyCode: result.lobbyCode,
          playerName: result.playerName,
          isHost: true,
          players: result.players,
          lobbyId: result.lobbyId,
          playerId: result.playerId,
        });
        router.replace(`/?mode=online&lobby=${result.lobbyCode}`);
        return;
      }

      const code = generateLobbyCode();
      setLobby({
        lobbyCode: code,
        playerName: name,
        isHost: true,
        players: [{ id: 'host', name, isHost: true }],
      });
      router.replace(`/?mode=online&lobby=${code}`);
    } catch (err) {
      console.error('Create lobby error:', err);
      setCreateError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError('');
    setLoading(true);
    const code = joinLobbyCode.trim().toUpperCase();
    const name = joinName.trim() || 'Player';

    if (code.length !== LOBBY_CODE_LENGTH) {
      setJoinError('Lobby code must be 4 letters.');
      setLoading(false);
      return;
    }

    if (isRealtimeConfigured()) {
      const result = await joinLobby(code, name);
      setLoading(false);
      if ('error' in result) {
        setJoinError(result.error);
        return;
      }
      setLobby({
        lobbyCode: result.lobbyCode,
        playerName: result.playerName,
        isHost: false,
        players: result.players,
        lobbyId: result.lobbyId,
        playerId: result.playerId,
      });
      router.replace(`/?mode=online&lobby=${result.lobbyCode}`);
      return;
    }

    setLobby({
      lobbyCode: code,
      playerName: name,
      isHost: false,
      players: [{ id: 'me', name }],
    });
    setLoading(false);
    router.replace(`/?mode=online&lobby=${code}`);
  };

  return (
    <main className="start-screen online-setup">
      <h1 className="start-title">
        <GameLogo maxHeight={173} onClick={goToStart} />
      </h1>
      <p className="start-subtitle">The Card Game of Strategy, Magic & Mischief!</p>

      <button
        type="button"
        onClick={goToStart}
        className="start-change-mode"
        aria-label="Change play mode (Local or Online)"
      >
        Change Mode
      </button>

      <div className="online-setup__sections">
        <section className="online-setup__section">
          <h2 className="online-setup__heading">Join a Game</h2>
          <form onSubmit={handleJoinLobby} className="online-setup__form">
            <label className="online-setup__label">
              Lobby
              <input
                type="text"
                value={joinLobbyCode}
                onChange={(e) => setJoinLobbyCode(e.target.value.toUpperCase().slice(0, LOBBY_CODE_LENGTH))}
                placeholder="e.g. HTNS"
                className="online-setup__input"
                maxLength={LOBBY_CODE_LENGTH}
                aria-describedby={joinError ? 'join-error' : undefined}
              />
            </label>
            <label className="online-setup__label">
              Your Name
              <div className="start-name-row">
                <input
                  type="text"
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value.slice(0, NAME_MAX_LENGTH))}
                  placeholder="Your name"
                  className="online-setup__input start-name-row__input"
                  maxLength={NAME_MAX_LENGTH}
                />
                <button
                  type="button"
                  onClick={() => setJoinName(getRandomThemedName().slice(0, NAME_MAX_LENGTH))}
                  className="start-name-row__random"
                  title="Pick a random themed name"
                  aria-label="Pick random name"
                >
                  Random
                </button>
              </div>
            </label>
            {joinError && (
              <p id="join-error" className="online-setup__error" role="alert">
                {joinError}
              </p>
            )}
            <button
              type="submit"
              className="online-setup__btn online-setup__btn--join"
              disabled={loading}
            >
              {loading ? '…' : 'Join'}
            </button>
          </form>
        </section>

        <section className="online-setup__section">
          <h2 className="online-setup__heading">Create a Lobby</h2>
          <form onSubmit={handleCreateLobby} className="online-setup__form">
            <label className="online-setup__label">
              Your Name
              <div className="start-name-row">
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value.slice(0, NAME_MAX_LENGTH))}
                  placeholder="Your name"
                  className="online-setup__input start-name-row__input"
                  maxLength={NAME_MAX_LENGTH}
                />
                <button
                  type="button"
                  onClick={() => setCreateName(getRandomThemedName().slice(0, NAME_MAX_LENGTH))}
                  className="start-name-row__random"
                  title="Pick a random themed name"
                  aria-label="Pick random name"
                >
                  Random
                </button>
              </div>
            </label>
            {createError && (
              <p className="online-setup__error" role="alert">
                {createError}
              </p>
            )}
            <button
              type="submit"
              className="online-setup__btn online-setup__btn--create"
              disabled={loading}
            >
              {loading ? '…' : 'Create Lobby'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
