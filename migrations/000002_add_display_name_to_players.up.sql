-- Add display_name to players (up)
ALTER TABLE players
ADD COLUMN IF NOT EXISTS display_name VARCHAR(50) DEFAULT '';
