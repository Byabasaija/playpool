-- Add game_type column to game_sessions
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS game_type VARCHAR(20) DEFAULT 'pool';

-- Add shot_data JSONB column to game_moves for pool shot parameters
ALTER TABLE game_moves ADD COLUMN IF NOT EXISTS shot_data JSONB;

-- Make card_played nullable (pool games don't use cards)
ALTER TABLE game_moves ALTER COLUMN card_played DROP NOT NULL;
