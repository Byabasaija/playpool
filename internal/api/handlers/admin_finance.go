package handlers

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/admin"
)

// GetAdminWithdrawals returns a paginated list of withdrawal requests
func GetAdminWithdrawals(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		status := c.DefaultQuery("status", "all")
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
		if limit > 200 {
			limit = 200
		}

		type withdrawRow struct {
			ID          int     `db:"id" json:"id"`
			PlayerID    int     `db:"player_id" json:"player_id"`
			PlayerName  *string `db:"player_name" json:"player_name"`
			PlayerPhone *string `db:"player_phone" json:"player_phone"`
			Amount      float64 `db:"amount" json:"amount"`
			Fee         float64 `db:"fee" json:"fee"`
			NetAmount   float64 `db:"net_amount" json:"net_amount"`
			Method      string  `db:"method" json:"method"`
			Destination string  `db:"destination" json:"destination"`
			Status      string  `db:"status" json:"status"`
			CreatedAt   string  `db:"created_at" json:"created_at"`
			ProcessedAt *string `db:"processed_at" json:"processed_at"`
			Note        *string `db:"note" json:"note"`
			TotalCount  int     `db:"total_count" json:"-"`
		}

		query := `
			SELECT wr.id, wr.player_id,
				p.display_name as player_name,
				p.phone_number as player_phone,
				wr.amount, wr.fee, wr.net_amount, wr.method, wr.destination,
				wr.status,
				to_char(wr.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
				to_char(wr.processed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as processed_at,
				wr.note,
				COUNT(*) OVER() as total_count
			FROM withdraw_requests wr
			LEFT JOIN players p ON wr.player_id = p.id
			WHERE ($1 = 'all'
				OR ($1 = 'pending' AND wr.status = 'PENDING')
				OR ($1 = 'completed' AND wr.status = 'COMPLETED')
				OR ($1 = 'failed' AND wr.status = 'FAILED'))
			ORDER BY
				CASE WHEN wr.status = 'PENDING' THEN 0 ELSE 1 END,
				wr.created_at DESC
			LIMIT $2 OFFSET $3
		`

		var rows []withdrawRow
		err := db.Select(&rows, query, status, limit, offset)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch withdrawals: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch withdrawals"})
			return
		}

		total := 0
		if len(rows) > 0 {
			total = rows[0].TotalCount
		}

		c.JSON(http.StatusOK, gin.H{"withdrawals": rows, "total": total, "limit": limit, "offset": offset})
	}
}

// AdminApproveWithdrawal marks a pending withdrawal as completed
func AdminApproveWithdrawal(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.GetString("admin_username")
		withdrawID := c.Param("id")

		// Verify status is PENDING
		var currentStatus string
		err := db.Get(&currentStatus, `SELECT status FROM withdraw_requests WHERE id = $1`, withdrawID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Withdrawal not found"})
			return
		}
		if currentStatus != "PENDING" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Can only approve PENDING withdrawals"})
			return
		}

		_, err = db.Exec(`
			UPDATE withdraw_requests SET status = 'COMPLETED', processed_at = NOW(), note = 'Approved by admin'
			WHERE id = $1
		`, withdrawID)
		if err != nil {
			log.Printf("[ADMIN] Failed to approve withdrawal %s: %v", withdrawID, err)
			admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/withdrawals/"+withdrawID+"/approve", "approve_withdrawal", map[string]interface{}{"withdraw_id": withdrawID}, false)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to approve withdrawal"})
			return
		}

		admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/withdrawals/"+withdrawID+"/approve", "approve_withdrawal", map[string]interface{}{"withdraw_id": withdrawID}, true)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// AdminRejectWithdrawal rejects a pending withdrawal and refunds the player
