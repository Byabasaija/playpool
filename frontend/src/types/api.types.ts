export interface StakeRequest {
  phone_number: string;
  stake_amount: number;
}

export interface StakeResponse {
  player_id: string;
  status: 'queued' | 'matched';
  game_link?: string;
}

export interface QueueStatusResponse {
  status: 'queued' | 'matched' | 'not_found';
  game_link?: string;
}
