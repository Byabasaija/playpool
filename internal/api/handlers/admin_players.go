package handlers

import (
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/admin"
)

// GetAdminPlayers returns a paginated list of players with search
func GetAdminPlayers(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.GetString("admin_username")

		q := c.DefaultQuery("q", "")
		status := c.DefaultQuery("status", "all")
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
		if limit > 200 {
			limit = 200
		}

		type playerRow struct {
			ID               int      `db:"id" json:"id"`
			PhoneNumber      string   `db:"phone_number" json:"phone_number"`
			DisplayName      string   `db:"display_name" json:"display_name"`
			TotalGamesPlayed int      `db:"total_games_played" json:"total_games_played"`
			TotalGamesWon    int      `db:"total_games_won" json:"total_games_won"`
			TotalGamesDrawn  int      `db:"total_games_drawn" json:"total_games_drawn"`
			TotalWinnings    float64  `db:"total_winnings" json:"total_winnings"`
			IsActive         bool     `db:"is_active" json:"is_active"`
			IsBlocked        bool     `db:"is_blocked" json:"is_blocked"`
			BlockReason      *string  `db:"block_reason" json:"block_reason"`
			DisconnectCount  int      `db:"disconnect_count" json:"disconnect_count"`
			NoShowCount      int      `db:"no_show_count" json:"no_show_count"`
			LastActive       *string  `db:"last_active" json:"last_active"`
			CreatedAt        string   `db:"created_at" json:"created_at"`
			TotalCount       int      `db:"total_count" json:"-"`
		}

		query := `
			SELECT id, phone_number, display_name, total_games_played, total_games_won,
				total_games_drawn, total_winnings, is_active, is_blocked,
				block_reason, disconnect_count, no_show_count,
				to_char(last_active, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_active,
				to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
				COUNT(*) OVER() as total_count
			FROM players
			WHERE ($1 = '' OR phone_number ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%')
				AND ($2 = 'all' OR ($2 = 'blocked' AND is_blocked = true) OR ($2 = 'active' AND is_blocked = false))
			ORDER BY created_at DESC
			LIMIT $3 OFFSET $4
		`

		var rows []playerRow
		err := db.Select(&rows, query, q, status, limit, offset)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch players: %v", err)
			admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/players", "get_players", nil, false)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch players"})
			return
		}

		total := 0
		if len(rows) > 0 {
			total = rows[0].TotalCount
		}

		admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/players", "get_players", map[string]interface{}{"count": len(rows), "q": q}, true)
		c.JSON(http.StatusOK, gin.H{"players": rows, "total": total, "limit": limit, "offset": offset})
	}
}