func AdminRejectWithdrawal(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.GetString("admin_username")
		withdrawID := c.Param("id")

		var req struct {
			Reason string `json:"reason" binding:"required"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Reason is required"})
			return
		}

		// Get withdrawal details
		var playerID int
		var amount float64
		var currentStatus string
		err := db.QueryRowx(`SELECT player_id, amount, status FROM withdraw_requests WHERE id = $1`, withdrawID).Scan(&playerID, &amount, &currentStatus)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Withdrawal not found"})
			return
		}
		if currentStatus != "PENDING" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Can only reject PENDING withdrawals"})
			return
		}

		// Refund: settlement -> player_winnings
		tx, err := db.Beginx()
		if err != nil {
			log.Printf("[ADMIN] Failed to begin transaction: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reject withdrawal"})
			return
		}
		defer tx.Rollback()

		// Credit player winnings
		_, err = tx.Exec(`
			UPDATE accounts SET balance = balance + $1, updated_at = NOW()
			WHERE account_type = 'player_winnings' AND owner_player_id = $2
		`, amount, playerID)
		if err != nil {
			log.Printf("[ADMIN] Failed to refund player %d: %v", playerID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refund player"})
			return
		}

		// Debit settlement
		_, err = tx.Exec(`
			UPDATE accounts SET balance = balance - $1, updated_at = NOW()
			WHERE account_type = 'settlement'
		`, amount)
		if err != nil {
			log.Printf("[ADMIN] Failed to debit settlement: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process refund"})
			return
		}

		// Record account transaction
		_, err = tx.Exec(`
			INSERT INTO account_transactions (debit_account_id, credit_account_id, amount, reference_type, reference_id, description)
			SELECT
				(SELECT id FROM accounts WHERE account_type = 'settlement' LIMIT 1),
				(SELECT id FROM accounts WHERE account_type = 'player_winnings' AND owner_player_id = $1),
				$2, 'WITHDRAW_REFUND', $3, $4
		`, playerID, amount, withdrawID, "Admin rejected: "+req.Reason)
		if err != nil {
			log.Printf("[ADMIN] Failed to record account transaction: %v", err)
			// Non-critical
		}

		// Update withdrawal status
		_, err = tx.Exec(`
			UPDATE withdraw_requests SET status = 'FAILED', processed_at = NOW(), note = $1
			WHERE id = $2
		`, "Rejected: "+req.Reason, withdrawID)
		if err != nil {
			log.Printf("[ADMIN] Failed to update withdrawal status: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reject withdrawal"})
			return
		}

		if err := tx.Commit(); err != nil {
			log.Printf("[ADMIN] Failed to commit rejection: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reject withdrawal"})
			return
		}

		admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/withdrawals/"+withdrawID+"/reject", "reject_withdrawal", map[string]interface{}{"withdraw_id": withdrawID, "reason": req.Reason, "amount": amount}, true)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// GetAdminRevenue returns revenue summary data
func GetAdminRevenue(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		dateFrom := c.DefaultQuery("date_from", "")
		dateTo := c.DefaultQuery("date_to", "")

		type revenueSummary struct {
			TotalStakes      float64 `db:"total_stakes" json:"total_stakes"`
			TotalCommissions float64 `db:"total_commissions" json:"total_commissions"`
			TotalPayouts     float64 `db:"total_payouts" json:"total_payouts"`
			TotalTax         float64 `db:"total_tax" json:"total_tax"`
			TotalWithdrawals float64 `db:"total_withdrawals" json:"total_withdrawals"`
			GamesCompleted   int     `db:"games_completed" json:"games_completed"`
		}

		// Base date filter
		dateFilter := ""
		args := []interface{}{}
		argIdx := 1

		if dateFrom != "" {
			dateFilter += " AND created_at >= $" + strconv.Itoa(argIdx)
			args = append(args, dateFrom)
			argIdx++
		}
		if dateTo != "" {
			dateFilter += " AND created_at < ($" + strconv.Itoa(argIdx) + "::date + interval '1 day')"
			args = append(args, dateTo)
			argIdx++
		}

		var summary revenueSummary

		// Total stakes (sum of all stake transactions)
		stakeQuery := `SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE transaction_type = 'STAKE' AND status = 'COMPLETED'` + dateFilter
		_ = db.Get(&summary.TotalStakes, stakeQuery, args...)

		// Total commissions (platform account credits from account_transactions)
		commQuery := `SELECT COALESCE(SUM(at.amount), 0) FROM account_transactions at
			JOIN accounts a ON at.credit_account_id = a.id
			WHERE a.account_type = 'platform'` + dateFilter
		_ = db.Get(&summary.TotalCommissions, commQuery, args...)

		// Total payouts (winner payouts from escrow to player_winnings)
		payoutQuery := `SELECT COALESCE(SUM(at.amount), 0) FROM account_transactions at
			JOIN accounts a ON at.credit_account_id = a.id
			WHERE a.account_type = 'player_winnings' AND at.reference_type = 'SESSION'` + dateFilter
		_ = db.Get(&summary.TotalPayouts, payoutQuery, args...)

		// Total tax collected
		taxQuery := `SELECT COALESCE(SUM(at.amount), 0) FROM account_transactions at
			JOIN accounts a ON at.credit_account_id = a.id
			WHERE a.account_type = 'tax'` + dateFilter
		_ = db.Get(&summary.TotalTax, taxQuery, args...)

		// Total withdrawals
		wdQuery := `SELECT COALESCE(SUM(amount), 0) FROM withdraw_requests WHERE status = 'COMPLETED'` + dateFilter
		_ = db.Get(&summary.TotalWithdrawals, wdQuery, args...)

		// Games completed
		gcQuery := `SELECT COUNT(*) FROM game_sessions WHERE status = 'COMPLETED'` + dateFilter
		_ = db.Get(&summary.GamesCompleted, gcQuery, args...)

		// Current account balances
		type balanceRow struct {
			AccountType string  `db:"account_type" json:"account_type"`
			Balance     float64 `db:"balance" json:"balance"`
		}
		var balances []balanceRow
		_ = db.Select(&balances, `
			SELECT account_type, COALESCE(SUM(balance), 0) as balance
			FROM accounts
			WHERE owner_player_id IS NULL
			GROUP BY account_type
			ORDER BY account_type
		`)

		c.JSON(http.StatusOK, gin.H{"summary": summary, "balances": balances})
	}
}
