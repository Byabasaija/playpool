-- Add withdraw_requests table
CREATE TABLE IF NOT EXISTS withdraw_requests (
    id SERIAL PRIMARY KEY,
    player_id INT NOT NULL REFERENCES players(id),
    amount NUMERIC(12,2) NOT NULL,
    fee NUMERIC(12,2) NOT NULL,
    net_amount NUMERIC(12,2) NOT NULL,
    method TEXT NOT NULL,
    destination TEXT NOT NULL,
    provider_txn_id TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP NULL,
    note TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_withdraws_player ON withdraw_requests(player_id);
CREATE INDEX IF NOT EXISTS idx_withdraws_status ON withdraw_requests(status);
