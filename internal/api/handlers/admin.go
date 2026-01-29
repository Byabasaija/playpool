package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/admin"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/models"
	"github.com/playmatatu/backend/internal/sms"
	"github.com/redis/go-redis/v9"
)

// AdminRequestOTP handles admin OTP generation and SMS sending
func AdminRequestOTP(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Phone string `json:"phone" binding:"required"`
			Token string `json:"token" binding:"required"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
			return
		}

		// Normalize phone
		phone := strings.TrimSpace(req.Phone)
		token := strings.TrimSpace(req.Token)

		// Validate admin phone + token
		adminAcc, err := admin.ValidateAdminPhoneAndToken(db, phone, token)
		if err != nil {
			log.Printf("[ADMIN] Failed to validate admin phone+token: %v", err)
			admin.LogAdminAction(db, phone, c.ClientIP(), "/api/v1/admin/request-otp", "request_otp", map[string]interface{}{"phone": phone}, false)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
			return
		}

		// Generate OTP
		otpInt, _ := rand.Int(rand.Reader, big.NewInt(1000000))
		otp := fmt.Sprintf("%06d", otpInt.Int64())

		// Store OTP in Redis with 5 min expiry
		ctx := context.Background()
		redisKey := fmt.Sprintf("admin_otp:%s", phone)
		if err := rdb.Set(ctx, redisKey, otp, 5*time.Minute).Err(); err != nil {
			log.Printf("[ADMIN] Failed to store OTP in Redis: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate OTP"})
			return
		}

		// Send SMS
		message := fmt.Sprintf("Your PlayMatatu admin OTP is: %s. Valid for 5 minutes.", otp)
		if _, err := sms.SendSMS(ctx, phone, message); err != nil {
			log.Printf("[ADMIN] Failed to send OTP SMS: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send OTP"})
			return
		}

		admin.LogAdminAction(db, adminAcc.Phone, c.ClientIP(), "/api/v1/admin/request-otp", "request_otp", map[string]interface{}{"phone": phone}, true)
		c.JSON(http.StatusOK, gin.H{"message": "OTP sent"})
	}
}

// AdminVerifyOTP handles admin OTP verification and session creation
func AdminVerifyOTP(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Phone string `json:"phone" binding:"required"`
			OTP   string `json:"otp" binding:"required"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
			return
		}

		phone := strings.TrimSpace(req.Phone)
		otp := strings.TrimSpace(req.OTP)

		// Get OTP from Redis
		ctx := context.Background()
		redisKey := fmt.Sprintf("admin_otp:%s", phone)
		storedOTP, err := rdb.Get(ctx, redisKey).Result()
		if err != nil {
			log.Printf("[ADMIN] OTP not found or expired: %v", err)
			admin.LogAdminAction(db, phone, c.ClientIP(), "/api/v1/admin/verify-otp", "verify_otp", map[string]interface{}{"phone": phone}, false)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired OTP"})
			return
		}

		// Verify OTP
		if storedOTP != otp {
			log.Printf("[ADMIN] Invalid OTP for phone %s", phone)
			admin.LogAdminAction(db, phone, c.ClientIP(), "/api/v1/admin/verify-otp", "verify_otp", map[string]interface{}{"phone": phone}, false)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid OTP"})
			return
		}

		// Delete OTP from Redis (single use)
		rdb.Del(ctx, redisKey)

		// Get admin account
		adminAcc, err := admin.GetAdminAccount(db, phone)
		if err != nil {
			log.Printf("[ADMIN] Failed to get admin account: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
			return
		}

		// Generate admin session token
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			log.Printf("[ADMIN] Failed to generate session token: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
			return
		}
		sessionToken := hex.EncodeToString(tokenBytes)

		// Store session in Redis with 15 min TTL
		sessionKey := fmt.Sprintf("admin_session:%s", sessionToken)
		sessionData := map[string]interface{}{
			"phone":      adminAcc.Phone,
			"expires_at": time.Now().Add(15 * time.Minute).Unix(),
		}
		sessionJSON, _ := json.Marshal(sessionData)
		if err := rdb.Set(ctx, sessionKey, sessionJSON, 15*time.Minute).Err(); err != nil {
			log.Printf("[ADMIN] Failed to store session: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
			return
		}

		admin.LogAdminAction(db, adminAcc.Phone, c.ClientIP(), "/api/v1/admin/verify-otp", "verify_otp_success", map[string]interface{}{"phone": phone}, true)
		c.JSON(http.StatusOK, gin.H{
			"admin_session": sessionToken,
			"ttl_seconds":   900, // 15 minutes
		})
	}
}

