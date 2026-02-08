export interface AdminPlayer {
  id: number;
  phone_number: string;
  display_name: string;
  total_games_played: number;
  total_games_won: number;
  total_games_drawn: number;
  total_winnings: number;
  is_active: boolean;
  is_blocked: boolean;
  block_reason?: string;
  block_until?: string;
  disconnect_count: number;
  no_show_count: number;
  last_active?: string;
  created_at: string;
}

export interface AdminPlayerDetail extends AdminPlayer {
  balance: number;
  recent_games: AdminGameSession[];
  recent_transactions: AdminTransaction[];
}

export interface AdminGameSession {
  id: number;
  game_token: string;
  player1_id: number;
  player2_id?: number;
  player1_phone?: string;
  player1_name?: string;
  player2_phone?: string;
  player2_name?: string;
  stake_amount: number;
  status: string;
  winner_id?: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface AdminGameMove {
  id: number;
  session_id: number;
  player_id: number;
  move_number: number;
  move_type: string;
  card_played?: string;
  suit_declared?: string;
  created_at: string;
}

export interface AdminTransaction {
  id: number;
  player_id: number;
  transaction_type: string;
  amount: number;
  momo_transaction_id?: string;
  status: string;
  created_at: string;
  completed_at?: string;
}

export interface AdminAccountBalance {
  id: number;
  account_type: string;
  owner_player_id?: number;
  balance: number;
  created_at: string;
  updated_at: string;
}

export interface AccountTransaction {
  id: number;
  debit_account_id?: number;
  credit_account_id?: number;
  amount: number;
  reference_type?: string;
  reference_id?: number;
  description?: string;
  created_at: string;
}

export interface AdminStats {
  account_balances?: Record<string, number>;
  total_games?: number;
  active_games?: number;
  completed_games?: number;
  total_players?: number;
  pending_withdrawals?: number;
}

export interface AdminAuditEntry {
  id: number;
  admin_phone?: string;
  admin_username?: string;
  ip?: string;
  route?: string;
  action?: string;
  details?: string;
  success?: boolean;
  created_at: string;
}

export interface RuntimeConfigEntry {
  key: string;
  value: string;
  value_type: string;
  description?: string;
  updated_by?: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}
