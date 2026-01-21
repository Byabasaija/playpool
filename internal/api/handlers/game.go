package handlers

import (
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/game"
	"github.com/redis/go-redis/v9"
)

// InitiateStake handles stake initiation from web
// For development: This is a DUMMY payment - no actual Mobile Money integration
func InitiateStake(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			PhoneNumber string `json:"phone_number" binding:"required"`
			StakeAmount int    `json:"stake_amount" binding:"required"`
			DisplayName string `json:"display_name,omitempty"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request. Phone number and stake amount required.",
			})
			return
		}

		// Validate stake amount
		minStake := 1000
		if cfg != nil && cfg.MinStakeAmount > 0 {
			minStake = cfg.MinStakeAmount
		}
		if req.StakeAmount < minStake {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Minimum stake amount is 1000 UGX",
			})
			return
		}

		// Normalize phone number
		phone := normalizePhone(req.PhoneNumber)
		if phone == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid phone number format",
			})
			return
		}

		// Upsert player by phone (create DisplayName if new)
		player, err := GetOrCreatePlayerByPhone(db, phone)
		if err != nil {
			log.Printf("[ERROR] InitiateStake - failed to upsert player %s: %v", phone, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process player"})
			return
		}

		// If client supplied a display name, validate and persist it (overrides generated/default)
		if req.DisplayName != "" {
			name := strings.TrimSpace(req.DisplayName)
			if name == "" || len(name) > 50 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid display_name"})
				return
			}
			// validation: allow letters, numbers, punctuation, symbols and space separators
			var validName = regexp.MustCompile("^[\\p{L}\\p{N}\\p{P}\\p{S}\\p{Zs}]+$")
			if !validName.MatchString(name) {
				log.Printf("[INFO] Invalid display_name attempt for phone %s: %q", phone, name)
				c.JSON(http.StatusBadRequest, gin.H{"error": "display_name contains invalid characters"})
				return
			}

			// Persist the provided name if different
			if name != player.DisplayName {
				if _, err := db.Exec(`UPDATE players SET display_name=$1 WHERE id=$2`, name, player.ID); err != nil {
					log.Printf("[DB] Failed to update display_name for player %d: %v", player.ID, err)
				} else {
					player.DisplayName = name
				}
			}
		}

		log.Printf("[INFO] InitiateStake - player: id=%d phone=%s display_name=%s", player.ID, player.PhoneNumber, player.DisplayName)

		// DUMMY PAYMENT: Auto-approve payment (no actual Mobile Money call)
		transactionID := generateTransactionID()
		playerID := "player_" + phone[len(phone)-4:] + "_" + transactionID[:8]

		log.Printf("[DUMMY PAYMENT] Would charge %s %d UGX (transaction: %s)",
			phone, req.StakeAmount+cfg.CommissionFlat, transactionID)

		// Record a transaction in DB and capture its id
		var txID int
		if db != nil {
			if err := db.QueryRowx(`INSERT INTO transactions (player_id, transaction_type, amount, status, created_at) VALUES ($1,'STAKE',$2,'COMPLETED',NOW()) RETURNING id`, player.ID, float64(req.StakeAmount+cfg.CommissionFlat)).Scan(&txID); err != nil {
				log.Printf("[DB] Failed to insert transaction for player %d: %v", player.ID, err)
				// continue - transaction best-effort for now
			}
		}

		// Insert into matchmaking_queue (durable ledger)
		var queueID int
		expiresAt := time.Now().Add(time.Duration(cfg.QueueExpiryMinutes) * time.Minute)
		if db != nil {
			insertQ := `INSERT INTO matchmaking_queue (player_id, phone_number, stake_amount, transaction_id, status, created_at, expires_at) VALUES ($1,$2,$3,$4,'queued',NOW(),$5) RETURNING id`
			if err := db.QueryRowx(insertQ, player.ID, phone, float64(req.StakeAmount), txID, expiresAt).Scan(&queueID); err != nil {
				log.Printf("[DB] Failed to insert matchmaking_queue for player %d: %v", player.ID, err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to queue player"})
				return
			}

			// Create escrow ledger entries referencing the queue row
			if _, err := db.Exec(`INSERT INTO escrow_ledger (session_id, entry_type, player_id, amount, balance_after, description, created_at, queue_id) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)`, nil, "STAKE_IN", player.ID, float64(req.StakeAmount), 0.0, "Stake held for matchmaking", queueID); err != nil {
				log.Printf("[DB] Failed to insert STAKE_IN ledger for queue %d: %v", queueID, err)
			}
			if _, err := db.Exec(`INSERT INTO escrow_ledger (session_id, entry_type, player_id, amount, balance_after, description, created_at, queue_id) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)`, nil, "COMMISSION", nil, float64(cfg.CommissionFlat), 0.0, "Platform commission (flat)", queueID); err != nil {
				log.Printf("[DB] Failed to insert COMMISSION ledger for queue %d: %v", queueID, err)
			}
		}

		// Try to match immediately using Redis (pop-before-push). If no match, push our queue id into Redis.
		if game.Manager != nil {
			matchResult, err := game.Manager.TryMatchFromRedis(req.StakeAmount, queueID, phone, player.ID, player.DisplayName)
			if err != nil {
				log.Printf("[ERROR] TryMatchFromRedis failed: %v", err)
			}
			if matchResult != nil {
				// Immediate match!
				log.Printf("Match found via Redis! Game %s between %s and %s", matchResult.GameID, matchResult.Player1ID, matchResult.Player2ID)

				// Return matched response
				var myLink string
				var myDisplayName, opponentDisplayName string
				if matchResult.Player2ID == playerID {
					myLink = matchResult.Player2Link
					myDisplayName = matchResult.Player2DisplayName
					opponentDisplayName = matchResult.Player1DisplayName
				} else {
					myLink = matchResult.Player1Link
					myDisplayName = matchResult.Player1DisplayName
					opponentDisplayName = matchResult.Player2DisplayName
				}

				c.JSON(http.StatusOK, gin.H{
					"status":                "matched",
					"game_id":               matchResult.GameID,
					"game_token":            matchResult.GameToken,
					"player_id":             playerID,
					"game_link":             myLink,
					"stake_amount":          req.StakeAmount,
					"prize_amount":          int(float64(req.StakeAmount*2) * 0.9), // 10% commission (legacy field, precise payout computed later)
					"expires_at":            matchResult.ExpiresAt,
					"message":               "Opponent found! Click link to start game.",
					"transaction_id":        transactionID,
					"my_display_name":       myDisplayName,
					"opponent_display_name": opponentDisplayName,
					"session_id":            matchResult.SessionID,
				})
				return
			}
		}

		// No immediate match - queued
		log.Printf("[QUEUE] Player queued: player=%s phone=%s stake=%d queue_id=%d", playerID, phone, req.StakeAmount, queueID)
		c.JSON(http.StatusOK, gin.H{
			"status":         "queued",
			"player_id":      playerID,
			"queue_id":       queueID,
			"stake_amount":   req.StakeAmount,
			"display_name":   player.DisplayName,
			"message":        "Payment received! Finding opponent...",
			"transaction_id": transactionID,
		})
	}
}

// CheckQueueStatus checks if a player has been matched
func CheckQueueStatus(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		playerID := c.Query("player_id")
		if playerID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "player_id required"})
			return
		}

		// Check if player is in a game
		gameState, err := game.Manager.GetGameForPlayer(playerID)
		if err == nil {
			// Player is in a game! Get their link
			var gameLink string
			if gameState.Player1.ID == playerID {
				gameLink = cfg.FrontendURL + "/g/" + gameState.Token + "?pt=" + gameState.Player1.PlayerToken
			} else {
				gameLink = cfg.FrontendURL + "/g/" + gameState.Token + "?pt=" + gameState.Player2.PlayerToken
			}

			log.Printf("[QUEUE STATUS] Player %s matched! Game: %s, Link: %s", playerID, gameState.ID, gameLink)

			c.JSON(http.StatusOK, gin.H{
				"status":       "matched",
				"game_id":      gameState.ID,
				"game_token":   gameState.Token,
				"game_link":    gameLink,
				"player_id":    playerID,
				"stake_amount": gameState.StakeAmount,
				"prize_amount": int(float64(gameState.StakeAmount*2) * 0.9),
				"expires_at":   gameState.ExpiresAt,
				"message":      "Opponent found! Click link to play.",
			})
			return
		}

		// Check if still in queue
		if game.Manager.IsPlayerInQueue(playerID) {
			log.Printf("[QUEUE STATUS] Player %s still in queue", playerID)
			c.JSON(http.StatusOK, gin.H{
				"status":  "queued",
				"message": "Still waiting for opponent...",
			})
			return
		}

		// Not in queue or game
		log.Printf("[QUEUE STATUS] Player %s not found in queue or game", playerID)
		c.JSON(http.StatusOK, gin.H{
			"status":  "not_found",
			"message": "Player not in queue. Please stake again.",
		})
	}
}

// GetGameState returns current game state for a player
func GetGameState(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.Param("token")
		playerID := c.Query("pt")

		// Get game by token
		gameState, err := game.Manager.GetGameByToken(token)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Game not found",
			})
			return
		}

		if playerID == "" {
			// Return basic game info without player-specific data
			c.JSON(http.StatusOK, gin.H{
				"game_id":      gameState.ID,
				"status":       gameState.Status,
				"stake_amount": gameState.StakeAmount,
				"created_at":   gameState.CreatedAt,
			})
			return
		}

		// Return player-specific game state
		state := gameState.GetGameStateForPlayer(playerID)
		c.JSON(http.StatusOK, state)
	}
}

// GetPlayerStats returns player statistics
func GetPlayerStats(db *sqlx.DB, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		phone := c.Param("phone")

		// TODO: Get actual player stats from database
		// For now, return mock stats
		c.JSON(http.StatusOK, gin.H{
			"phone_number":   phone,
			"games_played":   5,
			"games_won":      3,
			"win_rate":       60.0,
			"total_winnings": 5400,
			"current_streak": 2,
			"rank":           "Bronze",
		})
	}
}

// GetQueueStatus returns the current matchmaking queue status
func GetQueueStatus(rdb *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		status := game.Manager.GetQueueStatus()
		activeGames := game.Manager.GetActiveGameCount()

		c.JSON(http.StatusOK, gin.H{
			"queue_by_stake": status,
			"active_games":   activeGames,
		})
	}
}

// CreateTestGame creates a game for testing (dev mode only)
func CreateTestGame(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			StakeAmount int `json:"stake_amount"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			req.StakeAmount = 1000 // default
		}

		// Create a test game with two dummy players
		gameState, err := game.Manager.CreateTestGame(
			"+256700111111",
			"+256700222222",
			req.StakeAmount,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"game_id":    gameState.ID,
			"game_token": gameState.Token,
			"player1_id": gameState.Player1.ID,
			"player2_id": gameState.Player2.ID,
			"stake":      gameState.StakeAmount,
			"message":    "Test game created",
		})
	}
}
