'use client';

import { useCallback, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useGameState } from '@/hooks/useGameState';
import { useLeaveGame } from '@/context/LeaveGameContext';
import { useLobby } from '@/context/LobbyContext';
import { useOnlineGame } from '@/context/OnlineGameContext';
import { getLegalActions } from '@/engine/validation';
import { leaveLobby as leaveServerLobby } from '@/lib/lobby';
import StartScreen from '@/components/StartScreen';
import GameScreen from '@/components/GameScreen';
import WinScreen from '@/components/WinScreen';
import OnlineStatusNotification from '@/components/OnlineStatusNotification';

export default function GameWrapper() {
  const router = useRouter();
  const local = useGameState();
  const online = useOnlineGame();
  const { lobby, leaveLobby } = useLobby();
  const { registerLeaveGame } = useLeaveGame();

  const state = online.gameState ?? local.state;
  const inGame = !!state && !state.winnerPlayerId;

  const handleLeaveGame = useCallback(async () => {
    if (online.gameState) {
      await online.notifyPlayerLeftAndLeave();
      if (lobby?.lobbyId && lobby?.playerId) {
        await leaveServerLobby(lobby.lobbyId, lobby.playerId);
      }
      leaveLobby();
      router.replace('/?mode=online');
    } else {
      local.reset();
    }
  }, [online.gameState, online.notifyPlayerLeftAndLeave, lobby?.lobbyId, lobby?.playerId, leaveLobby, router, local.reset]);

  useEffect(() => {
    registerLeaveGame(inGame, handleLeaveGame);
    return () => registerLeaveGame(false, () => {});
  }, [inGame, handleLeaveGame, registerLeaveGame]);

  if (!state) {
    return (
      <Suspense fallback={<div className="start-screen">Loading...</div>}>
        <StartScreen onStart={local.startGame} />
      </Suspense>
    );
  }

  if (state.phase === 'gameOver') {
    const winner = state.winnerPlayerId
      ? state.players.find((p) => p.id === state.winnerPlayerId)
      : null;
    return (
      <WinScreen
        winnerName={winner?.name ?? null}
        playerLeft={!state.winnerPlayerId}
        onNewGame={handleLeaveGame}
      />
    );
  }

  const isOnline = !!online.gameState;
  const legalActions = getLegalActions(state);

  if (isOnline) {
    const onDraw = () => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'draw' });
      else online.sendAction({ type: 'draw' });
    };
    const onPassTurn = () => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'passTurn' });
      else online.sendAction({ type: 'passTurn' });
    };
    const onPlayCard = (cardId: number, target?: import('@/engine/events').EventTarget) => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'playCard', cardId, target });
      else online.sendAction({ type: 'playCard', cardId, target });
    };
    const onDeclarePlay = (cardId: number, target?: import('@/engine/events').EventTarget) => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'declarePlay', cardId, target });
      else online.sendAction({ type: 'declarePlay', cardId, target });
    };
    const onConfirmDeclaration = (fullTarget?: import('@/engine/events').EventTarget) => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'confirmDeclaration', fullTarget });
      else online.sendAction({ type: 'confirmDeclaration', fullTarget });
    };
    const onDumpCard = (cardId: number) => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'dumpCard', cardId });
      else online.sendAction({ type: 'dumpCard', cardId });
    };
    const onSummonFromPile = (cardId: number) => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'summonFromPile', cardId });
      else online.sendAction({ type: 'summonFromPile', cardId });
    };
    const onDismissFortuneReading = () => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'dismissFortuneReading' });
      else online.sendAction({ type: 'dismissFortuneReading' });
    };
    const onDismissEventBlocked = () => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'dismissEventBlocked' });
      else online.sendAction({ type: 'dismissEventBlocked' });
    };
    const onDismissDrawDeclaration = () => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'dismissDrawDeclaration' });
      else online.sendAction({ type: 'dismissDrawDeclaration' });
    };
    const onDismissDumpDeclaration = () => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'dismissDumpDeclaration' });
      else online.sendAction({ type: 'dismissDumpDeclaration' });
    };
    const onDismissSummonDeclaration = () => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'dismissSummonDeclaration' });
      else online.sendAction({ type: 'dismissSummonDeclaration' });
    };
    const onPlayCardWithDeclarationDisplay = (cardId: number) => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'playCardWithDeclarationDisplay', cardId });
      else online.sendAction({ type: 'playCardWithDeclarationDisplay', cardId });
    };
    const onPlayCardWithDeclarationDisplayForEvent = (cardId: number, target: import('@/engine/events').EventTarget) => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'playCardWithDeclarationDisplayForEvent', cardId, target });
      else online.sendAction({ type: 'playCardWithDeclarationDisplayForEvent', cardId, target });
    };
    const onPlayCardWithDeclarationDisplayForEventNoTarget = (cardId: number) => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'playCardWithDeclarationDisplayForEventNoTarget', cardId });
      else online.sendAction({ type: 'playCardWithDeclarationDisplayForEventNoTarget', cardId });
    };
    const onDismissPlayDeclarationDisplay = () => {
      if (online.isHost) online.applyActionAndBroadcast({ type: 'dismissPlayDeclarationDisplay' });
      else online.sendAction({ type: 'dismissPlayDeclarationDisplay' });
    };

    return (
      <>
        <OnlineStatusNotification />
        <GameScreen
          state={state}
          legalActions={legalActions}
          passTurnCountdown={null}
          onDraw={onDraw}
          onPassTurn={onPassTurn}
          onPlayCard={onPlayCard}
          onDeclarePlay={onDeclarePlay}
          onConfirmDeclaration={onConfirmDeclaration}
          onDumpCard={onDumpCard}
          onSummonFromPile={onSummonFromPile}
          onDismissFortuneReading={onDismissFortuneReading}
          onDismissEventBlocked={onDismissEventBlocked}
          onDismissDrawDeclaration={onDismissDrawDeclaration}
          onDismissDumpDeclaration={onDismissDumpDeclaration}
          onDismissSummonDeclaration={onDismissSummonDeclaration}
          onPlayCardWithDeclarationDisplay={onPlayCardWithDeclarationDisplay}
          onPlayCardWithDeclarationDisplayForEvent={onPlayCardWithDeclarationDisplayForEvent}
          onPlayCardWithDeclarationDisplayForEventNoTarget={onPlayCardWithDeclarationDisplayForEventNoTarget}
          onDismissPlayDeclarationDisplay={onDismissPlayDeclarationDisplay}
          onLeaveGame={handleLeaveGame}
          myPlayerIndex={online.myPlayerIndex}
        />
      </>
    );
  }

  return (
    <GameScreen
      state={state}
      legalActions={local.legalActions!}
      passTurnCountdown={local.passTurnCountdown}
      onDraw={local.handleDraw}
      onPassTurn={local.handlePassTurn}
      onPlayCard={local.handlePlayCard}
      onDeclarePlay={local.handleDeclarePlay}
      onConfirmDeclaration={local.handleConfirmDeclaration}
      onPlayCardWithDeclarationDisplay={local.handlePlayCardWithDeclarationDisplay}
      onPlayCardWithDeclarationDisplayForEvent={local.handlePlayCardWithDeclarationDisplayForEvent}
      onPlayCardWithDeclarationDisplayForEventNoTarget={local.handlePlayCardWithDeclarationDisplayForEventNoTarget}
      onDismissPlayDeclarationDisplay={local.handleDismissPlayDeclarationDisplay}
      onDumpCard={local.handleDumpCard}
      onSummonFromPile={local.handleSummonFromPile}
      onDismissFortuneReading={local.handleDismissFortuneReading}
      onDismissEventBlocked={local.handleDismissEventBlocked}
      onDismissDrawDeclaration={local.handleDismissDrawDeclaration}
      onDismissDumpDeclaration={local.handleDismissDumpDeclaration}
      onDismissSummonDeclaration={local.handleDismissSummonDeclaration}
      onLeaveGame={handleLeaveGame}
    />
  );
}
