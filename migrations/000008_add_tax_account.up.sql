-- Safely add 'tax' value to account_type using a new enum type and migrate the column
BEGIN;

-- Create a new enum type with the 'tax' value added (player_fee_exempt removed)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type_new') THEN
        CREATE TYPE account_type_new AS ENUM ('player_winnings', 'platform', 'escrow', 'settlement', 'tax');
    END IF;
END $$;

-- Convert the column to the new type
ALTER TABLE accounts ALTER COLUMN account_type TYPE account_type_new USING account_type::text::account_type_new;

-- Drop old type and rename the new one
DROP TYPE IF EXISTS account_type;
ALTER TYPE account_type_new RENAME TO account_type;

-- Seed tax system account if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE account_type='tax') THEN
        INSERT INTO accounts (account_type, balance, created_at, updated_at) VALUES ('tax', 0.00, NOW(), NOW());
    END IF;
END $$;

COMMIT;
