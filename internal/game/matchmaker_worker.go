package game

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/playpool/backend/internal/config"
	"github.com/playpool/backend/internal/sms"
	"github.com/redis/go-redis/v9"
)

// QueuedPlayer represents a player waiting in the matchmaking queue
type QueuedPlayer struct {
	ID          int     `db:"id"`
	PlayerID    int     `db:"player_id"`
	PhoneNumber string  `db:"phone_number"`
	StakeAmount float64 `db:"stake_amount"`
	QueueToken  string  `db:"queue_token"`
	DisplayName string  `db:"display_name"`
}

// StartMatchmakerWorker runs a background job to match players from the DB queue
func StartMatchmakerWorker(ctx context.Context, db *sqlx.DB, rdb *redis.Client, cfg *config.Config) {
	interval := time.Duration(cfg.MatchmakerPollSeconds) * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	log.Printf("[MATCHMAKER] Starting matchmaker worker (poll every %v)", interval)

	for {
		select {
		case <-ctx.Done():
			log.Printf("[MATCHMAKER] Worker stopped")
			return
		case <-ticker.C:
			processMatchmaking(ctx, db, rdb, cfg)
		}
	}
}

func processMatchmaking(ctx context.Context, db *sqlx.DB, rdb *redis.Client, cfg *config.Config) {
	// Get distinct stake amounts with queued players
	var stakes []float64
	err := db.Select(&stakes, `
		SELECT DISTINCT stake_amount
		FROM matchmaking_queue
		WHERE status = 'queued'
		  AND expires_at > NOW()
		ORDER BY stake_amount
	`)
	if err != nil {
		log.Printf("[MATCHMAKER] Failed to get stake levels: %v", err)
		return
	}

	if len(stakes) == 0 {
		return // No queued players
	}

	for _, stake := range stakes {
		matchPairsAtStake(ctx, db, rdb, cfg, stake)
	}
}

func matchPairsAtStake(ctx context.Context, db *sqlx.DB, rdb *redis.Client, cfg *config.Config, stake float64) {
	for {
		// Try to match a pair at this stake level
		matched := tryMatchPair(ctx, db, rdb, cfg, stake)
		if !matched {
			return // No more pairs available at this stake
		}
	}
}

func tryMatchPair(ctx context.Context, db *sqlx.DB, rdb *redis.Client, cfg *config.Config, stake float64) bool {
	tx, err := db.BeginTxx(ctx, nil)
	if err != nil {
		log.Printf("[MATCHMAKER] Failed to begin transaction: %v", err)
		return false
	}
	defer tx.Rollback()

	// Claim two players with same stake, different phones
	// FOR UPDATE SKIP LOCKED ensures atomic claim without blocking
	var players []QueuedPlayer
	err = tx.Select(&players, `
		SELECT mq.id, mq.player_id, mq.phone_number, mq.stake_amount, mq.queue_token,
		       COALESCE(p.display_name, '') as display_name
		FROM matchmaking_queue mq
		JOIN players p ON mq.player_id = p.id
		WHERE mq.stake_amount = $1
		  AND mq.status = 'queued'
		  AND mq.expires_at > NOW()
		ORDER BY mq.created_at
		FOR UPDATE SKIP LOCKED
		LIMIT 2
	`, stake)

	if err != nil {
		log.Printf("[MATCHMAKER] Failed to query queued players: %v", err)
		return false
	}

	if len(players) < 2 {
		return false // Not enough players
	}

	// Check for self-match (same phone)
	if players[0].PhoneNumber == players[1].PhoneNumber {
		log.Printf("[MATCHMAKER] Skipping self-match for phone %s", players[0].PhoneNumber)
		return false
	}

	log.Printf("[MATCHMAKER] Matching players: %d vs %d (stake=%.2f)",
		players[0].PlayerID, players[1].PlayerID, stake)

	// Generate game token
	gameToken := generateGameToken()
	expiryTime := time.Now().Add(time.Duration(cfg.GameExpiryMinutes) * time.Minute)

	// Create game session in DB
	var sessionID int
	err = tx.QueryRow(`
		INSERT INTO game_sessions (game_token, player1_id, player2_id, stake_amount, status, created_at, expiry_time)
		VALUES ($1, $2, $3, $4, 'WAITING', NOW(), $5)
		RETURNING id
	`, gameToken, players[0].PlayerID, players[1].PlayerID, stake, expiryTime).Scan(&sessionID)

	if err != nil {
		log.Printf("[MATCHMAKER] Failed to create game session: %v", err)
		return false
	}

	// Update both queue entries to matched
	_, err = tx.Exec(`
		UPDATE matchmaking_queue
		SET status = 'matched', matched_at = NOW(), session_id = $1
		WHERE queue_token IN ($2, $3)
	`, sessionID, players[0].QueueToken, players[1].QueueToken)

	if err != nil {
		log.Printf("[MATCHMAKER] Failed to update queue entries: %v", err)
		return false
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[MATCHMAKER] Failed to commit: %v", err)
		return false
	}

	log.Printf("[MATCHMAKER] ✓ Match created: session=%d token=%s players=[%d,%d]",
		sessionID, gameToken, players[0].PlayerID, players[1].PlayerID)

	// Create in-memory pool game for WebSocket play
	Manager.CreatePoolGameFromMatch(players[0], players[1], gameToken, stake, cfg)

	// Send SMS to both players
	go sendMatchSMS(cfg, gameToken, players[0], players[1])

	return true
}

func sendMatchSMS(cfg *config.Config, gameToken string, player1, player2 QueuedPlayer) {
	if sms.Default == nil {
		log.Printf("[MATCHMAKER] SMS client not configured, skipping notifications")
		return
	}

	gameLink := fmt.Sprintf("%s/game/%s", cfg.FrontendURL, gameToken)

	// Get opponent names for personalized messages
	p1Opponent := player2.DisplayName
	if p1Opponent == "" {
		p1Opponent = "an opponent"
	}
	p2Opponent := player1.DisplayName
	if p2Opponent == "" {
		p2Opponent = "an opponent"
	}

	// Send to player 1
	msg1 := fmt.Sprintf("PlayMatatu: Match found! Playing against %s for %.0f UGX.\n\n%s",
		p1Opponent, player1.StakeAmount, gameLink)
	if _, err := sms.SendSMS(context.Background(), player1.PhoneNumber, msg1); err != nil {
		log.Printf("[MATCHMAKER] Failed to send SMS to player %d: %v", player1.PlayerID, err)
	}

	// Send to player 2
	msg2 := fmt.Sprintf("PlayMatatu: Match found! Playing against %s for %.0f UGX.\n\n%s",
		p2Opponent, player2.StakeAmount, gameLink)
	if _, err := sms.SendSMS(context.Background(), player2.PhoneNumber, msg2); err != nil {
		log.Printf("[MATCHMAKER] Failed to send SMS to player %d: %v", player2.PlayerID, err)
	}

	log.Printf("[MATCHMAKER] SMS notifications sent for game %s", gameToken)
}

func generateGameToken() string {
	return fmt.Sprintf("g_%d", time.Now().UnixNano())
}
