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
	"github.com/playpool/backend/internal/admin"
	"github.com/playpool/backend/internal/config"
	"github.com/playpool/backend/internal/models"
	"github.com/playpool/backend/internal/sms"
	"github.com/redis/go-redis/v9"
)

const adminSessionTTL = 4 * time.Hour
const adminOTPTTL = 5 * time.Minute
const adminCookieName = "admin_session"

// AdminLogin handles step 1: username/password validation, then sends OTP
func AdminLogin(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Username string `json:"username" binding:"required"`
			Password string `json:"password" binding:"required"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
			return
		}

		username := strings.TrimSpace(req.Username)
		password := strings.TrimSpace(req.Password)

		// Validate credentials
		adminAcc, err := admin.ValidateAdminCredentials(db, username, password)
		if err != nil {
			log.Printf("[ADMIN] Login failed for username %s: %v", username, err)
			admin.LogAdminAction(db, username, c.ClientIP(), "/api/v1/admin/login", "login", map[string]interface{}{"username": username}, false)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
			return
		}

		// Generate OTP
		otpInt, _ := rand.Int(rand.Reader, big.NewInt(1000000))
		otp := fmt.Sprintf("%06d", otpInt.Int64())

		// Store OTP in Redis
		ctx := context.Background()
		redisKey := fmt.Sprintf("admin_otp:%s", username)
		if err := rdb.Set(ctx, redisKey, otp, adminOTPTTL).Err(); err != nil {
			log.Printf("[ADMIN] Failed to store OTP in Redis: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate OTP"})
			return
		}

		// Send SMS to admin's phone
		message := fmt.Sprintf("Your PlayPool admin OTP is: %s. Valid for 5 minutes.", otp)
		if _, err := sms.SendSMS(ctx, adminAcc.Phone, message); err != nil {
			log.Printf("[ADMIN] Failed to send OTP SMS to %s: %v", adminAcc.Phone, err)
			// In mock mode, log the OTP for development
			if cfg.MockMode {
				log.Printf("[ADMIN] [MOCK] OTP for %s: %s", username, otp)
			}
		}

		admin.LogAdminAction(db, username, c.ClientIP(), "/api/v1/admin/login", "login_otp_sent", map[string]interface{}{"username": username}, true)
		c.JSON(http.StatusOK, gin.H{"otp_required": true, "message": "OTP sent to registered phone"})
	}
}

// AdminVerifyOTP handles step 2: OTP verification, creates session cookie
func AdminVerifyOTP(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Username string `json:"username" binding:"required"`
			OTP      string `json:"otp" binding:"required"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
			return
		}

		username := strings.TrimSpace(req.Username)
		otp := strings.TrimSpace(req.OTP)

		// Get OTP from Redis
		ctx := context.Background()
		redisKey := fmt.Sprintf("admin_otp:%s", username)
		storedOTP, err := rdb.Get(ctx, redisKey).Result()
		if err != nil {
			log.Printf("[ADMIN] OTP not found or expired for %s: %v", username, err)
			admin.LogAdminAction(db, username, c.ClientIP(), "/api/v1/admin/verify-otp", "verify_otp", map[string]interface{}{"username": username}, false)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired OTP"})
			return
		}

		if storedOTP != otp {
			log.Printf("[ADMIN] Invalid OTP for %s", username)
			admin.LogAdminAction(db, username, c.ClientIP(), "/api/v1/admin/verify-otp", "verify_otp", map[string]interface{}{"username": username}, false)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid OTP"})
			return
		}

		// Delete OTP (single use)
		rdb.Del(ctx, redisKey)

		// Generate session token
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			log.Printf("[ADMIN] Failed to generate session token: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
			return
		}
		sessionToken := hex.EncodeToString(tokenBytes)

		// Store session in Redis
		sessionKey := fmt.Sprintf("admin_session:%s", sessionToken)
		sessionData := map[string]interface{}{
			"username":   username,
			"expires_at": time.Now().Add(adminSessionTTL).Unix(),
		}
		sessionJSON, _ := json.Marshal(sessionData)
		if err := rdb.Set(ctx, sessionKey, sessionJSON, adminSessionTTL).Err(); err != nil {
			log.Printf("[ADMIN] Failed to store session: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
			return
		}

		// Set HTTP-only cookie
		secure := cfg.Environment == "production"
		c.SetSameSite(http.SameSiteStrictMode)
		c.SetCookie(adminCookieName, sessionToken, int(adminSessionTTL.Seconds()), "/api/v1/admin", "", secure, true)

		admin.LogAdminAction(db, username, c.ClientIP(), "/api/v1/admin/verify-otp", "verify_otp_success", map[string]interface{}{"username": username}, true)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// AdminLogout clears admin session
func AdminLogout(rdb *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie(adminCookieName)
		if err == nil && token != "" {
			ctx := context.Background()
			sessionKey := fmt.Sprintf("admin_session:%s", token)
			rdb.Del(ctx, sessionKey)
		}

		c.SetSameSite(http.SameSiteStrictMode)
		c.SetCookie(adminCookieName, "", -1, "/api/v1/admin", "", false, true)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// AdminMe returns the current admin session info
func AdminMe() gin.HandlerFunc {
	return func(c *gin.Context) {
		username := c.GetString("admin_username")
		c.JSON(http.StatusOK, gin.H{"username": username})
	}
}

// AdminSessionMiddleware validates admin session from cookie
func AdminSessionMiddleware(rdb *redis.Client, db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie(adminCookieName)
		if err != nil || token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
			c.Abort()
			return
		}

		// Validate session in Redis
		ctx := context.Background()
		sessionKey := fmt.Sprintf("admin_session:%s", token)
		sessionJSON, err := rdb.Get(ctx, sessionKey).Result()
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired session"})
			c.Abort()
			return
		}

		var sessionData map[string]interface{}
		if err := json.Unmarshal([]byte(sessionJSON), &sessionData); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid session"})
			c.Abort()
			return
		}

		if username, ok := sessionData["username"].(string); ok {
			c.Set("admin_username", username)
		}

		c.Next()
	}
}

