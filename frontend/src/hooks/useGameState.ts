import { useCallback, useReducer, useState, useEffect } from 'react';
import { GameState, Card, GameOverData } from '../types/game.types';
import { WSMessage } from '../types/websocket.types';

const initialGameState: GameState = {
  gameId: null,
  gameToken: null,
  playerToken: null,
  playerId: null,
  myHand: [],
  opponentCardCount: 0,
  topCard: null,
  discardPileCards: [],
  currentSuit: null,
  targetSuit: null,
  targetCard: null,
  myTurn: false,
  drawStack: 0,
  deckCount: 0,
  stakeAmount: 0,
  connected: false,
  canPass: false,
  myDisplayName: null,
  opponentDisplayName: null,
  myConnected: false,
  opponentConnected: false,
  winner: null,
  winType: null,
  lastPlayerPoints: null,
  lastOpponentPoints: null
};

// Helper validators
const VALID_SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const VALID_RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function isValidCard(obj: any): obj is Card {
  return !!obj && typeof obj.suit === 'string' && typeof obj.rank === 'string' &&
    VALID_SUITS.includes(obj.suit) && VALID_RANKS.includes(obj.rank);
}

function normalizeCard(obj: any): Card | null {
  return isValidCard(obj) ? { suit: obj.suit, rank: obj.rank } : null;
}

function normalizeCardArray(arr: any): Card[] {
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeCard).filter((c): c is Card => c !== null);
}

// Reducer actions
type Action =
  | { type: 'APPLY_WS_MSG'; payload: WSMessage }
  | { type: 'ADD_CARDS'; payload: Card[] }
  | { type: 'INC_OPPONENT'; payload: number }
  | { type: 'SET_CAN_PASS'; payload: boolean }
  | { type: 'SET_TOKENS'; payload: { gameToken: string; playerToken: string } }
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'CLEAR_WINNER' };

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'SET_TOKENS':
      return {
        ...state,
        gameToken: action.payload.gameToken,
        playerToken: action.payload.playerToken
      };

    case 'SET_CONNECTED':
      return { ...state, connected: action.payload };

    case 'SET_CAN_PASS':
      return { ...state, canPass: action.payload };

    case 'ADD_CARDS':
      return { ...state, myHand: [...state.myHand, ...action.payload] };

    case 'INC_OPPONENT':
      return { ...state, opponentCardCount: state.opponentCardCount + action.payload };

    case 'APPLY_WS_MSG': {
      const data = action.payload;
      const next = { ...state } as GameState;

      // Helper to check presence of optional keys
      const has = (k: string) => Object.prototype.hasOwnProperty.call(data, k);

      if (has('game_id')) next.gameId = data.game_id || null;
      if (has('token')) next.gameToken = (data as any).token || next.gameToken;
      if (has('my_id')) next.playerId = data.my_id || next.playerId;

      if (has('my_hand')) next.myHand = normalizeCardArray((data as any).my_hand);
      if (has('opponent_card_count')) next.opponentCardCount = (data as any).opponent_card_count ?? next.opponentCardCount;

      if (has('top_card')) next.topCard = (data as any).top_card ? normalizeCard((data as any).top_card) : null;
      if (has('discard_pile_cards')) next.discardPileCards = normalizeCardArray((data as any).discard_pile_cards);

      if (has('current_suit')) next.currentSuit = (data as any).current_suit || null;
      if (has('target_suit')) next.targetSuit = (data as any).target_suit || null;
      if (has('target_card')) next.targetCard = (data as any).target_card ? normalizeCard((data as any).target_card) : null;

      if (has('my_turn')) next.myTurn = data.my_turn ?? next.myTurn;
      if (has('draw_stack')) next.drawStack = data.draw_stack ?? next.drawStack;
      if (has('deck_count')) next.deckCount = data.deck_count ?? next.deckCount;
      if (has('stake_amount')) next.stakeAmount = data.stake_amount ?? next.stakeAmount;

      // Winner info (store for effect to resolve against current playerId)
      if (has('winner')) next.winner = data.winner || null;
      if (has('win_type')) next.winType = data.win_type || null;
      if (has('player_points')) next.lastPlayerPoints = (data as any).player_points ?? null;
      if (has('opponent_points')) next.lastOpponentPoints = (data as any).opponent_points ?? null;

      if (has('my_display_name')) next.myDisplayName = (data as any).my_display_name || null;
      if (has('opponent_display_name')) next.opponentDisplayName = (data as any).opponent_display_name || null;

      if (has('my_connected')) next.myConnected = (data as any).my_connected ?? next.myConnected;
      if (has('opponent_connected')) next.opponentConnected = (data as any).opponent_connected ?? next.opponentConnected;

      return next;
    }

    case 'CLEAR_WINNER':
      return { ...state, winner: null, winType: null, lastPlayerPoints: null, lastOpponentPoints: null };

    default:
      return state;
  }
}

export function useGameState() {
  const [state, dispatch] = useReducer(reducer, initialGameState);
  const [gameOver, setGameOver] = useState<GameOverData | null>(null);

  const updateFromWSMessage = useCallback((data: WSMessage) => {
    console.log('Updating gameState from WS message:', data);

    // Apply state updates
    dispatch({ type: 'APPLY_WS_MSG', payload: data });
  }, []);

  // Side effect: react to winner stored in state and set gameOver
  useEffect(() => {
    if (state.winner) {
      const winType: 'classic' | 'chop' = state.winType === 'chop' ? 'chop' : 'classic';
      setGameOver({
        isWinner: state.winner === state.playerId,
        winType,
        playerPoints: state.lastPlayerPoints ?? undefined,
        opponentPoints: state.lastOpponentPoints ?? undefined
      });

      // Clear transient winner info
      dispatch({ type: 'CLEAR_WINNER' });
      return;
    }

    // Handle draw as game over as well (no winner)
    if (state.winType === 'draw') {
      setGameOver({
        isWinner: false,
        winType: 'chop', // draw occurred on a chop
        playerPoints: state.lastPlayerPoints ?? undefined,
        opponentPoints: state.lastOpponentPoints ?? undefined,
        isDraw: true
      });
      // Clear transient winner/draw info
      dispatch({ type: 'CLEAR_WINNER' });
    }
  }, [state.winner, state.playerId, state.winType]);

  const setCanPass = useCallback((canPass: boolean) => {
    dispatch({ type: 'SET_CAN_PASS', payload: canPass });
  }, []);

  const addCardsToHand = useCallback((cards: Card[]) => {
    const valid = normalizeCardArray(cards as any);
    if (valid.length > 0) dispatch({ type: 'ADD_CARDS', payload: valid });
  }, []);

  const updateOpponentCardCount = useCallback((count: number) => {
    dispatch({ type: 'INC_OPPONENT', payload: count });
  }, []);

  const setTokens = useCallback((gameToken: string, playerToken: string) => {
    dispatch({ type: 'SET_TOKENS', payload: { gameToken, playerToken } });
    // Persist player token keyed by game token to survive refresh
    try {
      if (gameToken && playerToken) {
        localStorage.setItem('playerToken_' + gameToken, playerToken);
      }
    } catch (e) {
      // ignore storage errors
    }
  }, []);

  return {
    gameState: state,
    gameOver,
    updateFromWSMessage,
    setCanPass,
    addCardsToHand,
    updateOpponentCardCount,
    setTokens
  };
}