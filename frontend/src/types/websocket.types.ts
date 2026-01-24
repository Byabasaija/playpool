import { Card, WinType } from './game.types';        

export type WSMessageType = 
  | 'waiting_for_opponent'
  | 'game_starting'
  | 'game_state'
  | 'game_update'
  | 'card_played'
  | 'cards_drawn'
  | 'opponent_drew'
  | 'turn_passed'
  | 'player_connected'
  | 'player_disconnected'
  | 'player_idle_warning'
  | 'player_forfeit'
  | 'game_over'
  | 'error';

export interface WSMessage {
  type: WSMessageType;
  message?: string;
  game_id?: string;
  my_id?: string;
  my_hand?: Card[];
  opponent_card_count?: number;
  top_card?: Card | null;
  discard_pile_cards?: Card[] | null;
  current_suit?: Card['suit'] | null;
  target_suit?: Card['suit'];
  target_card?: Card;
  my_turn?: boolean;
  draw_stack?: number;
  deck_count?: number;
  stake_amount?: number;
  status?: string;
  winner?: string;
  win_type?: WinType;
  player_points?: number;
  opponent_points?: number;
  effect?: {
    message: string;
  };
  game_over?: boolean;
  cards?: Card[];
  count?: number;
  player?: string;
  my_display_name?: string;
  opponent_display_name?: string;
  forfeit_at?: string;
}

export interface PlayCardMessage {
  type: 'play_card';
  data: {
    card: string;
    declared_suit?: string;
  };
}

export interface DrawCardMessage {
  type: 'draw_card';
  data: Record<string, never>;
}

export interface PassTurnMessage {
  type: 'pass_turn';
  data: Record<string, never>;
}

export type OutgoingWSMessage = PlayCardMessage | DrawCardMessage | PassTurnMessage;
