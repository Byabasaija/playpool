-- Rollback player_token
DROP INDEX IF EXISTS idx_players_player_token;
ALTER TABLE players DROP COLUMN IF EXISTS player_token;
