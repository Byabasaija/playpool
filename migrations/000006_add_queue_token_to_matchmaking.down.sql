-- Rollback queue_token addition
DROP INDEX IF EXISTS idx_matchmaking_queue_queue_token;
ALTER TABLE matchmaking_queue DROP COLUMN IF EXISTS queue_token;