// GetAdminAccounts returns list of accounts and their balances
func GetAdminAccounts(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.GetString("admin_username")

		var accounts []models.Account
		err := db.Select(&accounts, `
			SELECT id, account_type, owner_player_id, balance, created_at, updated_at
			FROM accounts
			ORDER BY account_type, id
		`)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch accounts: %v", err)
			admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/accounts", "get_accounts", nil, false)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch accounts"})
			return
		}

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

		admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/accounts", "get_accounts", map[string]interface{}{"count": len(resp)}, true)
		c.JSON(http.StatusOK, gin.H{"accounts": resp})
	}
}

// GetAdminAccountTransactions returns paginated account transactions with readable account names
func GetAdminAccountTransactions(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.GetString("admin_username")

		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

		if limit > 200 {
			limit = 200
		}

		type txnRow struct {
			ID               int     `db:"id" json:"id"`
			DebitAccountName *string `db:"debit_account_name" json:"debit_account"`
			CreditAccountName *string `db:"credit_account_name" json:"credit_account"`
			Amount           float64 `db:"amount" json:"amount"`
			ReferenceType    *string `db:"reference_type" json:"reference_type"`
			ReferenceID      *int    `db:"reference_id" json:"reference_id"`
			Description      *string `db:"description" json:"description"`
			CreatedAt        string  `db:"created_at" json:"created_at"`
			TotalCount       int     `db:"total_count" json:"-"`
		}

		var rows []txnRow
		err := db.Select(&rows, `
			SELECT at.id,
				CASE
					WHEN da.owner_player_id IS NOT NULL THEN da.account_type::text || ' (#' || da.owner_player_id::text || ' ' || COALESCE(dp.display_name, dp.phone_number, '') || ')'
					ELSE da.account_type::text
				END as debit_account_name,
				CASE
					WHEN ca.owner_player_id IS NOT NULL THEN ca.account_type::text || ' (#' || ca.owner_player_id::text || ' ' || COALESCE(cp.display_name, cp.phone_number, '') || ')'
					ELSE ca.account_type::text
				END as credit_account_name,
				at.amount,
				at.reference_type,
				at.reference_id,
				at.description,
				to_char(at.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
				COUNT(*) OVER() as total_count
			FROM account_transactions at
			LEFT JOIN accounts da ON at.debit_account_id = da.id
			LEFT JOIN players dp ON da.owner_player_id = dp.id
			LEFT JOIN accounts ca ON at.credit_account_id = ca.id
			LEFT JOIN players cp ON ca.owner_player_id = cp.id
			ORDER BY at.created_at DESC
			LIMIT $1 OFFSET $2
		`, limit, offset)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch account transactions: %v", err)
			admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/account_transactions", "get_account_transactions", map[string]interface{}{"limit": limit, "offset": offset}, false)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch transactions"})
			return
		}

		total := 0
		if len(rows) > 0 {
			total = rows[0].TotalCount
		}

		admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/account_transactions", "get_account_transactions", map[string]interface{}{"count": len(rows), "limit": limit, "offset": offset}, true)
		c.JSON(http.StatusOK, gin.H{"transactions": rows, "total": total, "limit": limit, "offset": offset})
	}
}

