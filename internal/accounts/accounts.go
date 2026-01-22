package accounts

import (
	"database/sql"
	"fmt"
	"log"

	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/models"
)

// account types constants
const (
	AccountPlayerFeeExempt = "player_fee_exempt"
	AccountPlayerWinnings  = "player_winnings"
	AccountPlatform        = "platform"
	AccountEscrow          = "escrow"
	AccountSettlement      = "settlement"
	AccountTax             = "tax"
)

// GetOrCreateAccount returns an account for the given owner and type, creating it if missing
func GetOrCreateAccount(db *sqlx.DB, accountType string, ownerPlayerID *int) (*models.Account, error) {
	if db == nil {
		return nil, fmt.Errorf("db is nil")
	}

	var a models.Account
	if ownerPlayerID == nil {
		// system account
		if err := db.Get(&a, `SELECT id, account_type, owner_player_id, balance, created_at, updated_at FROM accounts WHERE account_type=$1 AND owner_player_id IS NULL`, accountType); err == nil {
			return &a, nil
		}
		// create
		if _, err := db.Exec(`INSERT INTO accounts (account_type, balance, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`, accountType, 0.0); err != nil {
			return nil, err
		}
		if err := db.Get(&a, `SELECT id, account_type, owner_player_id, balance, created_at, updated_at FROM accounts WHERE account_type=$1 AND owner_player_id IS NULL`, accountType); err != nil {
			return nil, err
		}
		return &a, nil
	}

	if err := db.Get(&a, `SELECT id, account_type, owner_player_id, balance, created_at, updated_at FROM accounts WHERE account_type=$1 AND owner_player_id=$2`, accountType, *ownerPlayerID); err == nil {
		return &a, nil
	}
	// create
	if _, err := db.Exec(`INSERT INTO accounts (account_type, owner_player_id, balance, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`, accountType, *ownerPlayerID, 0.0); err != nil {
		return nil, err
	}
	if err := db.Get(&a, `SELECT id, account_type, owner_player_id, balance, created_at, updated_at FROM accounts WHERE account_type=$1 AND owner_player_id=$2`, accountType, *ownerPlayerID); err != nil {
		return nil, err
	}
	return &a, nil
}

// Transfer performs a single debit/credit between accounts within an existing tx.
// It selects both accounts FOR UPDATE, checks balances, updates balances and inserts an account_transactions row.
func Transfer(tx *sqlx.Tx, debitAccountID, creditAccountID int, amount float64, referenceType string, referenceID sql.NullInt64, description string) error {
	if tx == nil {
		return fmt.Errorf("tx is nil")
	}

	// Lock both accounts
	var accounts []models.Account
	query := `SELECT id, account_type, owner_player_id, balance, created_at, updated_at FROM accounts WHERE id IN ($1,$2) FOR UPDATE`
	if err := tx.Select(&accounts, query, debitAccountID, creditAccountID); err != nil {
		return err
	}

	var debitAcc *models.Account
	var creditAcc *models.Account
	for i := range accounts {
		if accounts[i].ID == debitAccountID {
			debitAcc = &accounts[i]
		}
		if accounts[i].ID == creditAccountID {
			creditAcc = &accounts[i]
		}
	}
	if debitAcc == nil || creditAcc == nil {
		return fmt.Errorf("account not found for transfer")
	}

	// Basic balance check: don't allow negative balances for player-controlled accounts
	if (debitAcc.AccountType == AccountPlayerFeeExempt || debitAcc.AccountType == AccountPlayerWinnings) && debitAcc.Balance < amount {
		return fmt.Errorf("insufficient funds in account %d", debitAccountID)
	}

	// Update balances
	newDebitBalance := debitAcc.Balance - amount
	newCreditBalance := creditAcc.Balance + amount

	if _, err := tx.Exec(`UPDATE accounts SET balance=$1, updated_at=NOW() WHERE id=$2`, newDebitBalance, debitAcc.ID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE accounts SET balance=$1, updated_at=NOW() WHERE id=$2`, newCreditBalance, creditAcc.ID); err != nil {
		return err
	}

	// Insert account transaction
	if _, err := tx.Exec(`INSERT INTO account_transactions (debit_account_id, credit_account_id, amount, reference_type, reference_id, description, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`, debitAccountID, creditAccountID, amount, referenceType, referenceID, description); err != nil {
		return err
	}

	// Log successful transfer
	log.Printf("[ACCT] Transfer completed: debit_acc=%d credit_acc=%d amount=%.2f ref_type=%s ref_id=%v desc=%s", debitAccountID, creditAccountID, amount, referenceType, referenceID, description)

	return nil
}
