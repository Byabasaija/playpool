-- Drop card game specific columns from game_moves
ALTER TABLE game_moves DROP COLUMN IF EXISTS card_played;
ALTER TABLE game_moves DROP COLUMN IF EXISTS suit_declared;