// GetAdminTransactions returns paginated player transactions with filters
func GetAdminTransactions(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.GetString("admin_username")

		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
		txnType := c.DefaultQuery("type", "all")
		txnStatus := c.DefaultQuery("status", "all")
		dateFrom := c.DefaultQuery("date_from", "")
		dateTo := c.DefaultQuery("date_to", "")

		if limit > 200 {
			limit = 200
		}

		type txnRow struct {
			ID              int     `db:"id" json:"id"`
			PlayerID        int     `db:"player_id" json:"player_id"`
			PlayerName      *string `db:"player_name" json:"player_name"`
			PlayerPhone     *string `db:"player_phone" json:"player_phone"`
			TransactionType string  `db:"transaction_type" json:"transaction_type"`
			Amount          float64 `db:"amount" json:"amount"`
			Status          string  `db:"status" json:"status"`
			CreatedAt       string  `db:"created_at" json:"created_at"`
			CompletedAt     *string `db:"completed_at" json:"completed_at"`
			TotalCount      int     `db:"total_count" json:"-"`
		}

		query := `
			SELECT t.id, t.player_id,
				p.display_name as player_name,
				p.phone_number as player_phone,
				t.transaction_type, t.amount, t.status,
				to_char(t.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
				to_char(t.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as completed_at,
				COUNT(*) OVER() as total_count
			FROM transactions t
			LEFT JOIN players p ON t.player_id = p.id
			WHERE ($1 = 'all' OR t.transaction_type = $1)
				AND ($2 = 'all' OR t.status = $2)
				AND ($3 = '' OR t.created_at >= $3::timestamp)
				AND ($4 = '' OR t.created_at < ($4::date + interval '1 day'))
			ORDER BY t.created_at DESC
			LIMIT $5 OFFSET $6
		`

		var rows []txnRow
		err := db.Select(&rows, query, txnType, txnStatus, dateFrom, dateTo, limit, offset)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch transactions: %v", err)
			admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/transactions", "get_transactions", nil, false)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch transactions"})
			return
		}

		total := 0
		if len(rows) > 0 {
			total = rows[0].TotalCount
		}

		admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/transactions", "get_transactions", map[string]interface{}{"count": len(rows)}, true)
		c.JSON(http.StatusOK, gin.H{"transactions": rows, "total": total, "limit": limit, "offset": offset})
	}
}

// GetAdminStats returns platform-wide statistics
func GetAdminStats(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.GetString("admin_username")

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

		admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/stats", "get_stats", nil, true)
		c.JSON(http.StatusOK, stats)
	}
}
