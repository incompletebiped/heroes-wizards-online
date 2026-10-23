import { acquireRoom, releaseRoom } from './realtime';
import type { GameState } from '@/engine/state';
import type { EventTarget } from '@/engine/events';
import { getCard } from '@/data/cards';
import { isEventCard } from '@/data/types';
import {
  drawCard,
  playCard,
  declarePlay,
  confirmDeclaration,
  playCardWithDeclarationDisplay,
  playCardWithDeclarationDisplayForEvent,
  playCardWithDeclarationDisplayForEventNoTarget,
  dismissPlayDeclarationDisplay,
  dumpCard,
  summonFromEventPile,
  passTurn,
  dismissFortuneReading,
  dismissEventBlocked,
  dismissDrawDeclaration,
  dismissDumpDeclaration,
  dismissSummonDeclaration,
  endGameDueToDisconnect,
} from '@/engine/actions';

export type GameAction =
  | { type: 'draw' }
  | { type: 'passTurn' }
  | { type: 'playCard'; cardId: number; target?: EventTarget }
  | { type: 'declarePlay'; cardId: number; target?: EventTarget }
  | { type: 'confirmDeclaration'; fullTarget?: EventTarget }
  | { type: 'playCardWithDeclarationDisplay'; cardId: number }
  | { type: 'playCardWithDeclarationDisplayForEvent'; cardId: number; target: EventTarget }
  | { type: 'playCardWithDeclarationDisplayForEventNoTarget'; cardId: number }
  | { type: 'dismissPlayDeclarationDisplay' }
  | { type: 'dumpCard'; cardId: number }
  | { type: 'summonFromPile'; cardId: number }
  | { type: 'dismissFortuneReading' }
  | { type: 'dismissEventBlocked' }
  | { type: 'dismissDrawDeclaration' }
  | { type: 'dismissDumpDeclaration' }
  | { type: 'dismissSummonDeclaration' }
  | { type: 'endGameDueToDisconnect'; leftPlayerIndex: number };

export interface GameStartPayload {
  state: GameState;
  playerOrder: string[];
}

export interface GameStatePayload {
  state: GameState;
  /** Included so reconnecting clients get player order; host sends with every game_state. */
  playerOrder?: string[];
}

export interface ActionPayload {
  action: GameAction;
  fromPlayerIndex: number;
}

export interface PlayerLeftPayload {
  playerIndex: number;
  playerId: string;
  /** 'leave' = explicit abandon (no rejoin); 'disconnect' = dropped (can rejoin). */
  reason?: 'leave' | 'disconnect';
}

export interface PlayerReconnectedPayload {
  playerIndex: number;
}

export interface RequestStatePayload {
  playerId: string;
}

/** The lobby connection as the game uses it: send broadcasts and track presence. */
export type GameChannel = {
  send: (message: object) => Promise<void>;
  track?: (payload: Record<string, unknown>) => void;
};

/** Ref to store the subscription channel so host/client can send on it and track presence. */
type GameChannelRef = { current: GameChannel | null };

/** Subscribe to the lobby's game messages; callbacks for game_start, game_state, player_left, player_reconnected, request_state. */
export function subscribeToGameChannel(
  lobbyId: string,
  playerId: string,
  callbacks: {
    onGameStart: (payload: GameStartPayload) => void;
    onGameState: (payload: GameStatePayload) => void;
    onAction?: (payload: ActionPayload) => void;
    /** Host: when a player leaves (abandon or disconnect), apply and broadcast. */
    onPlayerLeft?: (payload: PlayerLeftPayload) => void;
    /** Host: when a disconnected player rejoins presence, apply playerReconnected and broadcast. */
    onPlayerReconnected?: (payload: PlayerReconnectedPayload) => void;
    /** Host: when a client requests current state (e.g. reconnecting), broadcast game_state. */
    onRequestState?: (payload: RequestStatePayload) => void;
    /** This client's socket dropped and came back; anything broadcast meanwhile was missed. */
    onReconnected?: () => void;
    /** When provided, store the subscription channel here so host/client can send on it and track presence. */
    channelRef?: GameChannelRef;
  }
): () => void {
  const room = acquireRoom(lobbyId, playerId);
  if (callbacks.channelRef) {
    callbacks.channelRef.current = {
      send: (message) => room.send(message),
      track: (payload) => room.track(payload),
    };
  }

  const offMessage = room.on((message) => {
    if (message.type === 'broadcast') {
      const { event, payload } = message;
      if (event === 'game_start') callbacks.onGameStart(payload as GameStartPayload);
      else if (event === 'game_state') callbacks.onGameState(payload as GameStatePayload);
      else if (event === 'action') callbacks.onAction?.(payload as ActionPayload);
      else if (event === 'player_left') {
        const p = payload as PlayerLeftPayload;
        callbacks.onPlayerLeft?.({ ...p, reason: p.reason ?? 'leave' });
      } else if (event === 'request_state') callbacks.onRequestState?.(payload as RequestStatePayload);
    } else if (message.type === 'presence') {
      const { playerIndex, playerId: presentPlayerId } = message.payload;
      if (message.event === 'leave') {
        callbacks.onPlayerLeft?.({ playerIndex, playerId: presentPlayerId, reason: 'disconnect' });
      } else {
        callbacks.onPlayerReconnected?.({ playerIndex });
      }
    }
  });
  const offReconnect = callbacks.onReconnected ? room.onReconnect(callbacks.onReconnected) : () => {};

  return () => {
    if (callbacks.channelRef) callbacks.channelRef.current = null;
    offMessage();
    offReconnect();
    releaseRoom(lobbyId, playerId);
  };
}

