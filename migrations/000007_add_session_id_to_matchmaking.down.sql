-- Remove session_id from matchmaking_queue
ALTER TABLE matchmaking_queue DROP COLUMN IF EXISTS session_id;
DROP INDEX IF EXISTS idx_matchmaking_session_id;
