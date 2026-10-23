/**
 * Game actions: drawCard, playCard, dumpCard.
 * Pure functions: state in → new state out. No mutation.
 */

import { getCard } from '@/data/cards';
import { isHeroCard, isWizardCard, isEventCard, isQuestCard } from '@/data/types';
import type { HeroType } from '@/data/constants';
import type { GameState, Party } from './state';
import type { CardId } from './state';
import { canPlayQuest } from './validation';
import { resolveEvent, advanceTurn, advanceTurnPastInactive, getActivePlayerIndices, type EventTarget } from './events';
import { getDeclarationMessage } from '@/utils/declarationMessage';

/** Party slot key for hero type (Knight -> knight, etc.) */
const HERO_PARTY_KEY: Record<HeroType, keyof Party> = {
  Knight: 'knight',
  Archer: 'archer',
  Barbarian: 'barbarian',
  Thief: 'thief',
};

/** After playing a card: Stargazer gets second play; others must pass. */
function afterPlay(state: GameState): GameState {
  const current = state.players[state.currentPlayerIndex];
  const wizardCard = current.party.wizard !== null ? getCard(current.party.wizard) : null;
  const hasStargazer =
    wizardCard !== null &&
    isWizardCard(wizardCard) &&
    wizardCard.wizardType === 'Stargazer';
  if (hasStargazer && !state.stargazerSecondPlayUsed) {
    return { ...state, stargazerSecondPlayUsed: true };
  }
  return { ...state, actedThisTurn: true };
}

/**
 * Draw one card from the deck into the current player's hand.
 * Does not advance turn; player can look at hand then click "Pass turn".
 * Caller should ensure getLegalActions(state).canDraw is true.
 */
export function drawCard(state: GameState): GameState {
  if (state.phase !== 'chooseAction' || state.winnerPlayerId) return state;
  if (state.deck.length === 0) return state;
  if (state.drewThisTurn) return state;

  const currentIndex = state.currentPlayerIndex;
  const [drawn, ...restDeck] = state.deck;
  const players = state.players.map((p, i) =>
    i === currentIndex
      ? { ...p, hand: [...p.hand, drawn] }
      : p
  );

  return {
    ...state,
    deck: restDeck,
    players,
    drewThisTurn: true,
    actedThisTurn: true,
    pendingDrawDeclaration: currentIndex,
  };
}

/**
 * Dismiss the "X drew a card" declaration (clears pendingDrawDeclaration).
 */
export function dismissDrawDeclaration(state: GameState): GameState {
  if (!state.pendingDrawDeclaration) return state;
  return { ...state, pendingDrawDeclaration: undefined };
}

/**
 * Pass turn to the next player. Skips inactive (disconnected/left) players; game over if none active.
 */
export function passTurn(state: GameState): GameState {
  if (state.phase !== 'chooseAction' || state.winnerPlayerId) return state;
  const next = advanceTurn(state);
  return advanceTurnPastInactive(next);
}

/**
 * Dismiss Fortune Reading modal after player has viewed other players' hands.
 */
export function dismissFortuneReading(state: GameState): GameState {
  if (!state.pendingFortuneReading) return state;
  return { ...state, pendingFortuneReading: false };
}

/**
 * Dismiss the "event blocked" notification (e.g. after Healer blocked a steal).
 */
export function dismissEventBlocked(state: GameState): GameState {
  if (!state.eventBlocked) return state;
  return { ...state, eventBlocked: undefined };
}

/**
 * Declare a card play without applying it. Sets pendingPlayDeclaration so the UI can show
 * a declaration modal to (other) players; then confirmDeclaration applies the actual play.
 * Caller should ensure the current player has the card and target is valid if required.
 */
export function declarePlay(
  state: GameState,
  cardId: CardId,
  target?: EventTarget
): GameState {
  if (state.phase !== 'chooseAction' || state.winnerPlayerId) return state;
  if (state.pendingPlayDeclaration) return state;

  const currentIndex = state.currentPlayerIndex;
  const current = state.players[currentIndex];
  if (!current.hand.includes(cardId)) return state;

  return {
    ...state,
    pendingPlayDeclaration: { cardId, playerIndex: currentIndex, target },
  };
}

