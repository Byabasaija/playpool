export interface StakeRequest {
  phone_number: string;
  stake_amount: number;
}

export interface StakeResponse {
  player_id: string;
  status: 'queued' | 'matched';
  game_link?: string;
  // When queued, server returns your generated display name
  display_name?: string;
  // When matched, server includes display names for both players
  my_display_name?: string;
  opponent_display_name?: string;
}

export interface QueueStatusResponse {
  status: 'queued' | 'matched' | 'not_found';
  game_link?: string;
  // When matched, include display names
  my_display_name?: string;
  opponent_display_name?: string;
}