/** Broadcast game start (state + playerOrder) on the subscription channel. */
export async function broadcastGameStart(
  lobbyId: string,
  state: GameState,
  playerOrder: string[],
  existingChannel?: GameChannel | null
): Promise<void> {
  await existingChannel?.send({
    type: 'broadcast',
    event: 'game_start',
    payload: { state, playerOrder },
  });
}

/** Broadcast new game state. Include playerOrder so reconnecting clients get it. */
export async function broadcastGameState(
  lobbyId: string,
  state: GameState,
  existingChannel?: GameChannel | null,
  playerOrder?: string[]
): Promise<void> {
  const payload = playerOrder != null ? { state, playerOrder } : { state };
  await existingChannel?.send({ type: 'broadcast', event: 'game_state', payload });
}

/** Send an action (non-host calls). */
export async function sendAction(
  lobbyId: string,
  fromPlayerIndex: number,
  action: GameAction,
  existingChannel?: GameChannel | null
): Promise<void> {
  await existingChannel?.send({ type: 'broadcast', event: 'action', payload: { action, fromPlayerIndex } });
}

/** Broadcast that this player is leaving (abandon). Host applies playerLeft and broadcasts game_state. */
export async function broadcastPlayerLeft(
  lobbyId: string,
  playerIndex: number,
  playerId: string,
  existingChannel?: GameChannel | null,
  reason: 'leave' | 'disconnect' = 'leave'
): Promise<void> {
  await existingChannel?.send({
    type: 'broadcast',
    event: 'player_left',
    payload: { playerIndex, playerId, reason },
  });
}

/** Request current game state (reconnecting client). Host responds by broadcasting game_state. */
export async function broadcastRequestState(
  lobbyId: string,
  playerId: string,
  existingChannel?: GameChannel | null
): Promise<void> {
  await existingChannel?.send({ type: 'broadcast', event: 'request_state', payload: { playerId } });
}

/** Apply an action to state (host uses this when receiving action from channel). */
export function applyAction(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'draw':
      return drawCard(state);
    case 'passTurn':
      return passTurn(state);
    case 'playCard':
      return playCard(state, action.cardId, action.target);
    case 'declarePlay':
      return declarePlay(state, action.cardId, action.target);
    case 'confirmDeclaration':
      return confirmDeclaration(state, action.fullTarget);
    case 'playCardWithDeclarationDisplay':
      return playCardWithDeclarationDisplay(state, action.cardId);
    case 'playCardWithDeclarationDisplayForEvent':
      return playCardWithDeclarationDisplayForEvent(state, action.cardId, action.target);
    case 'playCardWithDeclarationDisplayForEventNoTarget':
      return playCardWithDeclarationDisplayForEventNoTarget(state, action.cardId);
    case 'dismissPlayDeclarationDisplay':
      return dismissPlayDeclarationDisplay(state);
    case 'dumpCard':
      return dumpCard(state, action.cardId);
    case 'summonFromPile':
      return summonFromEventPile(state, action.cardId);
    case 'dismissFortuneReading':
      return dismissFortuneReading(state);
    case 'dismissEventBlocked':
      return dismissEventBlocked(state);
    case 'dismissDrawDeclaration':
      return dismissDrawDeclaration(state);
    case 'dismissDumpDeclaration':
      return dismissDumpDeclaration(state);
    case 'dismissSummonDeclaration':
      return dismissSummonDeclaration(state);
    case 'endGameDueToDisconnect':
      return endGameDueToDisconnect(state, action.leftPlayerIndex);
    default:
      return state;
  }
}

/** True if this declaration is for hunting_expedition awaiting card choice (host should not auto-confirm after 3s). */
export function isDeclarationAwaitingCardChoice(state: GameState): boolean {
  const pending = state.pendingPlayDeclaration;
  if (!pending) return false;
  const card = getCard(pending.cardId);
  if (!isEventCard(card) || card.eventId !== 'hunting_expedition') return false;
  return pending.target?.cardId === undefined;
}
