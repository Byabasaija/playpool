-- Re-add card game specific columns to game_moves
ALTER TABLE game_moves ADD COLUMN IF NOT EXISTS card_played VARCHAR(10);
ALTER TABLE game_moves ADD COLUMN IF NOT EXISTS suit_declared VARCHAR(10);
