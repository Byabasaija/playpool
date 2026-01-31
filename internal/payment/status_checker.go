package payment

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/accounts"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/sms"
	"github.com/redis/go-redis/v9"
)

// StartStatusChecker runs a background job to check status of PENDING transactions via DMarkPay API
func StartStatusChecker(ctx context.Context, db *sqlx.DB, rdb *redis.Client, cfg *config.Config, intervalMinutes int) {
	ticker := time.NewTicker(time.Duration(intervalMinutes) * time.Minute)
	defer ticker.Stop()

	log.Printf("[PAYMENT-STATUS] Starting payment status checker (check every %d min)", intervalMinutes)

	// Run once immediately on startup
	checkPendingTransactions(ctx, db, rdb, cfg)

	for {
		select {
		case <-ctx.Done():
			log.Printf("[PAYMENT-STATUS] Status checker stopped")
			return
		case <-ticker.C:
			checkPendingTransactions(ctx, db, rdb, cfg)
		}
	}
}

func checkPendingTransactions(ctx context.Context, db *sqlx.DB, rdb *redis.Client, cfg *config.Config) {
	if Default == nil {
		log.Printf("[PAYMENT-STATUS] Payment client not initialized, skipping check")
		return
	}

	// Get all PENDING transactions
	var transactions []struct {
		ID                 int     `db:"id"`
		PlayerID           int     `db:"player_id"`
		Amount             float64 `db:"amount"`
		DMarkTransactionID string  `db:"dmark_transaction_id"`
		PhoneNumber        string  `db:"phone_number"`
		CreatedAt          time.Time `db:"created_at"`
	}

	err := db.Select(&transactions, `
		SELECT t.id, t.player_id, t.amount, t.dmark_transaction_id, p.phone_number, t.created_at
		FROM transactions t
		JOIN players p ON t.player_id = p.id
		WHERE t.status = 'PENDING'
		  AND t.dmark_transaction_id IS NOT NULL
		  AND t.dmark_transaction_id != ''
		ORDER BY t.created_at ASC
	`)

	if err != nil {
		log.Printf("[PAYMENT-STATUS] Failed to fetch pending transactions: %v", err)
		return
	}

	if len(transactions) == 0 {
		log.Printf("[PAYMENT-STATUS] No pending transactions to check")
		return
	}

	log.Printf("[PAYMENT-STATUS] Checking %d pending transaction(s)", len(transactions))

	for _, txn := range transactions {
		age := time.Since(txn.CreatedAt)
		log.Printf("[PAYMENT-STATUS] Checking transaction %d (dmark_txn=%s, age=%v)",
			txn.ID, txn.DMarkTransactionID, age.Round(time.Second))

		// Call DMarkPay API to get transaction status
		statusResp, err := Default.GetTransactionStatus(ctx, txn.DMarkTransactionID)
		if err != nil {
			log.Printf("[PAYMENT-STATUS] Failed to get status for transaction %d: %v", txn.ID, err)
			continue
		}

		log.Printf("[PAYMENT-STATUS] Transaction %d status: %s (code: %s)",
			txn.ID, statusResp.Status, statusResp.StatusCode)

		// Process based on response status field (not HTTP status codes)
		// DMarkPay returns: "Successful", "Pending", or "Failed"
		switch statusResp.Status {
		case "Successful":
			log.Printf("[PAYMENT-STATUS] Transaction %d succeeded, processing payment", txn.ID)
			ProcessPayinSuccess(db, rdb, cfg, txn.ID, txn.PlayerID, txn.Amount, txn.PhoneNumber,
				statusResp.StatusCode, statusResp.Status)
		case "Failed":
			log.Printf("[PAYMENT-STATUS] Transaction %d failed, marking as FAILED", txn.ID)
			ProcessPayinFailed(db, txn.ID, statusResp.StatusCode, statusResp.Message)
		case "Pending":
			log.Printf("[PAYMENT-STATUS] Transaction %d still pending, will check again later", txn.ID)
		default:
			log.Printf("[PAYMENT-STATUS] Transaction %d has unknown status '%s', treating as pending", txn.ID, statusResp.Status)
		}
	}
}

