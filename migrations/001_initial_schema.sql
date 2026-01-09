-- PlayMatatu Database Schema
-- Version: 1.0
-- Run this migration to set up the initial database structure

-- ============================================
-- PLAYERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(15) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_games_played INT DEFAULT 0,
    total_games_won INT DEFAULT 0,
    total_winnings DECIMAL(12,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    is_blocked BOOLEAN DEFAULT FALSE,
    block_reason VARCHAR(100),
    block_until TIMESTAMP,
    disconnect_count INT DEFAULT 0,
    no_show_count INT DEFAULT 0,
    last_active TIMESTAMP
);

CREATE INDEX idx_players_phone ON players(phone_number);
CREATE INDEX idx_players_active ON players(is_active, is_blocked);

-- ============================================
-- TRANSACTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    player_id INT REFERENCES players(id),
    transaction_type VARCHAR(20) NOT NULL, -- 'STAKE', 'PAYOUT', 'REFUND'
    amount DECIMAL(12,2) NOT NULL,
    momo_transaction_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'COMPLETED', 'FAILED'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX idx_transactions_player ON transactions(player_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_momo ON transactions(momo_transaction_id);

-- ============================================
-- GAME SESSIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS game_sessions (
    id SERIAL PRIMARY KEY,
    game_token VARCHAR(100) UNIQUE NOT NULL,
    player1_id INT REFERENCES players(id),
    player2_id INT REFERENCES players(id),
    stake_amount DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'WAITING', -- 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FORFEIT'
    winner_id INT REFERENCES players(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    expiry_time TIMESTAMP NOT NULL
);

CREATE INDEX idx_game_sessions_token ON game_sessions(game_token);
CREATE INDEX idx_game_sessions_status ON game_sessions(status);
CREATE INDEX idx_game_sessions_players ON game_sessions(player1_id, player2_id);

-- ============================================
-- ESCROW LEDGER TABLE (Virtual Escrow)
-- ============================================
CREATE TABLE IF NOT EXISTS escrow_ledger (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES game_sessions(id),
    entry_type VARCHAR(20) NOT NULL, -- 'STAKE_IN', 'PAYOUT', 'COMMISSION', 'REFUND'
    player_id INT REFERENCES players(id),
    amount DECIMAL(12,2) NOT NULL,
    balance_after DECIMAL(12,2) NOT NULL,
    description VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_escrow_session ON escrow_ledger(session_id);
CREATE INDEX idx_escrow_type ON escrow_ledger(entry_type);

-- ============================================
-- GAME STATES TABLE (Archived after game)
-- ============================================
CREATE TABLE IF NOT EXISTS game_states (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES game_sessions(id),
    game_state JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_game_states_session ON game_states(session_id);

-- ============================================
-- GAME MOVES TABLE (Audit Trail)
-- ============================================
CREATE TABLE IF NOT EXISTS game_moves (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES game_sessions(id),
    player_id INT REFERENCES players(id),
    move_number INT NOT NULL,
    move_type VARCHAR(20) NOT NULL, -- 'PLAY_CARD', 'DRAW_CARD', 'DECLARE_SUIT', 'PASS'
    card_played VARCHAR(5), -- e.g., 'AS', '7H', 'KC'
    suit_declared VARCHAR(10), -- for 8s: 'hearts', 'diamonds', 'clubs', 'spades'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_game_moves_session ON game_moves(session_id);

-- ============================================
-- MATCHMAKING QUEUE TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS matchmaking_queue (
    id SERIAL PRIMARY KEY,
    player_id INT REFERENCES players(id),
    phone_number VARCHAR(15) NOT NULL,
    stake_amount DECIMAL(12,2) NOT NULL,
    transaction_id INT REFERENCES transactions(id),
    status VARCHAR(20) DEFAULT 'WAITING', -- 'WAITING', 'MATCHED', 'EXPIRED', 'CANCELLED'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    matched_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_matchmaking_status ON matchmaking_queue(status, stake_amount);
CREATE INDEX idx_matchmaking_player ON matchmaking_queue(player_id);

-- ============================================
-- DISPUTES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS disputes (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES game_sessions(id),
    reported_by INT REFERENCES players(id),
    dispute_type VARCHAR(50), -- 'DISCONNECTION', 'CHEATING', 'PAYMENT_ISSUE'
    description TEXT,
    status VARCHAR(20) DEFAULT 'OPEN', -- 'OPEN', 'INVESTIGATING', 'RESOLVED'
    resolution TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);

CREATE INDEX idx_disputes_session ON disputes(session_id);
CREATE INDEX idx_disputes_status ON disputes(status);
