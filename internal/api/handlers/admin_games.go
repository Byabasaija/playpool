package handlers

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/admin"
)

// GetAdminGames returns a paginated list of games with filters
func GetAdminGames(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		status := c.DefaultQuery("status", "all")
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
		if limit > 200 {
			limit = 200
		}

		type gameRow struct {
			ID          int     `db:"id" json:"id"`
			GameToken   string  `db:"game_token" json:"game_token"`
			Player1Name *string `db:"player1_name" json:"player1_name"`
			Player2Name *string `db:"player2_name" json:"player2_name"`
			Player1ID   *int    `db:"player1_id" json:"player1_id"`
			Player2ID   *int    `db:"player2_id" json:"player2_id"`
			StakeAmount float64 `db:"stake_amount" json:"stake_amount"`
			Status      string  `db:"status" json:"status"`
			WinnerID    *int    `db:"winner_id" json:"winner_id"`
			CreatedAt   string  `db:"created_at" json:"created_at"`
			CompletedAt *string `db:"completed_at" json:"completed_at"`
			TotalCount  int     `db:"total_count" json:"-"`
		}

		query := `
			SELECT gs.id, gs.game_token,
				p1.display_name as player1_name,
				p2.display_name as player2_name,
				gs.player1_id, gs.player2_id,
				gs.stake_amount, gs.status, gs.winner_id,
				to_char(gs.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
				to_char(gs.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as completed_at,
				COUNT(*) OVER() as total_count
			FROM game_sessions gs
			LEFT JOIN players p1 ON gs.player1_id = p1.id
			LEFT JOIN players p2 ON gs.player2_id = p2.id
			WHERE ($1 = 'all'
				OR ($1 = 'waiting' AND gs.status = 'WAITING')
				OR ($1 = 'active' AND gs.status = 'IN_PROGRESS')
				OR ($1 = 'completed' AND gs.status = 'COMPLETED')
				OR ($1 = 'cancelled' AND gs.status = 'CANCELLED'))
			ORDER BY gs.created_at DESC
			LIMIT $2 OFFSET $3
		`

		var rows []gameRow
		err := db.Select(&rows, query, status, limit, offset)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch games: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch games"})
			return
		}

		total := 0
		if len(rows) > 0 {
			total = rows[0].TotalCount
		}

		c.JSON(http.StatusOK, gin.H{"games": rows, "total": total, "limit": limit, "offset": offset})
	}
}

// GetAdminGameDetail returns full detail for a single game
func GetAdminGameDetail(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		gameID := c.Param("id")

		type gameDetail struct {
			ID          int     `db:"id" json:"id"`
			GameToken   string  `db:"game_token" json:"game_token"`
			Player1ID   *int    `db:"player1_id" json:"player1_id"`
			Player2ID   *int    `db:"player2_id" json:"player2_id"`
			Player1Name *string `db:"player1_name" json:"player1_name"`
			Player2Name *string `db:"player2_name" json:"player2_name"`
			Player1Phone *string `db:"player1_phone" json:"player1_phone"`
			Player2Phone *string `db:"player2_phone" json:"player2_phone"`
			StakeAmount float64 `db:"stake_amount" json:"stake_amount"`
			Status      string  `db:"status" json:"status"`
			WinnerID    *int    `db:"winner_id" json:"winner_id"`
			CreatedAt   string  `db:"created_at" json:"created_at"`
			StartedAt   *string `db:"started_at" json:"started_at"`
			CompletedAt *string `db:"completed_at" json:"completed_at"`
			ExpiryTime  string  `db:"expiry_time" json:"expiry_time"`
		}

		var game gameDetail
		err := db.Get(&game, `
			SELECT gs.id, gs.game_token,
				gs.player1_id, gs.player2_id,
				p1.display_name as player1_name,
				p2.display_name as player2_name,
				p1.phone_number as player1_phone,
				p2.phone_number as player2_phone,
				gs.stake_amount, gs.status, gs.winner_id,
				to_char(gs.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
				to_char(gs.started_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as started_at,
				to_char(gs.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as completed_at,
				to_char(gs.expiry_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as expiry_time
			FROM game_sessions gs
			LEFT JOIN players p1 ON gs.player1_id = p1.id
			LEFT JOIN players p2 ON gs.player2_id = p2.id
			WHERE gs.id = $1
		`, gameID)
		if err != nil {
			log.Printf("[ADMIN] Game not found: %v", err)
			c.JSON(http.StatusNotFound, gin.H{"error": "Game not found"})
			return
		}

		// Get moves
		type moveRow struct {
			ID           int     `db:"id" json:"id"`
			PlayerID     int     `db:"player_id" json:"player_id"`
			PlayerName   *string `db:"player_name" json:"player_name"`
			MoveNumber   int     `db:"move_number" json:"move_number"`
			MoveType     string  `db:"move_type" json:"move_type"`
			CardPlayed   *string `db:"card_played" json:"card_played"`
			SuitDeclared *string `db:"suit_declared" json:"suit_declared"`
			CreatedAt    string  `db:"created_at" json:"created_at"`
		}
		var moves []moveRow
		_ = db.Select(&moves, `
			SELECT gm.id, gm.player_id,
				p.display_name as player_name,
				gm.move_number, gm.move_type, gm.card_played, gm.suit_declared,
				to_char(gm.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
			FROM game_moves gm
			LEFT JOIN players p ON gm.player_id = p.id
			WHERE gm.session_id = $1
			ORDER BY gm.move_number ASC
		`, gameID)

		c.JSON(http.StatusOK, gin.H{"game": game, "moves": moves})
	}
}