// GetAdminPlayerDetail returns full detail for a single player
func GetAdminPlayerDetail(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.GetString("admin_username")
		playerID := c.Param("id")

		type playerDetail struct {
			ID               int     `db:"id" json:"id"`
			PhoneNumber      string  `db:"phone_number" json:"phone_number"`
			DisplayName      string  `db:"display_name" json:"display_name"`
			TotalGamesPlayed int     `db:"total_games_played" json:"total_games_played"`
			TotalGamesWon    int     `db:"total_games_won" json:"total_games_won"`
			TotalGamesDrawn  int     `db:"total_games_drawn" json:"total_games_drawn"`
			TotalWinnings    float64 `db:"total_winnings" json:"total_winnings"`
			IsActive         bool    `db:"is_active" json:"is_active"`
			IsBlocked        bool    `db:"is_blocked" json:"is_blocked"`
			BlockReason      *string `db:"block_reason" json:"block_reason"`
			BlockUntil       *string `db:"block_until" json:"block_until"`
			DisconnectCount  int     `db:"disconnect_count" json:"disconnect_count"`
			NoShowCount      int     `db:"no_show_count" json:"no_show_count"`
			LastActive       *string `db:"last_active" json:"last_active"`
			CreatedAt        string  `db:"created_at" json:"created_at"`
		}

		var player playerDetail
		err := db.Get(&player, `
			SELECT id, phone_number, display_name, total_games_played, total_games_won,
				total_games_drawn, total_winnings, is_active, is_blocked,
				block_reason,
				to_char(block_until, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as block_until,
				disconnect_count, no_show_count,
				to_char(last_active, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_active,
				to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
			FROM players WHERE id = $1
		`, playerID)
		if err != nil {
			log.Printf("[ADMIN] Player not found: %v", err)
			c.JSON(http.StatusNotFound, gin.H{"error": "Player not found"})
			return
		}

		// Get player balance (player_winnings account)
		var balance float64
		_ = db.Get(&balance, `SELECT COALESCE(balance, 0) FROM accounts WHERE account_type='player_winnings' AND owner_player_id=$1`, playerID)

		// Get recent games
		type gameRow struct {
			ID          int     `db:"id" json:"id"`
			GameToken   string  `db:"game_token" json:"game_token"`
			StakeAmount float64 `db:"stake_amount" json:"stake_amount"`
			Status      string  `db:"status" json:"status"`
			WinnerID    *int    `db:"winner_id" json:"winner_id"`
			CreatedAt   string  `db:"created_at" json:"created_at"`
			CompletedAt *string `db:"completed_at" json:"completed_at"`
		}
		var recentGames []gameRow
		_ = db.Select(&recentGames, `
			SELECT gs.id, gs.game_token, gs.stake_amount, gs.status,
				gs.winner_id,
				to_char(gs.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
				to_char(gs.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as completed_at
			FROM game_sessions gs
			WHERE gs.player1_id = $1 OR gs.player2_id = $1
			ORDER BY gs.created_at DESC
			LIMIT 20
		`, playerID)

		// Get recent transactions
		type txnRow struct {
			ID              int     `db:"id" json:"id"`
			TransactionType string  `db:"transaction_type" json:"transaction_type"`
			Amount          float64 `db:"amount" json:"amount"`
			Status          string  `db:"status" json:"status"`
			CreatedAt       string  `db:"created_at" json:"created_at"`
		}
		var recentTransactions []txnRow
		_ = db.Select(&recentTransactions, `
			SELECT id, transaction_type, amount, status,
				to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
			FROM transactions
			WHERE player_id = $1
			ORDER BY created_at DESC
			LIMIT 20
		`, playerID)

		admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/players/"+playerID, "get_player_detail", map[string]interface{}{"player_id": playerID}, true)
		c.JSON(http.StatusOK, gin.H{
			"player":              player,
			"balance":             balance,
			"recent_games":        recentGames,
			"recent_transactions": recentTransactions,
		})
	}
}

