// Types for pool game WebSocket protocol and game state.

import { type BallGroup, type BallState, type ShotParams } from '../game/pool/PoolCanvas';

export type { BallGroup, BallState, ShotParams };

export interface FoulInfo {
  type: string;
  message: string;
}

export interface ShotResultMessage {
  type: 'shot_result';
  player: string;
  shot_params: ShotParams;
  ball_positions: BallState[];
  pocketed_balls: number[];
  foul: FoulInfo | null;
  group_assigned: boolean;
  player1_group: BallGroup;
  player2_group: BallGroup;
  turn_change: boolean;
  next_turn: string;
  ball_in_hand: boolean;
  game_over: boolean;
  winner: string;
  win_type: string;
}

export interface PoolGameState {
  gameId: string | null;
  gameToken: string | null;
  playerToken: string | null;
  playerId: string | null;
  opponentId: string | null;
  myDisplayName: string | null;
  opponentDisplayName: string | null;
  myConnected: boolean;
  opponentConnected: boolean;
  myGroup: BallGroup;
  opponentGroup: BallGroup;
  balls: BallState[];
  currentTurn: string | null;
  myTurn: boolean;
  isBreakShot: boolean;
  ballInHand: boolean;
  ballInHandPlayer: string | null;
  shotNumber: number;
  stakeAmount: number;
  connected: boolean;
  status: string | null;
  winner: string | null;
  winType: string | null;
}

export interface PoolGameOverData {
  isWinner: boolean;
  winType: string;
}

// WebSocket message types for pool
export type PoolWSMessageType =
  | 'waiting_for_opponent'
  | 'game_starting'
  | 'game_state'
  | 'game_update'
  | 'shot_result'
  | 'ball_placed'
  | 'player_connected'
  | 'player_disconnected'
  | 'player_idle_warning'
  | 'player_forfeit'
  | 'player_idle_canceled'
  | 'player_conceded'
  | 'game_over'
  | 'session_cancelled'
  | 'error';

export interface PoolWSMessage {
  type: PoolWSMessageType;
  message?: string;
  // game_state / game_update fields
  game_id?: string;
  my_id?: string;
  opponent_id?: string;
  my_display_name?: string;
  opponent_display_name?: string;
  my_connected?: boolean;
  opponent_connected?: boolean;
  my_group?: BallGroup;
  opponent_group?: BallGroup;
  balls?: BallState[];
  current_turn?: string;
  my_turn?: boolean;
  is_break_shot?: boolean;
  ball_in_hand?: boolean;
  ball_in_hand_player?: string;
  shot_number?: number;
  stake_amount?: number;
  status?: string;
  winner?: string;
  win_type?: string;
  // shot_result fields
  player?: string;
  shot_params?: ShotParams;
  ball_positions?: BallState[];
  pocketed_balls?: number[];
  foul?: FoulInfo | null;
  group_assigned?: boolean;
  player1_group?: BallGroup;
  player2_group?: BallGroup;
  turn_change?: boolean;
  next_turn?: string;
  game_over?: boolean;
  // ball_placed fields
  x?: number;
  y?: number;
  // idle/disconnect fields
  forfeit_at?: string;
  remaining_seconds?: number;
  grace_seconds?: number;
  disconnected_at?: number;
}

// Outgoing message types
export interface TakeShotMessage {
  type: 'take_shot';
  data: ShotParams;
}

export interface PlaceCueBallMessage {
  type: 'place_cue_ball';
  data: { x: number; y: number };
}

export interface ConcedeMessage {
  type: 'concede';
  data: Record<string, never>;
}

export interface GetStateMessage {
  type: 'get_state';
  data: Record<string, never>;
}

export type PoolOutgoingMessage = TakeShotMessage | PlaceCueBallMessage | ConcedeMessage | GetStateMessage;
