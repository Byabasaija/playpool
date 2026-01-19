-- Add display_name to players (down)
ALTER TABLE players
DROP COLUMN IF EXISTS display_name;
