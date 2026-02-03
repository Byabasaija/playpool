package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"database/sql"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v4"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/accounts"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/sms"
	"github.com/redis/go-redis/v9"
)

// RequestOTP handles OTP generation and SMS sending
func RequestOTP(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Phone string `json:"phone"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone required"})
			return
		}

		phone := strings.TrimSpace(req.Phone)
		if phone == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone required"})
			return
		}

		ctx := context.Background()
		// Rate limit per phone
		if rdb != nil && cfg != nil && cfg.OTPRequestRateLimitSeconds > 0 {
			key := fmt.Sprintf("otp_rate:%s", phone)
			ok, err := rdb.SetNX(ctx, key, "1", time.Duration(cfg.OTPRequestRateLimitSeconds)*time.Second).Result()
			if err == nil && !ok {
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "OTP rate limit exceeded"})
				return
			}
		}

		// generate 4-digit OTP
		n, err := rand.Int(rand.Reader, bigInt(10000))
		if err != nil {
			log.Printf("Failed to generate OTP: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}
		code := fmt.Sprintf("%04d", n.Int64())

		// hash and store in Redis
		h := sha256.Sum256([]byte(code))
		hash := hex.EncodeToString(h[:])
		if rdb != nil {
			rdb.Set(ctx, fmt.Sprintf("otp:%s", phone), hash, time.Duration(cfg.OTPTokenTTLSeconds)*time.Second)
		}

		// send SMS via DMark
		msg := fmt.Sprintf("Your PlayMatatu OTP is %s. It expires in %d minutes.", code, cfg.OTPTokenTTLSeconds/60)
		if sms.Default != nil {
			if _, err := sms.SendSMS(ctx, phone, msg); err != nil {
				log.Printf("Failed to send OTP SMS to %s: %v", phone, err)
				// We still return success for best-effort but log the error
			}
		}

		c.JSON(http.StatusOK, gin.H{"sms_queued": true})
	}
}

// VerifyOTP validates the code, issues a JWT, and returns player info
func VerifyOTP(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Phone string `json:"phone"`
			Code  string `json:"code"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone and code required"})
			return
		}
		phone := strings.TrimSpace(req.Phone)
		code := strings.TrimSpace(req.Code)
		if phone == "" || code == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone and code required"})
			return
		}

		ctx := context.Background()
		val, err := rdb.Get(ctx, fmt.Sprintf("otp:%s", phone)).Result()
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired code"})
			return
		}
		h := sha256.Sum256([]byte(code))
		if subtle.ConstantTimeCompare([]byte(val), []byte(hex.EncodeToString(h[:]))) != 1 {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired code"})
			return
		}

		// Delete OTP after successful verify
		rdb.Del(ctx, fmt.Sprintf("otp:%s", phone))

		// Ensure player exists
		var player struct {
			ID          int    `db:"id"`
			DisplayName string `db:"display_name"`
		}
		err = db.Get(&player, `SELECT id, display_name FROM players WHERE phone_number=$1`, phone)
		if err != nil {
			// create player
			if _, err2 := db.Exec(`INSERT INTO players (phone_number, display_name, created_at, is_active) VALUES ($1, $2, NOW(), true)`, phone, ""); err2 != nil {
				log.Printf("Failed to create player for phone %s: %v", phone, err2)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
				return
			}
			// re-fetch
			err = db.Get(&player, `SELECT id, display_name FROM players WHERE phone_number=$1`, phone)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
				return
			}
		}

		// Issue JWT
		exp := time.Now().Add(24 * time.Hour)
		claims := jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(exp)}
		custom := jwt.MapClaims{"player_id": player.ID, "phone": phone, "exp": claims.ExpiresAt.Unix()}
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, custom)
		signed, err := token.SignedString([]byte(cfg.JWTSecret))
		if err != nil {
			log.Printf("Failed to sign token: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"token": signed, "player": gin.H{"id": player.ID, "phone": phone, "display_name": player.DisplayName}})
	}
}