// AdminSessionMiddleware validates admin session token
func AdminSessionMiddleware(rdb *redis.Client, db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Get token from header
		token := c.GetHeader("X-Admin-Session")
		if token == "" {
			token = c.GetHeader("Authorization")
			if strings.HasPrefix(token, "Bearer ") {
				token = strings.TrimPrefix(token, "Bearer ")
			}
		}

		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Missing admin session token"})
			c.Abort()
			return
		}

		// Validate session in Redis
		ctx := context.Background()
		sessionKey := fmt.Sprintf("admin_session:%s", token)
		sessionJSON, err := rdb.Get(ctx, sessionKey).Result()
		if err != nil {
			log.Printf("[ADMIN] Invalid session: %v", err)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired session"})
			c.Abort()
			return
		}

		var sessionData map[string]interface{}
		if err := json.Unmarshal([]byte(sessionJSON), &sessionData); err != nil {
			log.Printf("[ADMIN] Failed to parse session data: %v", err)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid session"})
			c.Abort()
			return
		}

		// Store admin phone in context
		if phone, ok := sessionData["phone"].(string); ok {
			c.Set("admin_phone", phone)
		}

		c.Next()
	}
}

// GetAdminAccounts returns list of accounts and their balances
func GetAdminAccounts(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminPhone := c.GetString("admin_phone")

		var accounts []models.Account
		err := db.Select(&accounts, `
			SELECT id, account_type, owner_player_id, balance, created_at, updated_at
			FROM accounts
			ORDER BY account_type, id
		`)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch accounts: %v", err)
			admin.LogAdminAction(db, adminPhone, c.ClientIP(), "/api/v1/admin/accounts", "get_accounts", nil, false)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch accounts"})
			return
		}

		// Map to response-friendly types (avoid sql.Null* leaking to JSON)
		type accountResp struct {
			ID            int     `json:"id"`
			AccountType   string  `json:"account_type"`
			OwnerPlayerID *int    `json:"owner_player_id"`
			Balance       float64 `json:"balance"`
			CreatedAt     string  `json:"created_at"`
			UpdatedAt     string  `json:"updated_at"`
		}

		var resp []accountResp
		for _, a := range accounts {
			var owner *int
			if a.OwnerPlayerID.Valid {
				v := int(a.OwnerPlayerID.Int64)
				owner = &v
			}
			resp = append(resp, accountResp{
				ID:            a.ID,
				AccountType:   a.AccountType,
				OwnerPlayerID: owner,
				Balance:       a.Balance,
				CreatedAt:     a.CreatedAt.Format(time.RFC3339),
				UpdatedAt:     a.UpdatedAt.Format(time.RFC3339),
			})
		}

		admin.LogAdminAction(db, adminPhone, c.ClientIP(), "/api/v1/admin/accounts", "get_accounts", map[string]interface{}{"count": len(resp)}, true)
		c.JSON(http.StatusOK, gin.H{"accounts": resp})
	}
}

// GetAdminAccountTransactions returns paginated account transactions
func GetAdminAccountTransactions(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminPhone := c.GetString("admin_phone")

		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

		if limit > 200 {
			limit = 200
		}

		var transactions []models.AccountTransaction
		err := db.Select(&transactions, `
			SELECT id, debit_account_id, credit_account_id, amount, reference_type, reference_id, description, created_at
			FROM account_transactions
			ORDER BY created_at DESC
			LIMIT $1 OFFSET $2
		`, limit, offset)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch account transactions: %v", err)
			admin.LogAdminAction(db, adminPhone, c.ClientIP(), "/api/v1/admin/account_transactions", "get_account_transactions", map[string]interface{}{"limit": limit, "offset": offset}, false)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch transactions"})
			return
		}

		// Map to response-friendly types
		type txnResp struct {
			ID              int     `json:"id"`
			DebitAccountID  *int    `json:"debit_account_id"`
			CreditAccountID *int    `json:"credit_account_id"`
			Amount          float64 `json:"amount"`
			ReferenceType   *string `json:"reference_type"`
			ReferenceID     *int    `json:"reference_id"`
			Description     *string `json:"description"`
			CreatedAt       string  `json:"created_at"`
		}

		var resp []txnResp
		for _, t := range transactions {
			var debit *int
			var credit *int
			var refID *int
			var refType *string
			var desc *string
			if t.DebitAccountID.Valid {
				v := int(t.DebitAccountID.Int64)
				debit = &v
			}
			if t.CreditAccountID.Valid {
				v := int(t.CreditAccountID.Int64)
				credit = &v
			}
			if t.ReferenceID.Valid {
				v := int(t.ReferenceID.Int64)
				refID = &v
			}
			if t.ReferenceType.Valid {
				v := t.ReferenceType.String
				refType = &v
			}
			if t.Description.Valid {
				v := t.Description.String
				desc = &v
			}

			resp = append(resp, txnResp{
				ID:              t.ID,
				DebitAccountID:  debit,
				CreditAccountID: credit,
				Amount:          t.Amount,
				ReferenceType:   refType,
				ReferenceID:     refID,
				Description:     desc,
				CreatedAt:       t.CreatedAt.Format(time.RFC3339),
			})
		}

		admin.LogAdminAction(db, adminPhone, c.ClientIP(), "/api/v1/admin/account_transactions", "get_account_transactions", map[string]interface{}{"count": len(resp), "limit": limit, "offset": offset}, true)
		c.JSON(http.StatusOK, gin.H{"transactions": resp, "limit": limit, "offset": offset})
	}
}

