-- Add queue_id to escrow_ledger so ledger entries can reference pending queue rows
ALTER TABLE escrow_ledger
  ADD COLUMN IF NOT EXISTS queue_id INT REFERENCES matchmaking_queue(id);

-- Optional: add account_id column later for platform accounts