// AdminCancelGame cancels a stuck game and refunds escrow
func AdminCancelGame(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.GetString("admin_username")
		gameID := c.Param("id")

		var req struct {
			Reason string `json:"reason" binding:"required"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Reason is required"})
			return
		}

		// Verify game exists and is cancellable
		var currentStatus string
		err := db.Get(&currentStatus, `SELECT status FROM game_sessions WHERE id = $1`, gameID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Game not found"})
			return
		}

		if currentStatus != "WAITING" && currentStatus != "IN_PROGRESS" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Can only cancel WAITING or IN_PROGRESS games"})
			return
		}

		// Check if already refunded (idempotency)
		var refundCount int
		_ = db.Get(&refundCount, `SELECT COUNT(*) FROM escrow_ledger WHERE session_id = $1 AND entry_type = 'SESSION_CANCEL'`, gameID)
		if refundCount > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Game already cancelled/refunded"})
			return
		}

		// Use a transaction for atomicity
		tx, err := db.Beginx()
		if err != nil {
			log.Printf("[ADMIN] Failed to begin transaction: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to cancel game"})
			return
		}
		defer tx.Rollback()

		// Get game session details for refund
		var sessionID int
		var player1ID, player2ID *int
		var stakeAmount float64
		err = tx.QueryRowx(`
			SELECT id, player1_id, player2_id, stake_amount FROM game_sessions WHERE id = $1 FOR UPDATE
		`, gameID).Scan(&sessionID, &player1ID, &player2ID, &stakeAmount)
		if err != nil {
			log.Printf("[ADMIN] Failed to lock game session: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to cancel game"})
			return
		}

		// Refund each player's stake from escrow
		players := []*int{player1ID, player2ID}
		for _, pid := range players {
			if pid == nil {
				continue
			}

			// Credit player's winnings account
			_, err = tx.Exec(`
				UPDATE accounts SET balance = balance + $1, updated_at = NOW()
				WHERE account_type = 'player_winnings' AND owner_player_id = $2
			`, stakeAmount, *pid)
			if err != nil {
				log.Printf("[ADMIN] Failed to refund player %d: %v", *pid, err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refund player"})
				return
			}

			// Debit escrow
			_, err = tx.Exec(`
				UPDATE accounts SET balance = balance - $1, updated_at = NOW()
				WHERE account_type = 'escrow'
			`, stakeAmount)
			if err != nil {
				log.Printf("[ADMIN] Failed to debit escrow: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process refund"})
				return
			}

			// Record escrow ledger entry
			_, err = tx.Exec(`
				INSERT INTO escrow_ledger (session_id, entry_type, player_id, amount, balance_after, description, created_at)
				VALUES ($1, 'SESSION_CANCEL', $2, $3, 0, $4, NOW())
			`, sessionID, *pid, stakeAmount, "Admin cancelled: "+req.Reason)
			if err != nil {
				log.Printf("[ADMIN] Failed to create escrow ledger entry: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record refund"})
				return
			}

			// Record account transaction
			_, err = tx.Exec(`
				INSERT INTO account_transactions (debit_account_id, credit_account_id, amount, reference_type, reference_id, description)
				SELECT
					(SELECT id FROM accounts WHERE account_type = 'escrow' LIMIT 1),
					(SELECT id FROM accounts WHERE account_type = 'player_winnings' AND owner_player_id = $1),
					$2, 'game_session', $3, $4
			`, *pid, stakeAmount, sessionID, "Admin cancel refund: "+req.Reason)
			if err != nil {
				log.Printf("[ADMIN] Failed to record account transaction: %v", err)
				// Non-critical, continue
			}
		}

		// Update game status
		_, err = tx.Exec(`
			UPDATE game_sessions SET status = 'CANCELLED', completed_at = NOW() WHERE id = $1
		`, gameID)
		if err != nil {
			log.Printf("[ADMIN] Failed to update game status: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update game status"})
			return
		}

		if err := tx.Commit(); err != nil {
			log.Printf("[ADMIN] Failed to commit cancel transaction: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to cancel game"})
			return
		}

		admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/games/"+gameID+"/cancel", "cancel_game", map[string]interface{}{"game_id": gameID, "reason": req.Reason}, true)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}