/**
 * Apply the declared play and clear pendingPlayDeclaration. For events that need a
 * two-step target (e.g. hunting_expedition: player then card), pass the full target.
 */
export function confirmDeclaration(
  state: GameState,
  fullTarget?: EventTarget
): GameState {
  const pending = state.pendingPlayDeclaration;
  if (!pending) return state;

  const target = fullTarget !== undefined ? fullTarget : pending.target;
  const next = playCard(state, pending.cardId, target);
  return { ...next, pendingPlayDeclaration: undefined };
}

/**
 * Play a hero or wizard card immediately and set pendingPlayDeclarationDisplay so other
 * players see the declaration modal (no delay for the active player).
 */
export function playCardWithDeclarationDisplay(state: GameState, cardId: CardId): GameState {
  const card = getCard(cardId);
  if (!isHeroCard(card) && !isWizardCard(card)) return state;
  const currentIndex = state.currentPlayerIndex;
  const message = getDeclarationMessage(state, cardId, undefined, currentIndex);
  const next = playCard(state, cardId);
  if (next === state) return state;
  return {
    ...next,
    pendingPlayDeclarationDisplay: { cardId, playerIndex: currentIndex, message },
  };
}

/**
 * Play an event card with target immediately (e.g. steal) and set pendingPlayDeclarationDisplay
 * so other players see the declaration (no delay for the active player).
 */
export function playCardWithDeclarationDisplayForEvent(
  state: GameState,
  cardId: CardId,
  target: EventTarget
): GameState {
  const card = getCard(cardId);
  if (!isEventCard(card)) return state;
  const currentIndex = state.currentPlayerIndex;
  const message = getDeclarationMessage(state, cardId, target, currentIndex);
  const next = playCard(state, cardId, target);
  if (next === state) return state;
  return {
    ...next,
    pendingPlayDeclaration: undefined,
    pendingPlayDeclarationDisplay: { cardId, playerIndex: currentIndex, target, message },
  };
}

/**
 * Play an event card with no target immediately (e.g. Fortune Reading) and set pendingPlayDeclarationDisplay
 * so other players see the declaration. Active player gets the effect immediately (e.g. Fortune Reading modal).
 */
export function playCardWithDeclarationDisplayForEventNoTarget(state: GameState, cardId: CardId): GameState {
  const card = getCard(cardId);
  if (!isEventCard(card)) return state;
  const currentIndex = state.currentPlayerIndex;
  const message = getDeclarationMessage(state, cardId, undefined, currentIndex);
  const next = playCard(state, cardId);
  if (next === state) return state;
  return {
    ...next,
    pendingPlayDeclaration: undefined,
    pendingPlayDeclarationDisplay: { cardId, playerIndex: currentIndex, message },
  };
}

/**
 * Dismiss the display-only play declaration (hero/wizard/event already applied).
 */
export function dismissPlayDeclarationDisplay(state: GameState): GameState {
  if (!state.pendingPlayDeclarationDisplay) return state;
  return { ...state, pendingPlayDeclarationDisplay: undefined };
}

/**
 * Play a card from the current player's hand.
 * - Hero/Wizard: add to party (swap existing same type back to hand), advance turn.
 * - Quest: if canPlayQuest, set winner and end game; remove card from hand.
 * - Event: add to event pile, run resolveEvent (e.g. Eagles = win; others stub in 1.6), then advance or end.
 * Optional target for events that need a player/card choice (used in 1.6).
 */
