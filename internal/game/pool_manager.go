package game

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/playpool/backend/internal/config"
)

// RecordPoolShot records a pool shot as a game move with JSONB shot data.
func (gm *GameManager) RecordPoolShot(sessionID int, playerID int, params ShotParams) {
	if gm == nil || gm.db == nil || sessionID == 0 || playerID == 0 {
		return
	}

	shotData, err := json.Marshal(params)
	if err != nil {
		log.Printf("[DB] Failed to marshal shot params for session %d: %v", sessionID, err)
		return
	}

	var maxMove int
	if err := gm.db.Get(&maxMove, `SELECT COALESCE(MAX(move_number), 0) FROM game_moves WHERE session_id = $1`, sessionID); err != nil {
		log.Printf("[DB] Failed to get max move number for session %d: %v", sessionID, err)
		return
	}
	moveNumber := maxMove + 1

	_, err = gm.db.Exec(
		`INSERT INTO game_moves (session_id, player_id, move_number, move_type, shot_data, created_at) VALUES ($1,$2,$3,$4,$5::jsonb,NOW())`,
		sessionID, playerID, moveNumber, "TAKE_SHOT", string(shotData),
	)
	if err != nil {
		log.Printf("[DB] Failed to record pool shot for session %d: %v", sessionID, err)
	}
}

// savePoolGameToRedis saves pool game state to Redis.
func (gm *GameManager) savePoolGameToRedis(g *PoolGameState) error {
	if gm.rdb == nil {
		return nil
	}

	ctx := context.Background()
	key := "game:" + g.Token + ":state"

	gameData := map[string]interface{}{
		"id":                  g.ID,
		"token":               g.Token,
		"player1":             g.Player1,
		"player2":             g.Player2,
		"balls":               g.Balls,
		"current_turn":        g.CurrentTurn,
		"status":              g.Status,
		"winner":              g.Winner,
		"win_type":            g.WinType,
		"stake_amount":        g.StakeAmount,
		"shot_number":         g.ShotNumber,
		"is_break_shot":       g.IsBreakShot,
		"ball_in_hand":        g.BallInHand,
		"ball_in_hand_player": g.BallInHandPlayer,
		"created_at":          g.CreatedAt,
		"started_at":          g.StartedAt,
		"completed_at":        g.CompletedAt,
		"last_activity":       g.LastActivity,
		"session_id":          g.SessionID,
		"game_type":           "pool",
	}

	data, err := json.Marshal(gameData)
	if err != nil {
		return err
	}

	return gm.rdb.SetEx(ctx, key, data, time.Hour).Err()
}

// CreatePoolGameFromMatch creates a pool game from a matchmaking result.
func (gm *GameManager) CreatePoolGameFromMatch(player1, player2 QueuedPlayer, gameToken string, stake float64, cfg *config.Config) {
	gm.mu.Lock()
	defer gm.mu.Unlock()

	gameID := generateGameID()
	player1Token := generateToken(16)
	player2Token := generateToken(16)

	game := NewPoolGame(
		gameID, gameToken,
		player1.QueueToken, player1.PhoneNumber, player1Token, player1.PlayerID, player1.DisplayName,
		player2.QueueToken, player2.PhoneNumber, player2Token, player2.PlayerID, player2.DisplayName,
		int(stake),
	)

	gm.games[gameID] = game
	gm.playerToGame[player1.QueueToken] = gameID
	gm.playerToGame[player2.QueueToken] = gameID

	log.Printf("[MATCHMAKER] Pool game created: %s (token=%s)", gameID, gameToken)
}

// CreateTestPoolGame creates a test pool game for development.
func (gm *GameManager) CreateTestPoolGame(player1Phone, player2Phone string, stakeAmount int) (*PoolGameState, error) {
	gm.mu.Lock()
	defer gm.mu.Unlock()

	gameID := generateGameID()
	gameToken := generateToken(16)
	p1ID := "p1_" + generateToken(4)
	p2ID := "p2_" + generateToken(4)
	p1Token := generateToken(16)
	p2Token := generateToken(16)

	g := NewPoolGame(
		gameID, gameToken,
		p1ID, player1Phone, p1Token, 0, "Player1",
		p2ID, player2Phone, p2Token, 0, "Player2",
		stakeAmount,
	)

	gm.games[gameID] = g
	gm.playerToGame[p1ID] = gameID
	gm.playerToGame[p2ID] = gameID

	return g, nil
}