// VerifyOTPAction validates the OTP and issues a short-lived action token instead of JWT
func VerifyOTPAction(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Phone  string `json:"phone"`
			Code   string `json:"code"`
			Action string `json:"action"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone, code, and action required"})
			return
		}
		phone := strings.TrimSpace(req.Phone)
		code := strings.TrimSpace(req.Code)
		action := strings.TrimSpace(req.Action)

		if phone == "" || code == "" || action == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone, code, and action required"})
			return
		}

		// Validate action type
		validActions := map[string]bool{"stake_winnings": true, "requeue": true, "set_pin": true, "reset_pin": true}
		if !validActions[action] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported action type"})
			return
		}

		ctx := context.Background()

		// Verify OTP using same logic as VerifyOTP
		val, err := rdb.Get(ctx, fmt.Sprintf("otp:%s", phone)).Result()
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired code"})
			return
		}
		h := sha256.Sum256([]byte(code))
		if subtle.ConstantTimeCompare([]byte(val), []byte(hex.EncodeToString(h[:]))) != 1 {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired code"})
			return
		}

		// Delete OTP after successful verify (single-use)
		rdb.Del(ctx, fmt.Sprintf("otp:%s", phone))

		// Ensure player exists
		var player struct {
			ID int `db:"id"`
		}
		err = db.Get(&player, `SELECT id FROM players WHERE phone_number=$1`, phone)
		if err != nil {
			// Create player if not exists
			if _, err2 := db.Exec(`INSERT INTO players (phone_number, display_name, created_at, is_active) VALUES ($1, $2, NOW(), true)`, phone, ""); err2 != nil {
				log.Printf("Failed to create player for phone %s: %v", phone, err2)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
				return
			}
			err = db.Get(&player, `SELECT id FROM players WHERE phone_number=$1`, phone)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
				return
			}
		}

		// Generate action token (32-byte random hex = 64 characters)
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			log.Printf("Failed to generate action token: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}
		actionToken := hex.EncodeToString(tokenBytes)

		// Hash token for storage (same security pattern as OTP)
		tokenHash := sha256.Sum256([]byte(actionToken))
		tokenHashStr := hex.EncodeToString(tokenHash[:])

		// Store token payload in Redis with TTL
		// Key: action_token:{hash}
		// Value: JSON with phone, action, player_id, created_at
		payload := fmt.Sprintf(`{"phone":"%s","action":"%s","player_id":%d,"created_at":"%s"}`,
			phone, action, player.ID, time.Now().Format(time.RFC3339))

		ttl := time.Duration(cfg.OTPTokenTTLSeconds) * time.Second
		if err := rdb.Set(ctx, fmt.Sprintf("action_token:%s", tokenHashStr), payload, ttl).Err(); err != nil {
			log.Printf("Failed to store action token: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}

		expiresAt := time.Now().Add(ttl)

		c.JSON(http.StatusOK, gin.H{
			"action_token": actionToken,
			"expires_at":   expiresAt.Format(time.RFC3339),
		})
	}
}

// AuthMiddleware validates bearer JWT and sets player_id in context
// For action tokens from PIN verification, also validates those for specific actions
func AuthMiddleware(cfg *config.Config, rdb *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}
		token := strings.TrimPrefix(auth, "Bearer ")

		// Try JWT first
		parsed, err := jwt.Parse(token, func(token *jwt.Token) (interface{}, error) {
			if token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
				return nil, fmt.Errorf("unexpected signing method")
			}
			return []byte(cfg.JWTSecret), nil
		})
		if err == nil && parsed.Valid {
			claims, ok := parsed.Claims.(jwt.MapClaims)
			if !ok {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
				return
			}
			playerIDf, ok := claims["player_id"].(float64)
			if !ok {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
				return
			}
			c.Set("player_id", int(playerIDf))
			c.Next()
			return
		}

		// Try action token (for PIN-based auth)
		tokenHash := sha256.Sum256([]byte(token))
		tokenHashStr := hex.EncodeToString(tokenHash[:])

		ctx := context.Background()
		payload, err := rdb.Get(ctx, fmt.Sprintf("action_token:%s", tokenHashStr)).Result()
		if err == nil {
			// Parse action token payload as JSON
			var tokenData struct {
				Phone      string `json:"phone"`
				Action     string `json:"action"`
				PlayerID   int    `json:"player_id"`
				CreatedAt  string `json:"created_at"`
				AuthMethod string `json:"auth_method"`
			}

			if err := json.Unmarshal([]byte(payload), &tokenData); err != nil {
				log.Printf("AuthMiddleware: failed to parse action token payload: %v", err)
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
				return
			}

			if tokenData.PlayerID > 0 {
				c.Set("player_id", tokenData.PlayerID)
				c.Next()
				return
			}
		} else if err != redis.Nil {
			log.Printf("AuthMiddleware: Redis error checking action token: %v", err)
		}

		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
	}
}

// GetMe returns the authenticated player's profile (placeholder balances/stats)
func GetMe(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		pidI, ok := c.Get("player_id")
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		pid := pidI.(int)

		var player struct {
			ID          int    `db:"id" json:"id"`
			PhoneNumber string `db:"phone_number" json:"phone_number"`
			DisplayName string `db:"display_name" json:"display_name"`
		}
		if err := db.Get(&player, `SELECT id, phone_number, display_name FROM players WHERE id=$1`, pid); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "player not found"})
			return
		}

		// Read aggregated stats
		var stats struct {
			TotalGamesPlayed int     `db:"total_games_played"`
			TotalGamesWon    int     `db:"total_games_won"`
			TotalGamesDrawn  int     `db:"total_games_drawn"`
			TotalWinnings    float64 `db:"total_winnings"`
		}
		if err := db.Get(&stats, `SELECT total_games_played, total_games_won, total_games_drawn, total_winnings FROM players WHERE id=$1`, pid); err != nil {
			// fallback to zeros if needed
			stats.TotalGamesPlayed = 0
			stats.TotalGamesWon = 0
			stats.TotalGamesDrawn = 0
			stats.TotalWinnings = 0
		}

		// Get player winnings account balance
		winningsBalance := 0.0
		if acc, err := accounts.GetOrCreateAccount(db, accounts.AccountPlayerWinnings, &player.ID); err == nil {
			winningsBalance = acc.Balance
		}

		profile := gin.H{
			"display_name":       player.DisplayName,
			"phone":              player.PhoneNumber,
			"player_winnings":    winningsBalance,
			"total_games_played": stats.TotalGamesPlayed,
			"total_games_won":    stats.TotalGamesWon,
			"total_games_drawn":  stats.TotalGamesDrawn,
			"total_winnings":     stats.TotalWinnings,
		}
		c.JSON(http.StatusOK, profile)
	}
}

// POST /api/v1/me/withdraw
func RequestWithdraw(db *sqlx.DB, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		pidI, ok := c.Get("player_id")
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		pid := pidI.(int)

		var req struct {
			Amount      float64 `json:"amount"`
			Method      string  `json:"method"`
			Destination string  `json:"destination"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}

		// Basic validation
		if req.Amount <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid amount"})
			return
		}

		// Enforce minimum withdraw amount
		if int(req.Amount) < cfg.MinWithdrawAmount {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("minimum withdraw is %d", cfg.MinWithdrawAmount)})
			return
		}

		// Read player's winnings account balance
		wAcc, err := accounts.GetOrCreateAccount(db, accounts.AccountPlayerWinnings, &pid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read account"})
			return
		}
		if wAcc.Balance < req.Amount {
			c.JSON(http.StatusBadRequest, gin.H{"error": "insufficient winnings balance"})
			return
		}

		// Provider will handle their own fees, we transfer the full requested amount

		// Reserve funds: debit player_winnings -> settlement inside tx and create withdraw_request
		tx, err := db.Beginx()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}

		// Ensure settlement account exists
		sett, err := accounts.GetOrCreateAccount(db, accounts.AccountSettlement, nil)
		if err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}

		// Transfer player_winnings -> settlement (reserve full amount)
		if err := accounts.Transfer(tx, wAcc.ID, sett.ID, req.Amount, "WITHDRAW_REQUEST", sql.NullInt64{Int64: 0, Valid: false}, "Withdraw request reserve"); err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reserve funds"})
			return
		}

		// Insert withdraw_request
		var reqID int
		if err := tx.QueryRowx(`INSERT INTO withdraw_requests (player_id, amount, fee, net_amount, method, destination, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'PENDING',NOW()) RETURNING id`, pid, req.Amount, 0, req.Amount, req.Method, req.Destination).Scan(&reqID); err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create withdraw request"})
			return
		}

		if err := tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit"})
			return
		}

		// If MOCK_MODE, process immediately (synchronously) with simulated transfers
		if cfg.MockMode {
			go func(reqID int, amount float64) {
				processWithdrawMock(db, cfg, reqID, pid, amount)
			}(reqID, req.Amount)
		}

		c.JSON(http.StatusOK, gin.H{"request_id": reqID, "amount": req.Amount})
	}
}

