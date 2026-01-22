-- Add match_code (unique) and is_private flag to matchmaking_queue
ALTER TABLE matchmaking_queue ADD COLUMN IF NOT EXISTS match_code TEXT;
ALTER TABLE matchmaking_queue ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_matchmaking_queue_match_code ON matchmaking_queue(match_code);
