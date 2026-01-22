-- Remove match_code and is_private from matchmaking_queue
DROP INDEX IF EXISTS idx_matchmaking_queue_match_code;
ALTER TABLE matchmaking_queue DROP COLUMN IF EXISTS match_code;
ALTER TABLE matchmaking_queue DROP COLUMN IF EXISTS is_private;