export function playCard(
  state: GameState,
  cardId: CardId,
  target?: EventTarget
): GameState {
  if (state.phase !== 'chooseAction' || state.winnerPlayerId) return state;

  const currentIndex = state.currentPlayerIndex;
  const current = state.players[currentIndex];
  const handIndex = current.hand.indexOf(cardId);
  if (handIndex === -1) return state;

  const card = getCard(cardId);
  const newHand = current.hand.filter((_, i) => i !== handIndex);

  if (isHeroCard(card)) {
    const slotKey = HERO_PARTY_KEY[card.heroType];
    const existing = current.party[slotKey];
    const newParty: Party = { ...current.party, [slotKey]: cardId };
    const handAfterSwap = existing !== null ? [...newHand, existing] : newHand;

    const players = state.players.map((p, i) =>
      i === currentIndex
        ? { ...p, hand: handAfterSwap, party: newParty }
        : p
    );

    return afterPlay({ ...state, players });
  }

  if (isWizardCard(card)) {
    const existing = current.party.wizard;
    const newParty: Party = { ...current.party, wizard: cardId };
    const handAfterSwap = existing !== null ? [...newHand, existing] : newHand;

    const players = state.players.map((p, i) =>
      i === currentIndex
        ? { ...p, hand: handAfterSwap, party: newParty }
        : p
    );

    return afterPlay({ ...state, players });
  }

  if (isQuestCard(card)) {
    if (!canPlayQuest(state, currentIndex)) return state;

    const winnerId = current.id;
    const players = state.players.map((p, i) =>
      i === currentIndex ? { ...p, hand: newHand } : p
    );

    return {
      ...state,
      players,
      phase: 'gameOver',
      winnerPlayerId: winnerId,
    };
  }

  if (isEventCard(card)) {
    const eventPile = [...state.eventPile, cardId];
    const players = state.players.map((p, i) =>
      i === currentIndex ? { ...p, hand: newHand } : p
    );
    const stateAfterPlay: GameState = {
      ...state,
      players,
      eventPile,
    };
    const stateAfterEvent = resolveEvent(stateAfterPlay, cardId, target);
    return afterPlay(stateAfterEvent);
  }

  return state;
}

/**
 * Dump a non-event card from hand to the event pile. Player must Pass Turn to end turn.
 * Caller should ensure card is not an event (getLegalActions enforces).
 */
export function dumpCard(state: GameState, cardId: CardId): GameState {
  if (state.phase !== 'chooseAction' || state.winnerPlayerId) return state;

  const currentIndex = state.currentPlayerIndex;
  const current = state.players[currentIndex];
  const handIndex = current.hand.indexOf(cardId);
  if (handIndex === -1) return state;

  const card = getCard(cardId);
  if (card.type === 'event') return state;

  const newHand = current.hand.filter((_, i) => i !== handIndex);
  const eventPile = [...state.eventPile, cardId];

  const players = state.players.map((p, i) =>
    i === currentIndex ? { ...p, hand: newHand } : p
  );

  return {
    ...state,
    players,
    eventPile,
    actedThisTurn: true,
    pendingDumpDeclaration: { playerIndex: currentIndex, cardId },
  };
}

/**
 * Dismiss the "X dumped a card" declaration (clears pendingDumpDeclaration).
 */
export function dismissDumpDeclaration(state: GameState): GameState {
  if (!state.pendingDumpDeclaration) return state;
  return { ...state, pendingDumpDeclaration: undefined };
}

/**
 * Summoner: "As a turn, you can draw any one card from the event pile."
 * Takes the chosen card from the event pile into the current player's hand. Player must Pass Turn to end turn.
 * Caller should ensure getLegalActions(state).canSummonFromPile is true and cardId is in state.eventPile.
 */
export function summonFromEventPile(state: GameState, cardId: CardId): GameState {
  if (state.phase !== 'chooseAction' || state.winnerPlayerId) return state;

  const currentIndex = state.currentPlayerIndex;
  const current = state.players[currentIndex];
  const wizardCard = current.party.wizard !== null ? getCard(current.party.wizard) : null;
  if (current.party.wizard === null || !wizardCard || !isWizardCard(wizardCard) || wizardCard.wizardType !== 'Summoner') return state;

  const pileIndex = state.eventPile.indexOf(cardId);
  if (pileIndex === -1) return state;

  const newEventPile = state.eventPile.filter((_, i) => i !== pileIndex);
  const newHand = [...current.hand, cardId];

  const players = state.players.map((p, i) =>
    i === currentIndex ? { ...p, hand: newHand } : p
  );

  return {
    ...state,
    players,
    eventPile: newEventPile,
    actedThisTurn: true,
    pendingSummonDeclaration: currentIndex,
  };
}

