export interface StakeRequest {
  phone_number: string;
  stake_amount: number;
  display_name?: string;
  create_private?: boolean;
  match_code?: string;
}

export interface StakeResponse {
  player_id: string;
  status: 'queued' | 'matched' | 'private_created';
  game_link?: string;
  // When queued, server returns your generated display name
  display_name?: string;
  // When matched, server includes display names for both players
  my_display_name?: string;
  opponent_display_name?: string;
  // New standardized queue token
  queue_token?: string;
  // Private match fields
  match_code?: string;
  expires_at?: string;
  queue_id?: number;
}

export interface QueueStatusResponse {
  status: 'queued' | 'matched' | 'not_found';
  game_link?: string;
  // When matched, include display names
  my_display_name?: string;
  opponent_display_name?: string;
  // Human-readable server message (e.g. 'Player not in queue')
  message?: string;
}
