export interface StakeRequest {
  phone_number: string;
  stake_amount: number;
  display_name?: string;
  create_private?: boolean;
  match_code?: string;
  invite_phone?: string;
}

export interface StakeResponse {
  player_id: string;
  status: 'queued' | 'matched' | 'private_created' | 'PENDING';
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
  // Payment fields (when status is PENDING)
  transaction_id?: string;
  dmark_transaction_id?: string;
  message?: string;
}

export interface QueueStatusResponse {
  status: 'queued' | 'matched' | 'not_found' | 'expired';
  game_link?: string;
  // When matched, include display names
  my_display_name?: string;
  opponent_display_name?: string;
  // Human-readable server message (e.g. 'Player not in queue')
  message?: string;
  // Queue token (returned when polling by phone finds an active queue)
  queue_token?: string;
}

export interface WithdrawRequestResponse {
  request_id: number;
  amount: number;
  fee: number;
  net: number;
}

export interface WithdrawRow {
  id: number;
  amount: number;
  fee: number;
  net_amount: number;
  method: string;
  destination: string;
  provider_txn_id?: string | null;
  status: string;
  created_at: string;
  processed_at?: string | null;
  note?: string | null;
}

export interface GetWithdrawsResponse {
  withdraws: WithdrawRow[];
}