// AdminBlockPlayer blocks a player
func AdminBlockPlayer(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.GetString("admin_username")
		playerID := c.Param("id")

		var req struct {
			Reason        string `json:"reason" binding:"required"`
			DurationHours *int   `json:"duration_hours"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Reason is required"})
			return
		}

		var blockUntil *time.Time
		if req.DurationHours != nil && *req.DurationHours > 0 {
			t := time.Now().Add(time.Duration(*req.DurationHours) * time.Hour)
			blockUntil = &t
		}

		_, err := db.Exec(`
			UPDATE players SET is_blocked = true, block_reason = $1, block_until = $2
			WHERE id = $3
		`, req.Reason, blockUntil, playerID)
		if err != nil {
			log.Printf("[ADMIN] Failed to block player %s: %v", playerID, err)
			admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/players/"+playerID+"/block", "block_player", map[string]interface{}{"player_id": playerID, "reason": req.Reason}, false)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to block player"})
			return
		}

		admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/players/"+playerID+"/block", "block_player", map[string]interface{}{"player_id": playerID, "reason": req.Reason, "duration_hours": req.DurationHours}, true)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// AdminUnblockPlayer unblocks a player
func AdminUnblockPlayer(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.GetString("admin_username")
		playerID := c.Param("id")

		_, err := db.Exec(`
			UPDATE players SET is_blocked = false, block_reason = NULL, block_until = NULL
			WHERE id = $1
		`, playerID)
		if err != nil {
			log.Printf("[ADMIN] Failed to unblock player %s: %v", playerID, err)
			admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/players/"+playerID+"/unblock", "unblock_player", map[string]interface{}{"player_id": playerID}, false)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unblock player"})
			return
		}

		admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/players/"+playerID+"/unblock", "unblock_player", map[string]interface{}{"player_id": playerID}, true)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// AdminResetPlayerPIN clears a player's PIN
func AdminResetPlayerPIN(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.GetString("admin_username")
		playerID := c.Param("id")

		_, err := db.Exec(`
			UPDATE players SET pin_hash = NULL, pin_failed_attempts = 0, pin_locked_until = NULL
			WHERE id = $1
		`, playerID)
		if err != nil {
			log.Printf("[ADMIN] Failed to reset PIN for player %s: %v", playerID, err)
			admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/players/"+playerID+"/reset-pin", "reset_pin", map[string]interface{}{"player_id": playerID}, false)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reset PIN"})
			return
		}

		admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/players/"+playerID+"/reset-pin", "reset_pin", map[string]interface{}{"player_id": playerID}, true)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// GetAdminPlayerGames returns paginated game history for a player
func GetAdminPlayerGames(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		playerID := c.Param("id")
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
		if limit > 200 {
			limit = 200
		}

		type gameRow struct {
			ID          int     `db:"id" json:"id"`
			GameToken   string  `db:"game_token" json:"game_token"`
			Player1Name *string `db:"player1_name" json:"player1_name"`
			Player2Name *string `db:"player2_name" json:"player2_name"`
			StakeAmount float64 `db:"stake_amount" json:"stake_amount"`
			Status      string  `db:"status" json:"status"`
			WinnerID    *int    `db:"winner_id" json:"winner_id"`
			CreatedAt   string  `db:"created_at" json:"created_at"`
			CompletedAt *string `db:"completed_at" json:"completed_at"`
			TotalCount  int     `db:"total_count" json:"-"`
		}

		var games []gameRow
		err := db.Select(&games, `
			SELECT gs.id, gs.game_token,
				p1.display_name as player1_name,
				p2.display_name as player2_name,
				gs.stake_amount, gs.status, gs.winner_id,
				to_char(gs.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
				to_char(gs.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as completed_at,
				COUNT(*) OVER() as total_count
			FROM game_sessions gs
			LEFT JOIN players p1 ON gs.player1_id = p1.id
			LEFT JOIN players p2 ON gs.player2_id = p2.id
			WHERE gs.player1_id = $1 OR gs.player2_id = $1
			ORDER BY gs.created_at DESC
			LIMIT $2 OFFSET $3
		`, playerID, limit, offset)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch player games: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch games"})
			return
		}

		total := 0
		if len(games) > 0 {
			total = games[0].TotalCount
		}

		c.JSON(http.StatusOK, gin.H{"games": games, "total": total, "limit": limit, "offset": offset})
	}
}

// GetAdminPlayerTransactions returns paginated transaction history for a player
func GetAdminPlayerTransactions(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		playerID := c.Param("id")
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
		if limit > 200 {
			limit = 200
		}

		type txnRow struct {
			ID              int     `db:"id" json:"id"`
			TransactionType string  `db:"transaction_type" json:"transaction_type"`
			Amount          float64 `db:"amount" json:"amount"`
			Status          string  `db:"status" json:"status"`
			CreatedAt       string  `db:"created_at" json:"created_at"`
			CompletedAt     *string `db:"completed_at" json:"completed_at"`
			TotalCount      int     `db:"total_count" json:"-"`
		}

		var txns []txnRow
		err := db.Select(&txns, `
			SELECT id, transaction_type, amount, status,
				to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
				to_char(completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as completed_at,
				COUNT(*) OVER() as total_count
			FROM transactions
			WHERE player_id = $1
			ORDER BY created_at DESC
			LIMIT $2 OFFSET $3
		`, playerID, limit, offset)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch player transactions: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch transactions"})
			return
		}

		total := 0
		if len(txns) > 0 {
			total = txns[0].TotalCount
		}

		c.JSON(http.StatusOK, gin.H{"transactions": txns, "total": total, "limit": limit, "offset": offset})
	}
}
