'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import GameLogo from './GameLogo';
import { useLeaveGame } from '@/context/LeaveGameContext';
import { useLobby } from '@/context/LobbyContext';
import { useOnlineGame } from '@/context/OnlineGameContext';
import PlayerAvatarIcon from './PlayerAvatarIcon';
import { MAX_PLAYERS } from '@/data/constants';
import { leaveLobby as leaveServerLobby } from '@/lib/lobby';
import { createGame } from '@/engine/setup';

interface LobbyScreenProps {
  onStartGame?: (playerNames: string[]) => void;
}

export default function LobbyScreen({ onStartGame }: LobbyScreenProps) {
  const router = useRouter();
  const { lobby, leaveLobby } = useLobby();
  const { startOnlineGameAsHost, leaveOnlineGame } = useOnlineGame();
  const [copied, setCopied] = useState(false);
  const [showStartWarning, setShowStartWarning] = useState(false);

  const handleLeaveLobby = useCallback(async () => {
    if (lobby?.lobbyId && lobby?.playerId) {
      await leaveServerLobby(lobby.lobbyId, lobby.playerId);
    }
    leaveLobby();
    router.replace('/?mode=online');
  }, [lobby?.lobbyId, lobby?.playerId, leaveLobby, router]);

  /** Go back to main start screen (clear lobby + online game, then navigate). */
  const goToStart = useCallback(async () => {
    if (lobby?.lobbyId && lobby?.playerId) {
      await leaveServerLobby(lobby.lobbyId, lobby.playerId);
    }
    leaveLobby();
    leaveOnlineGame();
    router.replace('/');
  }, [lobby?.lobbyId, lobby?.playerId, leaveLobby, leaveOnlineGame, router]);

  const { registerGoToStart } = useLeaveGame();
  useEffect(() => {
    registerGoToStart(goToStart);
  }, [registerGoToStart, goToStart]);

  const inviteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?mode=online&lobby=${lobby?.lobbyCode ?? ''}`
      : '';

  const handleCopyLink = useCallback(async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the input
    }
  }, [inviteUrl]);

  const requestStartGame = useCallback(() => {
    if (!lobby || !onStartGame) return;
    const names = lobby.players.map((p) => p.name);
    if (names.length < 2) return;
    // Online lobby: game state is not synced yet—only the host would see the game.
    if (lobby.lobbyId) {
      setShowStartWarning(true);
      return;
    }
    onStartGame(names);
  }, [lobby, onStartGame]);

  const confirmStartGame = useCallback(() => {
    if (!lobby) return;
    setShowStartWarning(false);
    if (lobby.lobbyId) {
      const names = lobby.players.map((p) => p.name);
      const playerOrder = lobby.players.map((p) => p.id);
      const state = createGame(names);
      startOnlineGameAsHost(state, playerOrder);
    } else if (onStartGame) {
      onStartGame(lobby.players.map((p) => p.name));
    }
  }, [lobby, onStartGame, startOnlineGameAsHost]);

  if (!lobby) return null;

  const canStart = lobby.isHost && lobby.players.length >= 2;

  return (
    <main className="start-screen lobby-screen">
      <h1 className="start-title">
        <GameLogo maxHeight={120} onClick={goToStart} />
      </h1>

      <button
        type="button"
        onClick={goToStart}
        className="start-change-mode"
        aria-label="Change play mode"
      >
        Change Mode
      </button>

      <div className="lobby-screen__code">
        <span className="lobby-screen__code-label">Lobby Code:</span>
        <span className="lobby-screen__code-value" aria-label={`Lobby code ${lobby.lobbyCode}`}>
          {lobby.lobbyCode}
        </span>
      </div>

      <p className="lobby-screen__invite-text">Copy and share this link to invite other players.</p>
      <div className="lobby-screen__invite-row">
        <input
          type="text"
          readOnly
          value={inviteUrl}
          className="lobby-screen__invite-input"
          aria-label="Invitation link"
        />
        <button
          type="button"
          onClick={handleCopyLink}
          className="lobby-screen__copy-btn"
          aria-pressed={copied}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <div className="lobby-screen__players-wrap">
        <h2 className="lobby-screen__players-heading">
          Players ({lobby.players.length}/{MAX_PLAYERS})
        </h2>
        <ul className="lobby-screen__players" role="list">
          {lobby.players.map((player) => (
            <li key={player.id} className="lobby-screen__player-card">
              <div className="lobby-screen__player-avatar">
                <PlayerAvatarIcon />
              </div>
              <span className="lobby-screen__player-name">
                {player.name}
                {player.isHost && ' [Host]'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="lobby-screen__actions">
        <button
          type="button"
          onClick={requestStartGame}
          disabled={!canStart}
          className="lobby-screen__btn lobby-screen__btn--start"
          title={!canStart ? 'Need at least 2 players to start' : 'Start game'}
        >
          Start Game
        </button>
        <button
          type="button"
          onClick={handleLeaveLobby}
          className="lobby-screen__btn lobby-screen__btn--leave"
        >
          Leave Lobby
        </button>
      </div>

      {lobby.isHost && lobby.players.length < 2 && (
        <p className="lobby-screen__hint">Waiting for players to join (need at least 2 to start).</p>
      )}

      {showStartWarning && (
        <div
          className="lobby-screen__start-warning"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lobby-start-warning-title"
          onClick={() => setShowStartWarning(false)}
        >
          <div className="lobby-screen__start-warning-content" onClick={(e) => e.stopPropagation()}>
            <h2 id="lobby-start-warning-title" className="lobby-screen__start-warning-title">
              Start game for all players?
            </h2>
            <p className="lobby-screen__start-warning-text">
              The game will start for everyone in the lobby. All players will see the same game.
            </p>
            <div className="lobby-screen__start-warning-actions">
              <button
                type="button"
                onClick={() => setShowStartWarning(false)}
                className="lobby-screen__btn lobby-screen__btn--leave"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmStartGame}
                className="lobby-screen__btn lobby-screen__btn--start"
              >
                Start game
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
