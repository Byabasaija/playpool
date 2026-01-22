-- Add session_id to matchmaking_queue (idempotent)
ALTER TABLE matchmaking_queue ADD COLUMN IF NOT EXISTS session_id INT REFERENCES game_sessions(id);
CREATE INDEX IF NOT EXISTS idx_matchmaking_session_id ON matchmaking_queue(session_id);
