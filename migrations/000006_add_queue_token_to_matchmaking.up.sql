-- Add queue_token to matchmaking_queue so we can track and match on external ephemeral tokens
ALTER TABLE matchmaking_queue ADD COLUMN IF NOT EXISTS queue_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_matchmaking_queue_queue_token ON matchmaking_queue(queue_token);
