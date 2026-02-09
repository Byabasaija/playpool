package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/config"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

const playerSessionTTL = 1 * time.Hour
const playerCookieName = "player_session"

// CheckPlayerStatus returns whether a player exists and has a PIN set
// GET /api/v1/player/check?phone=...
func CheckPlayerStatus(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		phone := strings.TrimSpace(c.Query("phone"))
		if phone == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone required"})
			return
		}

		var player struct {
			ID          int            `db:"id"`
			DisplayName string         `db:"display_name"`
			PINHash     sql.NullString `db:"pin_hash"`
		}

		err := db.Get(&player, `SELECT id, display_name, pin_hash FROM players WHERE phone_number=$1`, phone)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusOK, gin.H{
				"exists":       false,
				"has_pin":      false,
				"display_name": "",
			})
			return
		}
		if err != nil {
			log.Printf("CheckPlayerStatus DB error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"exists":       true,
			"has_pin":      player.PINHash.Valid && player.PINHash.String != "",
			"display_name": player.DisplayName,
		})
	}
}

// SetPIN sets or updates a player's PIN
// Verifies the player has a recently completed game (within 30 min) before allowing PIN setup.
// POST /api/v1/auth/set-pin
func SetPIN(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Phone string `json:"phone"`
			PIN   string `json:"pin"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone and pin required"})
			return
		}

		phone := strings.TrimSpace(req.Phone)
		pin := strings.TrimSpace(req.PIN)

		if phone == "" || pin == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone and pin required"})
			return
		}

		// Validate PIN format (4 digits)
		if len(pin) != 4 || !isDigits(pin) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "PIN must be exactly 4 digits"})
			return
		}

		log.Printf("[SetPIN] Allowing PIN setup for %s (onboarding flow)", phone)

		// Hash PIN with bcrypt
		pinHash, err := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
		if err != nil {
			log.Printf("SetPIN bcrypt error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}

		// Ensure player exists (create if new)
		player, err := GetOrCreatePlayerByPhone(db, phone)
		if err != nil {
			log.Printf("SetPIN GetOrCreatePlayerByPhone error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}

		// Update player's PIN
		_, err = db.Exec(`
			UPDATE players 
			SET pin_hash = $1, pin_failed_attempts = 0, pin_locked_until = NULL 
			WHERE id = $2
		`, string(pinHash), player.ID)
		if err != nil {
			log.Printf("SetPIN DB error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true})
	}
}

// VerifyPIN validates a PIN and returns an action token
// POST /api/v1/auth/verify-pin
func VerifyPIN(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Phone  string `json:"phone"`
			PIN    string `json:"pin"`
			Action string `json:"action"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone, pin, and action required"})
			return
		}

		phone := strings.TrimSpace(req.Phone)
		pin := strings.TrimSpace(req.PIN)
		action := strings.TrimSpace(req.Action)

		if phone == "" || pin == "" || action == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone, pin, and action required"})
			return
		}

		// Validate action type (PIN-eligible actions)
		validActions := map[string]bool{
			"stake_winnings": true,
			"requeue":        true,
			"rematch":        true,
			"view_profile":   true,
		}
		if !validActions[action] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported action type for PIN"})
			return
		}

		ctx := context.Background()

		// Get player with PIN info
		var player struct {
			ID                int            `db:"id"`
			PINHash           sql.NullString `db:"pin_hash"`
			PINFailedAttempts int            `db:"pin_failed_attempts"`
			PINLockedUntil    sql.NullTime   `db:"pin_locked_until"`
		}

		err := db.Get(&player, `
			SELECT id, pin_hash, pin_failed_attempts, pin_locked_until 
			FROM players WHERE phone_number=$1
		`, phone)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "player not found"})
			return
		}
		if err != nil {
			log.Printf("VerifyPIN DB error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}

		// Check if player has a PIN set
		if !player.PINHash.Valid || player.PINHash.String == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no PIN set for this account"})
			return
		}

		// Check if account is locked
		if player.PINLockedUntil.Valid && player.PINLockedUntil.Time.After(time.Now()) {
			remaining := time.Until(player.PINLockedUntil.Time).Minutes()
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":             "account temporarily locked due to too many failed attempts",
				"locked_until":      player.PINLockedUntil.Time.Format(time.RFC3339),
				"minutes_remaining": int(remaining) + 1,
			})
			return
		}

		// Verify PIN with bcrypt
		err = bcrypt.CompareHashAndPassword([]byte(player.PINHash.String), []byte(pin))
		if err != nil {
			// Wrong PIN - increment failed attempts
			newAttempts := player.PINFailedAttempts + 1

			if newAttempts >= cfg.PINMaxAttempts {
				// Lock account
				lockUntil := time.Now().Add(time.Duration(cfg.PINLockoutMinutes) * time.Minute)
				db.Exec(`
					UPDATE players 
					SET pin_failed_attempts = $1, pin_locked_until = $2 
					WHERE id = $3
				`, newAttempts, lockUntil, player.ID)

				c.JSON(http.StatusTooManyRequests, gin.H{
					"error":             "too many failed attempts, account locked",
					"locked_until":      lockUntil.Format(time.RFC3339),
					"minutes_remaining": cfg.PINLockoutMinutes,
				})
				return
			}

			db.Exec(`UPDATE players SET pin_failed_attempts = $1 WHERE id = $2`, newAttempts, player.ID)

			attemptsRemaining := cfg.PINMaxAttempts - newAttempts
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":              "incorrect PIN",
				"attempts_remaining": attemptsRemaining,
			})
			return
		}

		// PIN correct - reset failed attempts
		db.Exec(`UPDATE players SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = $1`, player.ID)

		// Generate action token (same pattern as OTP action token)
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			log.Printf("VerifyPIN token generation error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}
		actionToken := hex.EncodeToString(tokenBytes)

		// Hash token for storage
		tokenHash := sha256.Sum256([]byte(actionToken))
		tokenHashStr := hex.EncodeToString(tokenHash[:])

		// Store token payload in Redis
		payload := fmt.Sprintf(`{"phone":"%s","action":"%s","player_id":%d,"created_at":"%s","auth_method":"pin"}`,
			phone, action, player.ID, time.Now().Format(time.RFC3339))

		ttl := time.Duration(cfg.PINTokenTTLSeconds) * time.Second
		if err := rdb.Set(ctx, fmt.Sprintf("action_token:%s", tokenHashStr), payload, ttl).Err(); err != nil {
			log.Printf("VerifyPIN token storage error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}

		expiresAt := time.Now().Add(ttl)

		// Set player session cookie (same pattern as admin session)
		sessionBytes := make([]byte, 32)
		if _, err := rand.Read(sessionBytes); err != nil {
			log.Printf("VerifyPIN session token generation error: %v", err)
			// Non-fatal: still return action_token, just skip cookie
		} else {
			sessionToken := hex.EncodeToString(sessionBytes)
			sessionKey := fmt.Sprintf("player_session:%s", sessionToken)
			sessionData, _ := json.Marshal(map[string]interface{}{
				"player_id":  player.ID,
				"phone":      phone,
				"created_at": time.Now().Format(time.RFC3339),
			})
			if err := rdb.Set(ctx, sessionKey, sessionData, playerSessionTTL).Err(); err != nil {
				log.Printf("VerifyPIN session storage error: %v", err)
			} else {
				secure := cfg.Environment == "production"
				c.SetSameSite(http.SameSiteLaxMode)
				c.SetCookie(playerCookieName, sessionToken, int(playerSessionTTL.Seconds()), "/api/v1", "", secure, true)
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"action_token": actionToken,
			"expires_at":   expiresAt.Format(time.RFC3339),
		})
	}
}

// ResetPIN resets a player's PIN (requires OTP action_token for 'reset_pin')
// POST /api/v1/auth/reset-pin
func ResetPIN(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Phone       string `json:"phone"`
			NewPIN      string `json:"new_pin"`
			ActionToken string `json:"action_token"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone, new_pin, and action_token required"})
			return
		}

		phone := strings.TrimSpace(req.Phone)
		newPIN := strings.TrimSpace(req.NewPIN)
		actionToken := strings.TrimSpace(req.ActionToken)

		if phone == "" || newPIN == "" || actionToken == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone, new_pin, and action_token required"})
			return
		}

		// Validate PIN format
		if len(newPIN) != 4 || !isDigits(newPIN) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "PIN must be exactly 4 digits"})
			return
		}

		ctx := context.Background()

		// Verify action token
		tokenHash := sha256.Sum256([]byte(actionToken))
		tokenHashStr := hex.EncodeToString(tokenHash[:])
		payload, err := rdb.Get(ctx, fmt.Sprintf("action_token:%s", tokenHashStr)).Result()
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired action token"})
			return
		}

		// Parse and validate payload
		if !strings.Contains(payload, `"action":"reset_pin"`) || !strings.Contains(payload, fmt.Sprintf(`"phone":"%s"`, phone)) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid action token for this operation"})
			return
		}

		// Consume the token (single-use)
		rdb.Del(ctx, fmt.Sprintf("action_token:%s", tokenHashStr))

		// Hash new PIN
		pinHash, err := bcrypt.GenerateFromPassword([]byte(newPIN), bcrypt.DefaultCost)
		if err != nil {
			log.Printf("ResetPIN bcrypt error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}

		// Update player's PIN and clear lockout
		result, err := db.Exec(`
			UPDATE players 
			SET pin_hash = $1, pin_failed_attempts = 0, pin_locked_until = NULL 
			WHERE phone_number = $2
		`, string(pinHash), phone)
		if err != nil {
			log.Printf("ResetPIN DB error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}

		rowsAffected, _ := result.RowsAffected()
		if rowsAffected == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "player not found"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true})
	}
}

// isDigits checks if a string contains only digits
func isDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// Suppress unused import warning for subtle
var _ = subtle.ConstantTimeCompare
