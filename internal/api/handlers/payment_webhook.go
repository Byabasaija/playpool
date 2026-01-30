package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/accounts"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/sms"
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
func DMarkPayinWebhook(db *sqlx.DB, cfg *config.Config) gin.HandlerFunc {
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

		// Determine event type
		var eventType string
		if webhook.Status == "Successful" && webhook.StatusCode == "0" {
			eventType = "payment.succeeded"
		} else if webhook.StatusCode != "0" {
			eventType = "payment.failed"
		} else {
			eventType = "payment.pending"
		}

		// Handle based on event type
		switch eventType {
		case "payment.succeeded":
			handlePayinSuccess(db, cfg, txn.ID, txn.PlayerID, txn.Amount, txn.PhoneNumber, webhook)
		case "payment.failed":
			handlePayinFailed(db, txn.ID, webhook)
		case "payment.pending":
			log.Printf("[WEBHOOK] Payment still pending for transaction %d", txn.ID)
		}

		// Mark webhook as processed
		db.Exec(`UPDATE payment_webhooks SET processed=TRUE WHERE dmark_transaction_id=$1`, webhook.TransactionID)

		c.JSON(http.StatusOK, gin.H{"message": "webhook processed"})
	}
}

func handlePayinSuccess(db *sqlx.DB, cfg *config.Config, txnID, playerID int, amount float64, phone string, webhook WebhookPayload) {
	log.Printf("[WEBHOOK] Processing payin success for transaction %d", txnID)

	tx, err := db.Beginx()
	if err != nil {
		log.Printf("[WEBHOOK] Failed to begin transaction: %v", err)
		return
	}
	defer tx.Rollback()

	// Get accounts
	settlementAcc, _ := accounts.GetOrCreateAccount(db, accounts.AccountSettlement, nil)
	platformAcc, _ := accounts.GetOrCreateAccount(db, accounts.AccountPlatform, nil)
	winningsAcc, _ := accounts.GetOrCreateAccount(db, accounts.AccountPlayerWinnings, &playerID)

	// Calculate commission
	commission := float64(cfg.CommissionFlat)
	grossAmount := amount
	netAmount := grossAmount - commission

	// Credit settlement account with gross amount
	_, err = tx.Exec(`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`, grossAmount, settlementAcc.ID)
	if err != nil {
		log.Printf("[WEBHOOK] Failed to credit settlement: %v", err)
		return
	}

	// Record external deposit
	_, err = tx.Exec(`INSERT INTO account_transactions
        (debit_account_id, credit_account_id, amount, reference_type, reference_id, description, created_at)
        VALUES (NULL, $1, $2, 'TRANSACTION', $3, 'Deposit (gross)', NOW())`,
		settlementAcc.ID, grossAmount, txnID)
	if err != nil {
		log.Printf("[WEBHOOK] Failed to record deposit: %v", err)
		return
	}

	// Transfer: SETTLEMENT → PLATFORM (commission)
	err = accounts.Transfer(tx, settlementAcc.ID, platformAcc.ID, commission,
		"TRANSACTION", sql.NullInt64{Int64: int64(txnID), Valid: true}, "Commission (flat)")
	if err != nil {
		log.Printf("[WEBHOOK] Failed to transfer commission: %v", err)
		return
	}

	// Transfer: SETTLEMENT → PLAYER_WINNINGS (net)
	err = accounts.Transfer(tx, settlementAcc.ID, winningsAcc.ID, netAmount,
		"TRANSACTION", sql.NullInt64{Int64: int64(txnID), Valid: true}, "Deposit (net)")
	if err != nil {
		log.Printf("[WEBHOOK] Failed to transfer net amount: %v", err)
		return
	}

	// Update transaction status
	_, err = tx.Exec(`UPDATE transactions SET
        status='COMPLETED',
        completed_at=NOW(),
        provider_status_code=$1,
        provider_status_message=$2
        WHERE id=$3`,
		webhook.StatusCode, webhook.Status, txnID)
	if err != nil {
		log.Printf("[WEBHOOK] Failed to update transaction: %v", err)
		return
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[WEBHOOK] Failed to commit: %v", err)
		return
	}

	log.Printf("[WEBHOOK] ✓ Payin completed: txn=%d gross=%.2f commission=%.2f net=%.2f", txnID, grossAmount, commission, netAmount)

	// Best-effort SMS
	if sms.Default != nil {
		msg := fmt.Sprintf("PlayMatatu: Payment of %.0f UGX received. You can now join a game!", amount)
		go func() {
			if _, err := sms.SendSMS(context.Background(), phone, msg); err != nil {
				log.Printf("[WEBHOOK] Failed to send deposit SMS: %v", err)
			}
		}()
	}
}

func handlePayinFailed(db *sqlx.DB, txnID int, webhook WebhookPayload) {
	log.Printf("[WEBHOOK] Payment failed for transaction %d: %s", txnID, webhook.Message)

	_, err := db.Exec(`UPDATE transactions SET
        status='FAILED',
        provider_status_code=$1,
        provider_status_message=$2
        WHERE id=$3`,
		webhook.StatusCode, webhook.Message, txnID)

	if err != nil {
		log.Printf("[WEBHOOK] Failed to update transaction: %v", err)
	}
}
