-- Rollback accounts and account_transactions

-- Remove seeded system accounts
DELETE FROM accounts WHERE account_type IN ('platform', 'escrow', 'settlement');

-- Remove converted_to_credit_at from matchmaking_queue
ALTER TABLE matchmaking_queue DROP COLUMN IF EXISTS converted_to_credit_at;

DROP TABLE IF EXISTS account_transactions;
DROP TABLE IF EXISTS accounts;

DO $$ BEGIN
    DROP TYPE IF EXISTS account_type;
EXCEPTION
    WHEN undefined_object THEN null;
END $$;
