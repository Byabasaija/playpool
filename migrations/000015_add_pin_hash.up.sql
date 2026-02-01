-- Add PIN authentication columns to players table
ALTER TABLE players ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pin_failed_attempts INT DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMP;

-- Index for efficient lockout checks
CREATE INDEX IF NOT EXISTS idx_players_pin_locked_until ON players(pin_locked_until) WHERE pin_locked_until IS NOT NULL;
