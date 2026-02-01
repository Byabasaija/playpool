-- Remove PIN authentication columns from players table
DROP INDEX IF EXISTS idx_players_pin_locked_until;
ALTER TABLE players DROP COLUMN IF EXISTS pin_locked_until;
ALTER TABLE players DROP COLUMN IF EXISTS pin_failed_attempts;
ALTER TABLE players DROP COLUMN IF EXISTS pin_hash;
