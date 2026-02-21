// Pool game state management via useReducer.

import { useCallback, useReducer, useState, useEffect } from 'react';
import { PoolGameState, PoolWSMessage, PoolGameOverData, BallState } from '../types/pool.types';

const initialState: PoolGameState = {
  gameId: null,
  gameToken: null,
  playerToken: null,
  playerId: null,
  opponentId: null,
  myDisplayName: null,
  opponentDisplayName: null,
  myConnected: false,
  opponentConnected: false,
  myGroup: 'ANY',
  opponentGroup: 'ANY',
  balls: [],
  currentTurn: null,
  myTurn: false,
  isBreakShot: true,
  ballInHand: false,
  ballInHandPlayer: null,
  shotNumber: 0,
  stakeAmount: 0,
  connected: false,
  status: null,
  winner: null,
  winType: null,
};

type Action =
  | { type: 'APPLY_WS_MSG'; payload: PoolWSMessage }
  | { type: 'APPLY_SHOT_RESULT'; payload: PoolWSMessage }
  | { type: 'SET_BALL_POSITIONS'; payload: BallState[] }
  | { type: 'SET_TOKENS'; payload: { gameToken: string; playerToken: string } }
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'CLEAR_WINNER' };

function reducer(state: PoolGameState, action: Action): PoolGameState {
  switch (action.type) {
    case 'SET_TOKENS':
      return { ...state, gameToken: action.payload.gameToken, playerToken: action.payload.playerToken };

    case 'SET_CONNECTED':
      return { ...state, connected: action.payload };

    case 'SET_BALL_POSITIONS':
      return { ...state, balls: action.payload };

    case 'APPLY_WS_MSG': {
      const d = action.payload;
      const next = { ...state };
      const has = (k: string) => Object.prototype.hasOwnProperty.call(d, k);

      if (has('game_id')) next.gameId = d.game_id || null;
      if (has('my_id')) next.playerId = d.my_id || null;
      if (has('opponent_id')) next.opponentId = d.opponent_id || null;
      if (has('my_display_name')) next.myDisplayName = d.my_display_name || null;
      if (has('opponent_display_name')) next.opponentDisplayName = d.opponent_display_name || null;
      if (has('my_connected')) next.myConnected = d.my_connected ?? next.myConnected;
      if (has('opponent_connected')) next.opponentConnected = d.opponent_connected ?? next.opponentConnected;
      if (has('my_group')) next.myGroup = d.my_group || 'ANY';
      if (has('opponent_group')) next.opponentGroup = d.opponent_group || 'ANY';
      if (has('balls') && Array.isArray(d.balls)) next.balls = d.balls;
      if (has('current_turn')) next.currentTurn = d.current_turn || null;
      if (has('my_turn')) next.myTurn = d.my_turn ?? next.myTurn;
      if (has('is_break_shot')) next.isBreakShot = d.is_break_shot ?? next.isBreakShot;
      if (has('ball_in_hand')) next.ballInHand = d.ball_in_hand ?? next.ballInHand;
      if (has('ball_in_hand_player')) next.ballInHandPlayer = d.ball_in_hand_player || null;
      if (has('shot_number')) next.shotNumber = d.shot_number ?? next.shotNumber;
      if (has('stake_amount')) next.stakeAmount = d.stake_amount ?? next.stakeAmount;
      if (has('status')) next.status = d.status || null;
      if (has('winner')) next.winner = d.winner || null;
      if (has('win_type')) next.winType = d.win_type || null;

      return next;
    }

    case 'APPLY_SHOT_RESULT': {
      const d = action.payload;
      const next = { ...state };

      // Update groups
      if (d.player1_group) {
        // We need to know if we're player1 or player2
        // The groups come as player1_group / player2_group
        // But we store as myGroup / opponentGroup
        // We'll update from the game_update that follows
      }

      // Ball positions come from local PhysicsEngine animation, not from server.
      // Do NOT overwrite: if (d.ball_positions) next.balls = d.ball_positions;
      if (d.next_turn !== undefined) {
        next.currentTurn = d.next_turn || null;
        next.myTurn = d.next_turn === state.playerId;
      }
      if (d.ball_in_hand !== undefined) {
        next.ballInHand = d.ball_in_hand;
        // When ball_in_hand is true, the next_turn player places the cue ball
        if (d.ball_in_hand && d.next_turn) {
          next.ballInHandPlayer = d.next_turn;
        } else if (!d.ball_in_hand) {
          next.ballInHandPlayer = null;
        }
      }

      if (d.winner) next.winner = d.winner;
      if (d.win_type) next.winType = d.win_type;

      return next;
    }

    case 'CLEAR_WINNER':
      return { ...state, winner: null, winType: null };

    default:
      return state;
  }
}

export function usePoolGameState() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [gameOver, setGameOver] = useState<PoolGameOverData | null>(null);

  const updateFromWSMessage = useCallback((data: PoolWSMessage) => {
    dispatch({ type: 'APPLY_WS_MSG', payload: data });
  }, []);

  const applyShotResult = useCallback((data: PoolWSMessage) => {
    dispatch({ type: 'APPLY_SHOT_RESULT', payload: data });
  }, []);

  const setBallPositions = useCallback((balls: BallState[]) => {
    dispatch({ type: 'SET_BALL_POSITIONS', payload: balls });
  }, []);

  const setTokens = useCallback((gameToken: string, playerToken: string) => {
    dispatch({ type: 'SET_TOKENS', payload: { gameToken, playerToken } });
    try {
      if (gameToken && playerToken) {
        sessionStorage.setItem('playerToken_' + gameToken, playerToken);
      }
    } catch (e) {}
  }, []);

  // Detect game over from winner
  useEffect(() => {
    if (state.winner && state.playerId) {
      setGameOver({
        isWinner: state.winner === state.playerId,
        winType: state.winType || 'pocket_8',
      });
      dispatch({ type: 'CLEAR_WINNER' });
    }
  }, [state.winner, state.playerId, state.winType]);

  return {
    gameState: state,
    gameOver,
    updateFromWSMessage,
    applyShotResult,
    setBallPositions,
    setTokens,
  };
}