// ProcessPayinSuccess handles successful payment (called by both webhook and status checker)
func ProcessPayinSuccess(db *sqlx.DB, rdb *redis.Client, cfg *config.Config, txnID, playerID int, amount float64, phone string, statusCode, statusMessage string) {
	log.Printf("[PAYMENT] Processing payin success for transaction %d", txnID)

	// Check idempotency first (without transaction)
	var currentStatus string
	err := db.Get(&currentStatus, `SELECT status FROM transactions WHERE id=$1`, txnID)
	if err != nil {
		log.Printf("[PAYMENT] Failed to check transaction status: %v", err)
		return
	}
	if currentStatus == "COMPLETED" {
		log.Printf("[PAYMENT] Transaction %d already completed, skipping", txnID)
		return
	}

	tx, err := db.Beginx()
	if err != nil {
		log.Printf("[PAYMENT] Failed to begin transaction: %v", err)
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
		log.Printf("[PAYMENT] Failed to credit settlement: %v", err)
		return
	}

	// Record external deposit
	_, err = tx.Exec(`INSERT INTO account_transactions
        (debit_account_id, credit_account_id, amount, reference_type, reference_id, description, created_at)
        VALUES (NULL, $1, $2, 'TRANSACTION', $3, 'Deposit (gross)', NOW())`,
		settlementAcc.ID, grossAmount, txnID)
	if err != nil {
		log.Printf("[PAYMENT] Failed to record deposit: %v", err)
		return
	}

	// Transfer: SETTLEMENT → PLATFORM (commission)
	err = accounts.Transfer(tx, settlementAcc.ID, platformAcc.ID, commission,
		"TRANSACTION", sql.NullInt64{Int64: int64(txnID), Valid: true}, "Commission (flat)")
	if err != nil {
		log.Printf("[PAYMENT] Failed to transfer commission: %v", err)
		return
	}

	// Transfer: SETTLEMENT → PLAYER_WINNINGS (net)
	err = accounts.Transfer(tx, settlementAcc.ID, winningsAcc.ID, netAmount,
		"TRANSACTION", sql.NullInt64{Int64: int64(txnID), Valid: true}, "Deposit (net)")
	if err != nil {
		log.Printf("[PAYMENT] Failed to transfer net amount: %v", err)
		return
	}

	// Update transaction status
	_, err = tx.Exec(`UPDATE transactions SET
        status='COMPLETED',
        completed_at=NOW(),
        provider_status_code=$1,
        provider_status_message=$2
        WHERE id=$3`,
		statusCode, statusMessage, txnID)
	if err != nil {
		log.Printf("[PAYMENT] Failed to update transaction: %v", err)
		return
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[PAYMENT] Failed to commit: %v", err)
		return
	}

	log.Printf("[PAYMENT] ✓ Payin completed: txn=%d gross=%.2f commission=%.2f net=%.2f", txnID, grossAmount, commission, netAmount)

	// Add player to matchmaking queue after successful payment
	go AddToMatchmakingQueue(db, rdb, cfg, playerID, phone, netAmount, txnID)

	// Best-effort SMS
	if sms.Default != nil {
		msg := fmt.Sprintf("PlayMatatu: Payment of %.0f UGX received. You can now join a game!", amount)
		go func() {
			if _, err := sms.SendSMS(context.Background(), phone, msg); err != nil {
				log.Printf("[PAYMENT] Failed to send deposit SMS: %v", err)
			}
		}()
	}
}

// ProcessPayinFailed handles failed payment (called by both webhook and status checker)
func ProcessPayinFailed(db *sqlx.DB, txnID int, statusCode, message string) {
	log.Printf("[PAYMENT] Payment failed for transaction %d: %s", txnID, message)

	// Check idempotency
	var currentStatus string
	err := db.Get(&currentStatus, `SELECT status FROM transactions WHERE id=$1`, txnID)
	if err != nil {
		log.Printf("[PAYMENT] Failed to check transaction status: %v", err)
		return
	}
	if currentStatus == "FAILED" || currentStatus == "COMPLETED" {
		log.Printf("[PAYMENT] Transaction %d already processed (status=%s), skipping", txnID, currentStatus)
		return
	}

	_, err = db.Exec(`UPDATE transactions SET
        status='FAILED',
        provider_status_code=$1,
        provider_status_message=$2
        WHERE id=$3`,
		statusCode, message, txnID)

	if err != nil {
		log.Printf("[PAYMENT] Failed to update transaction: %v", err)
	}
}

// AddToMatchmakingQueue adds a player to the matchmaking queue after payment confirmation
func AddToMatchmakingQueue(db *sqlx.DB, rdb *redis.Client, cfg *config.Config, playerID int, phone string, stakeAmount float64, txnID int) {
	log.Printf("[PAYMENT] Adding player %d to matchmaking queue (stake=%.2f)", playerID, stakeAmount)

	// Get player info
	var player struct {
		ID          int    `db:"id"`
		PhoneNumber string `db:"phone_number"`
		DisplayName string `db:"display_name"`
	}
	if err := db.Get(&player, `SELECT id, phone_number, display_name FROM players WHERE id=$1`, playerID); err != nil {
		log.Printf("[PAYMENT] Failed to get player %d: %v", playerID, err)
		return
	}

	// Check for existing active queues
	var existingCount int
	if err := db.Get(&existingCount, `SELECT COUNT(*) FROM matchmaking_queue WHERE player_id=$1 AND status IN ('queued','processing','matching')`, playerID); err == nil && existingCount > 0 {
		log.Printf("[PAYMENT] Player %d already has an active queue entry, skipping", playerID)
		return
	}

	// Generate queue token and expiry
	queueToken := generateQueueToken()
	expiresAt := time.Now().Add(time.Duration(cfg.QueueExpiryMinutes) * time.Minute)

	// Insert into matchmaking_queue
	var queueID int
	insertQ := `INSERT INTO matchmaking_queue (player_id, phone_number, stake_amount, transaction_id, queue_token, status, created_at, expires_at)
				VALUES ($1,$2,$3,$4,$5,'queued',NOW(),$6) RETURNING id`
	if err := db.QueryRowx(insertQ, playerID, phone, stakeAmount, txnID, queueToken, expiresAt).Scan(&queueID); err != nil {
		log.Printf("[PAYMENT] Failed to insert matchmaking_queue for player %d: %v", playerID, err)
		return
	}

	log.Printf("[PAYMENT] ✓ Player %d added to queue: queue_id=%d stake=%.2f", playerID, queueID, stakeAmount)

	// Publish queue event to Redis for matchmaking
	eventData := fmt.Sprintf(`{"queue_id":%d,"player_id":%d,"stake_amount":%.2f}`, queueID, playerID, stakeAmount)
	if err := rdb.Publish(context.Background(), "matchmaking:queue", eventData).Err(); err != nil {
		log.Printf("[PAYMENT] Failed to publish queue event: %v", err)
	}
}

func generateQueueToken() string {
	return fmt.Sprintf("q_%d", time.Now().UnixNano())
}
