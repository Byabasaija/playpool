package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/redis/go-redis/v9"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/game"
)

// InitiateStake handles stake initiation from web
// For development: This is a DUMMY payment - no actual Mobile Money integration
func InitiateStake(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			PhoneNumber string `json:"phone_number" binding:"required"`
			StakeAmount int    `json:"stake_amount" binding:"required"`
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

		// DUMMY PAYMENT: Auto-approve payment (no actual Mobile Money call)
		transactionID := generateTransactionID()
		playerID := "player_" + phone[len(phone)-4:] + "_" + transactionID[:8]

		log.Printf("[DUMMY PAYMENT] Would charge %s %d UGX (transaction: %s)", 
			phone, req.StakeAmount, transactionID)

		// Try to join matchmaking queue
		matchResult, err := game.Manager.JoinQueue(playerID, phone, req.StakeAmount)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}

		if matchResult != nil {
			// Match found! Return game details with links
			log.Printf("Match found! Game %s between %s and %s", 
				matchResult.GameID, matchResult.Player1ID, matchResult.Player2ID)

			// Determine which link is for this player
			var myLink, opponentLink string
			if matchResult.Player2ID == playerID {
				myLink = matchResult.Player2Link
				opponentLink = matchResult.Player1Link
			} else {
				myLink = matchResult.Player1Link
				opponentLink = matchResult.Player2Link
			}

			// DUMMY SMS: Log what would be sent
			log.Printf("[DUMMY SMS] Would send to opponent: Click to play: %s", opponentLink)

			c.JSON(http.StatusOK, gin.H{
				"status":         "matched",
				"game_id":        matchResult.GameID,
				"game_token":     matchResult.GameToken,
				"player_id":      playerID,
				"game_link":      myLink,
				"stake_amount":   req.StakeAmount,
				"prize_amount":   int(float64(req.StakeAmount*2) * 0.9), // 10% commission
				"expires_at":     matchResult.ExpiresAt,
				"message":        "Opponent found! Click link to start game.",
				"transaction_id": transactionID,
			})
			return
		}

		// No match yet, player is in queue
		position := game.Manager.GetPlayerQueuePosition(playerID, req.StakeAmount)
		c.JSON(http.StatusOK, gin.H{
			"status":         "queued",
			"player_id":      playerID,
			"queue_position": position,
			"stake_amount":   req.StakeAmount,
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
				gameLink = "http://localhost:8000/g/" + gameState.Token + "?pt=" + gameState.Player1.PlayerToken
			} else {
				gameLink = "http://localhost:8000/g/" + gameState.Token + "?pt=" + gameState.Player2.PlayerToken
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
		playerID := c.Query("player_id")

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
			"game_id":     gameState.ID,
			"game_token":  gameState.Token,
			"player1_id":  gameState.Player1.ID,
			"player2_id":  gameState.Player2.ID,
			"stake":       gameState.StakeAmount,
			"message":     "Test game created",
		})
	}
}