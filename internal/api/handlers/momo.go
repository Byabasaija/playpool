package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/sms"
	"github.com/redis/go-redis/v9"
)

// MomoCallbackRequest represents Mobile Money callback payload
type MomoCallbackRequest struct {
	TransactionID string `json:"transaction_id"`
	PhoneNumber   string `json:"phone_number"`
	Amount        int    `json:"amount"`
	Status        string `json:"status"` // SUCCESS, FAILED, PENDING
	Timestamp     string `json:"timestamp"`
}

// HandleMomoCallback processes Mobile Money payment callbacks
func HandleMomoCallback(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var callback MomoCallbackRequest

		if err := c.ShouldBindJSON(&callback); err != nil {
			log.Printf("Invalid MoMo callback payload: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid payload"})
			return
		}

		log.Printf("MoMo Callback: %+v", callback)

		switch callback.Status {
		case "SUCCESS":
			// TODO: Update transaction status in DB
			// TODO: Add player to matchmaking queue
			// TODO: Trigger matchmaking
			// Notify payer via SMS (best-effort)
			if callback.PhoneNumber != "" && sms.Default != nil {
				go func(phone string, amount int) {
					msg := fmt.Sprintf("Payment of %d UGX received. Searching for opponent...", amount)
					if _, err := sms.SendSMS(context.Background(), phone, msg); err != nil {
						log.Printf("[SMS] Failed to send payment success SMS to %s: %v", phone, err)
					}
				}(callback.PhoneNumber, callback.Amount)
			}

		case "FAILED":
			// TODO: Update transaction status in DB
			// TODO: Notify player via SMS
			if callback.PhoneNumber != "" && sms.Default != nil {
				go func(phone string, amount int) {
					msg := fmt.Sprintf("Payment of %d UGX failed. Please retry or contact support.", amount)
					if _, err := sms.SendSMS(context.Background(), phone, msg); err != nil {
						log.Printf("[SMS] Failed to send payment failure SMS to %s: %v", phone, err)
					}
				}(callback.PhoneNumber, callback.Amount)
			}

		default:
			log.Printf("Unknown MoMo callback status: %s", callback.Status)
		}

		c.JSON(http.StatusOK, gin.H{"status": "received"})
	}
}