// processWithdrawMock simulates a payout: settlement -> money leaves system (full amount to provider)
func processWithdrawMock(db *sqlx.DB, cfg *config.Config, reqID, pid int, amount float64) {
	log.Printf("[WITHDRAW MOCK] Processing withdraw=%d amount=%.2f", reqID, amount)
	// allow sim failure via env var
	if os.Getenv("WITHDRAW_MOCK_FAIL") == "true" {
		log.Printf("[WITHDRAW MOCK] Simulated failure for request %d", reqID)
		// Refund: move settlement back to player_winnings
		tx, err := db.Beginx()
		if err != nil {
			log.Printf("[WITHDRAW MOCK] failed to begin tx: %v", err)
			return
		}
		sett, err := accounts.GetOrCreateAccount(db, accounts.AccountSettlement, nil)
		if err != nil {
			tx.Rollback()
			log.Printf("[WITHDRAW MOCK] failed to get settlement account: %v", err)
			return
		}
		pwAcc, err := accounts.GetOrCreateAccount(db, accounts.AccountPlayerWinnings, &pid)
		if err != nil {
			tx.Rollback()
			log.Printf("[WITHDRAW MOCK] failed to get player winnings account: %v", err)
			return
		}
		// refund settlement -> player winnings
		if err := accounts.Transfer(tx, sett.ID, pwAcc.ID, amount, "WITHDRAW_REFUND", sql.NullInt64{Int64: int64(reqID), Valid: true}, "Withdraw failed - refunded"); err != nil {
			tx.Rollback()
			log.Printf("[WITHDRAW MOCK] refund transfer failed: %v", err)
			return
		}
		// mark request FAILED
		if _, err := tx.Exec(`UPDATE withdraw_requests SET status='FAILED', processed_at=NOW(), note=$1 WHERE id=$2`, "simulated failure", reqID); err != nil {
			tx.Rollback()
			log.Printf("[WITHDRAW MOCK] failed to mark request failed: %v", err)
			return
		}
		if err := tx.Commit(); err != nil {
			log.Printf("[WITHDRAW MOCK] commit failed on refund: %v", err)
			return
		}
		log.Printf("[WITHDRAW MOCK] Simulated failure handled for request %d", reqID)
		return
	}

	// Normal path: deduct settlement by full amount (external outflow), record account_transaction debit with credit NULL
	tx, err := db.Beginx()
	if err != nil {
		log.Printf("[WITHDRAW MOCK] failed to begin tx: %v", err)
		return
	}

	// Get settlement
	sett, err := accounts.GetOrCreateAccount(db, accounts.AccountSettlement, nil)
	if err != nil {
		tx.Rollback()
		log.Printf("[WITHDRAW MOCK] failed to get settlement account: %v", err)
		return
	}

	// Deduct settlement balance atomically and ensure sufficient funds
	var newBal float64
	if err := tx.Get(&newBal, `UPDATE accounts SET balance = balance - $1 WHERE id=$2 AND balance >= $1 RETURNING balance`, amount, sett.ID); err != nil {
		tx.Rollback()
		log.Printf("[WITHDRAW MOCK] insufficient settlement funds or update failed: %v", err)
		// Attempt to refund to player_winnings just in case (though reservation should have ensured funds)
		pwAcc, _ := accounts.GetOrCreateAccount(db, accounts.AccountPlayerWinnings, &pid)
		if pwAcc != nil {
			if rErr := accounts.Transfer(tx, sett.ID, pwAcc.ID, amount, "WITHDRAW_REFUND", sql.NullInt64{Int64: int64(reqID), Valid: true}, "Refund on insufficient settlement"); rErr != nil {
				log.Printf("[WITHDRAW MOCK] refund attempt failed: %v", rErr)
			}
		}
		return
	}

	// Insert account_transactions entry representing external payout (debit settlement, credit external)
	if _, err := tx.Exec(`INSERT INTO account_transactions (debit_account_id, credit_account_id, amount, reference_type, reference_id, description, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`, sett.ID, nil, amount, "WITHDRAW", sql.NullInt64{Int64: int64(reqID), Valid: true}, "Payout to external"); err != nil {
		tx.Rollback()
		log.Printf("[WITHDRAW MOCK] failed to insert account_transaction: %v", err)
		return
	}

	// Record player transaction (full amount - provider will handle their own fees)
	if _, err := tx.Exec(`INSERT INTO transactions (player_id, transaction_type, amount, status, created_at) VALUES ($1,'WITHDRAW',$2,'COMPLETED',NOW())`, pid, amount); err != nil {
		tx.Rollback()
		log.Printf("[WITHDRAW MOCK] failed to insert transaction: %v", err)
		return
	}

	// Update withdraw_request status to COMPLETED
	if _, err := tx.Exec(`UPDATE withdraw_requests SET status='COMPLETED', processed_at=NOW() WHERE id=$1`, reqID); err != nil {
		tx.Rollback()
		log.Printf("[WITHDRAW MOCK] failed to update request status: %v", err)
		return
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[WITHDRAW MOCK] commit failed: %v", err)
		return
	}

	log.Printf("[WITHDRAW MOCK] Completed withdraw request %d", reqID)
}

