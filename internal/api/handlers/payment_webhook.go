package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/payment"
	"github.com/redis/go-redis/v9"
)

// WebhookPayload represents DMarkPay webhook callback
type WebhookPayload struct {
	TransactionID   string `json:"transaction_id"`    // DMarkPay ID
	SPTransactionID string `json:"sp_transaction_id"` // Our transaction ID
	Status          string `json:"status"`            // "Successful", "Failed", "Pending"
	StatusCode      string `json:"status_code"`       // "0" = success
	Message         string `json:"message"`
}

// DMarkPayinWebhook handles payin (deposit) callbacks
func DMarkPayinWebhook(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var webhook WebhookPayload
		if err := c.BindJSON(&webhook); err != nil {
			log.Printf("[WEBHOOK] Invalid payload: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
			return
		}

		log.Printf("[WEBHOOK] Payin callback: sp_txn=%s dmark_txn=%s status=%s code=%s",
			webhook.SPTransactionID, webhook.TransactionID, webhook.Status, webhook.StatusCode)

		// Log webhook for audit trail
		payloadJSON, _ := json.Marshal(webhook)
		db.Exec(`INSERT INTO payment_webhooks (dmark_transaction_id, sp_transaction_id, status, status_code, payload, processed, created_at)
                 VALUES ($1, $2, $3, $4, $5, FALSE, NOW())`,
			webhook.TransactionID, webhook.SPTransactionID, webhook.Status, webhook.StatusCode, payloadJSON)

		// Find transaction by dmark_transaction_id
		var txn struct {
			ID          int     `db:"id"`
			PlayerID    int     `db:"player_id"`
			Amount      float64 `db:"amount"`
			Status      string  `db:"status"`
			PhoneNumber string  `db:"phone_number"`
		}

		err := db.Get(&txn, `
            SELECT t.id, t.player_id, t.amount, t.status, p.phone_number
            FROM transactions t
            JOIN players p ON t.player_id = p.id
            WHERE t.dmark_transaction_id = $1
            LIMIT 1`,
			webhook.TransactionID)

		if err != nil {
			log.Printf("[WEBHOOK] Transaction not found: %v", err)
			c.JSON(http.StatusNotFound, gin.H{"error": "transaction not found"})
			return
		}

		// Idempotency check
		if txn.Status == "COMPLETED" || txn.Status == "FAILED" {
			log.Printf("[WEBHOOK] Transaction already processed: status=%s", txn.Status)
			db.Exec(`UPDATE payment_webhooks SET processed=TRUE WHERE dmark_transaction_id=$1`, webhook.TransactionID)
			c.JSON(http.StatusOK, gin.H{"message": "already processed"})
			return
		}

		// Determine event type based on response status field (not status_code)
		// DMarkPay returns: "Successful", "Pending", or "Failed"
		switch webhook.Status {
		case "Successful":
			log.Printf("[WEBHOOK] Payment succeeded for transaction %d", txn.ID)
			payment.ProcessPayinSuccess(db, rdb, cfg, txn.ID, txn.PlayerID, txn.Amount, txn.PhoneNumber, webhook.StatusCode, webhook.Status)
		case "Failed":
			log.Printf("[WEBHOOK] Payment failed for transaction %d", txn.ID)
			payment.ProcessPayinFailed(db, txn.ID, webhook.StatusCode, webhook.Message)
		case "Pending":
			log.Printf("[WEBHOOK] Payment still pending for transaction %d", txn.ID)
		default:
			log.Printf("[WEBHOOK] Unknown payment status '%s' for transaction %d", webhook.Status, txn.ID)
		}

		// Mark webhook as processed
		db.Exec(`UPDATE payment_webhooks SET processed=TRUE WHERE dmark_transaction_id=$1`, webhook.TransactionID)

		c.JSON(http.StatusOK, gin.H{"message": "webhook processed"})
	}
}