/**
 * Dismiss the "X used the Summoner to take a card from the Event Pile" declaration.
 */
export function dismissSummonDeclaration(state: GameState): GameState {
  if (state.pendingSummonDeclaration === undefined) return state;
  return { ...state, pendingSummonDeclaration: undefined };
}

const EMPTY_INACTIVE: number[] = [];

/** Grace period (ms) before ending 2-player game when opponent disconnects. Allows reconnection after tab switch. */
export const DISCONNECT_GRACE_PERIOD_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Mark that a player left or disconnected.
 * - 2 players + explicit leave: end game, remaining player wins.
 * - 2 players + disconnect: add to disconnected, start grace period (don't end immediately).
 * - 3+ players: add to disconnected (can rejoin) or left (no rejoin); skip their turn; game continues.
 */
export function playerLeft(
  state: GameState,
  leftPlayerIndex: number,
  reason: 'leave' | 'disconnect'
): GameState {
  if (state.phase === 'gameOver' || state.winnerPlayerId) return state;
  const n = state.players.length;
  if (n <= 2 && reason === 'leave') {
    const remainingIndices = state.players
      .map((_, i) => i)
      .filter((i) => i !== leftPlayerIndex);
    const winnerPlayerId =
      remainingIndices.length === 1
        ? state.players[remainingIndices[0]].id
        : null;
    return { ...state, phase: 'gameOver' as const, winnerPlayerId };
  }
  const disconnected = [...(state.disconnectedPlayerIndices ?? EMPTY_INACTIVE)];
  const left = [...(state.leftPlayerIndices ?? EMPTY_INACTIVE)];
  const disconnectedAt = { ...(state.disconnectedAt ?? {}) };
  if (reason === 'disconnect') {
    if (!disconnected.includes(leftPlayerIndex)) {
      disconnected.push(leftPlayerIndex);
      disconnectedAt[leftPlayerIndex] = Date.now();
    }
  } else {
    if (!left.includes(leftPlayerIndex)) left.push(leftPlayerIndex);
  }
  let next: GameState = {
    ...state,
    disconnectedPlayerIndices: disconnected,
    leftPlayerIndices: left,
    disconnectedAt,
  };
  if (next.currentPlayerIndex === leftPlayerIndex) {
    next = advanceTurn(next);
    next = advanceTurnPastInactive(next);
  }
  // 2 players + disconnect: keep the game open for the grace period (host ends it via endGameDueToDisconnect).
  if (n <= 2 && reason === 'disconnect') return next;
  const activeIndices = getActivePlayerIndices(next);
  if (activeIndices.length === 1) {
    return {
      ...next,
      phase: 'gameOver' as const,
      winnerPlayerId: next.players[activeIndices[0]].id,
    };
  }
  return next;
}

/**
 * End 2-player game after disconnect grace period expired. Remaining player wins.
 */
export function endGameDueToDisconnect(state: GameState, leftPlayerIndex: number): GameState {
  if (state.phase === 'gameOver' || state.winnerPlayerId) return state;
  const n = state.players.length;
  if (n !== 2) return state;
  const remainingIndex = state.players.findIndex((_, i) => i !== leftPlayerIndex);
  if (remainingIndex === -1) return state;
  return {
    ...state,
    phase: 'gameOver' as const,
    winnerPlayerId: state.players[remainingIndex].id,
  };
}

/**
 * Mark that a disconnected player reconnected. Removes them from disconnected list.
 */
export function playerReconnected(state: GameState, playerIndex: number): GameState {
  if (state.phase === 'gameOver' || state.winnerPlayerId) return state;
  const disconnected = (state.disconnectedPlayerIndices ?? EMPTY_INACTIVE).filter(
    (i) => i !== playerIndex
  );
  const disconnectedAt = { ...(state.disconnectedAt ?? {}) };
  delete disconnectedAt[playerIndex];
  return { ...state, disconnectedPlayerIndices: disconnected, disconnectedAt };
}
