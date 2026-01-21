-- Add a persistent player_token to players for a stable public identifier
ALTER TABLE players ADD COLUMN IF NOT EXISTS player_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_player_token ON players(player_token);

-- Note: existing players will be backfilled by the application on first access if player_token is NULL.
