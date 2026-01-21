-- Add accounts and account_transactions

-- Create account_type enum
DO $$ BEGIN
    CREATE TYPE account_type AS ENUM ('player_fee_exempt', 'player_winnings', 'platform', 'escrow', 'settlement');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    account_type account_type NOT NULL,
    owner_player_id INTEGER NULL REFERENCES players(id) ON DELETE SET NULL,
    balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_owner_type ON accounts(owner_player_id, account_type);

CREATE TABLE IF NOT EXISTS account_transactions (
    id SERIAL PRIMARY KEY,
    debit_account_id INTEGER NULL REFERENCES accounts(id) ON DELETE SET NULL,
    credit_account_id INTEGER NULL REFERENCES accounts(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    reference_type VARCHAR(50),
    reference_id INTEGER,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add converted_to_credit_at to matchmaking_queue for idempotent expiry conversions
ALTER TABLE matchmaking_queue ADD COLUMN IF NOT EXISTS converted_to_credit_at TIMESTAMP NULL;

-- Seed system accounts (platform, escrow, settlement) if not present
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE account_type='platform') THEN
        INSERT INTO accounts (account_type, balance, created_at, updated_at) VALUES ('platform', 0.00, NOW(), NOW());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE account_type='escrow') THEN
        INSERT INTO accounts (account_type, balance, created_at, updated_at) VALUES ('escrow', 0.00, NOW(), NOW());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE account_type='settlement') THEN
        INSERT INTO accounts (account_type, balance, created_at, updated_at) VALUES ('settlement', 0.00, NOW(), NOW());
    END IF;
END $$;