// GetAdminTransactions returns paginated player transactions with filters
func GetAdminTransactions(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminPhone := c.GetString("admin_phone")

		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
		playerPhone := c.Query("player_phone")

		if limit > 200 {
			limit = 200
		}

		query := `
			SELECT t.id, t.player_id, t.transaction_type, t.amount, t.momo_transaction_id, t.status, t.created_at, t.completed_at
			FROM transactions t
		`
		args := []interface{}{limit, offset}
		whereClause := ""

		if playerPhone != "" {
			whereClause = " WHERE EXISTS (SELECT 1 FROM players p WHERE p.id = t.player_id AND p.phone_number = $3)"
			args = append(args, playerPhone)
		}

		query += whereClause + " ORDER BY t.created_at DESC LIMIT $1 OFFSET $2"

		var transactions []models.Transaction
		err := db.Select(&transactions, query, args...)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch transactions: %v", err)
			admin.LogAdminAction(db, adminPhone, c.ClientIP(), "/api/v1/admin/transactions", "get_transactions", map[string]interface{}{"limit": limit, "offset": offset, "player_phone": playerPhone}, false)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch transactions"})
			return
		}

		admin.LogAdminAction(db, adminPhone, c.ClientIP(), "/api/v1/admin/transactions", "get_transactions", map[string]interface{}{"count": len(transactions), "limit": limit, "offset": offset}, true)
		c.JSON(http.StatusOK, gin.H{"transactions": transactions, "limit": limit, "offset": offset})
	}
}

// GetAdminStats returns platform-wide statistics
func GetAdminStats(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminPhone := c.GetString("admin_phone")

		stats := gin.H{}

		// Get account balances
		var accounts []struct {
			AccountType string  `db:"account_type"`
			Balance     float64 `db:"balance"`
		}
		err := db.Select(&accounts, `
			SELECT account_type, SUM(balance) as balance
			FROM accounts
			GROUP BY account_type
		`)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch account balances: %v", err)
		} else {
			balances := gin.H{}
			for _, acc := range accounts {
				balances[acc.AccountType] = acc.Balance
			}
			stats["account_balances"] = balances
		}

		// Get game stats
		var gameStats struct {
			TotalGames     int `db:"total_games"`
			ActiveGames    int `db:"active_games"`
			CompletedGames int `db:"completed_games"`
		}
		err = db.Get(&gameStats, `
			SELECT
				COUNT(*) as total_games,
				SUM(CASE WHEN status IN ('waiting', 'active') THEN 1 ELSE 0 END) as active_games,
				SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_games
			FROM game_sessions
		`)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch game stats: %v", err)
		} else {
			stats["total_games"] = gameStats.TotalGames
			stats["active_games"] = gameStats.ActiveGames
			stats["completed_games"] = gameStats.CompletedGames
		}

		// Get player count
		var playerCount int
		err = db.Get(&playerCount, `SELECT COUNT(*) FROM players`)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch player count: %v", err)
		} else {
			stats["total_players"] = playerCount
		}

		// Get pending withdrawals
		var pendingWithdrawals float64
		err = db.Get(&pendingWithdrawals, `
			SELECT COALESCE(SUM(amount), 0)
			FROM transactions
			WHERE transaction_type = 'withdrawal' AND status = 'pending'
		`)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch pending withdrawals: %v", err)
		} else {
			stats["pending_withdrawals"] = pendingWithdrawals
		}

		admin.LogAdminAction(db, adminPhone, c.ClientIP(), "/api/v1/admin/stats", "get_stats", nil, true)
		c.JSON(http.StatusOK, stats)
	}
}