// GetMyWithdraws returns withdraw requests for the authenticated player
func GetMyWithdraws(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		pidI, ok := c.Get("player_id")
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		pid := pidI.(int)

		var rows []struct {
			ID            int            `db:"id" json:"id"`
			Amount        float64        `db:"amount" json:"amount"`
			Fee           float64        `db:"fee" json:"fee"`
			NetAmount     float64        `db:"net_amount" json:"net_amount"`
			Method        string         `db:"method" json:"method"`
			Destination   string         `db:"destination" json:"destination"`
			ProviderTxnID sql.NullString `db:"provider_txn_id" json:"provider_txn_id,omitempty"`
			Status        string         `db:"status" json:"status"`
			CreatedAt     time.Time      `db:"created_at" json:"created_at"`
			ProcessedAt   sql.NullTime   `db:"processed_at" json:"processed_at,omitempty"`
			Note          sql.NullString `db:"note" json:"note,omitempty"`
		}

		if err := db.Select(&rows, `SELECT id, amount, fee, net_amount, method, destination, provider_txn_id, status, created_at, processed_at, note FROM withdraw_requests WHERE player_id=$1 ORDER BY created_at DESC`, pid); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch withdraws"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"withdraws": rows})
	}
}

// helper: bigInt for rand.Int
func bigInt(n int64) *big.Int {
	return big.NewInt(n)
}
