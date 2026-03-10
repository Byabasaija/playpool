// Types for pool game WebSocket protocol and game state.

import { type BallGroup, type BallState, type ShotParams } from '../game/pool/types';

export type { BallGroup, BallState, ShotParams };

export interface FoulInfo {
  type: string;
  message: string;
}

export interface ShotResultMessage {
  type: 'shot_result';
  player: string;
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
  timeout?: boolean;
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
  turnExpiresAt: string | null;
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
  | 'shot_relay'
  | 'ball_placed'
  | 'cue_ball_move'
  | 'player_connected'
  | 'player_disconnected'
  | 'player_conceded'
  | 'game_over'
  | 'session_cancelled'
  | 'sync_request'
  | 'sync_response'
  | 'cue_aim'
  | 'game_cancelled'
  | 'rematch_pending'
  | 'rematch_invite'
  | 'rematch_ready'
  | 'rematch_failed'
  | 'rematch_expired'
  | 'error';

export interface PoolWSMessage {
  type: PoolWSMessageType;
  message?: string;
  breaker?: string; // game_starting: player ID who won the coin toss
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
  // shot_result / shot_relay fields
  player?: string;
  shot_params?: ShotParams;
  pocketed_balls?: number[];
  timeout?: boolean;
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
  // cue_aim fields
  aim_angle?: number;
  aim_power?: number;
  // turn timer
  turn_expires_at?: string;
  // idle/disconnect fields
  forfeit_at?: string;
  remaining_seconds?: number;
  grace_seconds?: number;
  disconnected_at?: number;
  // sync_request field: which reconnecting player needs physics state
  target?: string;
  // rematch fields
  from_name?: string;
  stake?: number;
  expires_at?: string;
  game_link?: string;
  reason?: string;
}

// Outgoing message types
export interface TakeShotMessage {
  type: 'take_shot';
  data: ShotParams & {
    /** Shooter's exact ball positions at fire time. Relayed to opponent via shot_relay
     *  so both clients seed PhysicsEngine from identical state, preventing divergence. */
    balls: BallState[];
  };
}

export interface PlaceCueBallMessage {
  type: 'place_cue_ball';
  data: { x: number; y: number };
}

export interface CueBallMoveMessage {
  type: 'cue_ball_move';
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

export interface ShotCompleteMessage {
  type: 'shot_complete';
  data: {
    pocketed_balls: number[];
    first_contact_ball_id: number;
    cushion_after_contact: boolean;
    break_cushion_count: number;
  };
}

export interface SyncResponseMessage {
  type: 'sync_response';
  data: {
    /** ID of the reconnecting player who needs the physics state. */
    target: string;
    balls: BallState[];
  };
}

export interface TurnTimeoutMessage {
  type: 'turn_timeout';
  data: Record<string, never>;
}

export interface CueAimMessage {
  type: 'cue_aim';
  data: { angle: number; power: number };
}

export interface RematchRequestMessage {
  type: 'rematch_request';
  data: Record<string, never>;
}

export interface RematchAcceptMessage {
  type: 'rematch_accept';
  data: Record<string, never>;
}

export type PoolOutgoingMessage =
  | TakeShotMessage
  | PlaceCueBallMessage
  | CueBallMoveMessage
  | CueAimMessage
  | ConcedeMessage
  | GetStateMessage
  | ShotCompleteMessage
  | SyncResponseMessage
  | TurnTimeoutMessage
  | RematchRequestMessage
  | RematchAcceptMessage;

// Rematch state for the game over screen
export type RematchStatus =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'waiting_opponent'; expiresAt: string }
  | { status: 'incoming_invite'; fromName: string; stake: number; expiresAt: string }
  | { status: 'failed'; message: string }
  | { status: 'expired' };
