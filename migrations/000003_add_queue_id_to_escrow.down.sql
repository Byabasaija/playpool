-- Remove queue_id from escrow_ledger
ALTER TABLE escrow_ledger
  DROP COLUMN IF EXISTS queue_id;
