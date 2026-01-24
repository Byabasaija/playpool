package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v4"
	"github.com/jmoiron/sqlx"
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

// AuthMiddleware validates bearer JWT and sets player_id in context
func AuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}
		tok := strings.TrimPrefix(auth, "Bearer ")
		parsed, err := jwt.Parse(tok, func(token *jwt.Token) (interface{}, error) {
			if token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
				return nil, fmt.Errorf("unexpected signing method")
			}
			return []byte(cfg.JWTSecret), nil
		})
		if err != nil || !parsed.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
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

		// Placeholder balances/stats
		profile := gin.H{
			"display_name":       player.DisplayName,
			"phone":              player.PhoneNumber,
			"fee_exempt_balance": 0,
			"total_games_played": 0,
			"total_games_won":    0,
			"total_winnings":     0,
		}
		c.JSON(http.StatusOK, profile)
	}
}

// helper: bigInt for rand.Int
func bigInt(n int64) *big.Int {
	return big.NewInt(n)
}
