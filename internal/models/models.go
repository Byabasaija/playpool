package models

import (
	"database/sql"
	"time"

	"github.com/lib/pq"
)

// Player represents a user in the system
type Player struct {
	ID               int            `db:"id" json:"id"`
	PhoneNumber      string         `db:"phone_number" json:"phone_number"`
	DisplayName      string         `db:"display_name" json:"display_name"`
	PlayerToken      string         `db:"player_token" json:"player_token,omitempty"`
	CreatedAt        time.Time      `db:"created_at" json:"created_at"`
	TotalGamesPlayed int            `db:"total_games_played" json:"total_games_played"`
	TotalGamesWon    int            `db:"total_games_won" json:"total_games_won"`
	TotalGamesDrawn  int            `db:"total_games_drawn" json:"total_games_drawn"`
	TotalWinnings    float64        `db:"total_winnings" json:"total_winnings"`
	IsActive         bool           `db:"is_active" json:"is_active"`
	IsBlocked        bool           `db:"is_blocked" json:"is_blocked"`
	BlockReason      sql.NullString `db:"block_reason" json:"block_reason,omitempty"`
	BlockUntil       sql.NullTime   `db:"block_until" json:"block_until,omitempty"`
	DisconnectCount  int            `db:"disconnect_count" json:"disconnect_count"`
	NoShowCount      int            `db:"no_show_count" json:"no_show_count"`
	LastActive       sql.NullTime   `db:"last_active" json:"last_active,omitempty"`
}

// Transaction represents a money transaction
type Transaction struct {
	ID                int          `db:"id" json:"id"`
	PlayerID          int          `db:"player_id" json:"player_id"`
	TransactionType   string       `db:"transaction_type" json:"transaction_type"`
	Amount            float64      `db:"amount" json:"amount"`
	MomoTransactionID string       `db:"momo_transaction_id" json:"momo_transaction_id,omitempty"`
	Status            string       `db:"status" json:"status"`
	CreatedAt         time.Time    `db:"created_at" json:"created_at"`
	CompletedAt       sql.NullTime `db:"completed_at" json:"completed_at,omitempty"`
}

// GameSession represents a game between two players
type GameSession struct {
	ID          int           `db:"id" json:"id"`
	GameToken   string        `db:"game_token" json:"game_token"`
	Player1ID   int           `db:"player1_id" json:"player1_id"`
	Player2ID   sql.NullInt64 `db:"player2_id" json:"player2_id,omitempty"`
	StakeAmount float64       `db:"stake_amount" json:"stake_amount"`
	Status      string        `db:"status" json:"status"`
	WinnerID    sql.NullInt64 `db:"winner_id" json:"winner_id,omitempty"`
	CreatedAt   time.Time     `db:"created_at" json:"created_at"`
	StartedAt   sql.NullTime  `db:"started_at" json:"started_at,omitempty"`
	CompletedAt sql.NullTime  `db:"completed_at" json:"completed_at,omitempty"`
	ExpiryTime  time.Time     `db:"expiry_time" json:"expiry_time"`
}

// EscrowLedger represents an escrow entry
type EscrowLedger struct {
	ID           int       `db:"id" json:"id"`
	SessionID    int       `db:"session_id" json:"session_id"`
	EntryType    string    `db:"entry_type" json:"entry_type"`
	PlayerID     int       `db:"player_id" json:"player_id"`
	Amount       float64   `db:"amount" json:"amount"`
	BalanceAfter float64   `db:"balance_after" json:"balance_after"`
	QueueID      int       `db:"queue_id" json:"queue_id,omitempty"`
	Description  string    `db:"description" json:"description,omitempty"`
	CreatedAt    time.Time `db:"created_at" json:"created_at"`
}

// MatchmakingQueue represents a player waiting for a match
type MatchmakingQueue struct {
	ID            int          `db:"id" json:"id"`
	PlayerID      int          `db:"player_id" json:"player_id"`
	PhoneNumber   string       `db:"phone_number" json:"phone_number"`
	StakeAmount   float64      `db:"stake_amount" json:"stake_amount"`
	TransactionID int          `db:"transaction_id" json:"transaction_id"`
	Status        string       `db:"status" json:"status"`
	CreatedAt     time.Time    `db:"created_at" json:"created_at"`
	MatchedAt     sql.NullTime `db:"matched_at" json:"matched_at,omitempty"`
	ExpiresAt     time.Time    `db:"expires_at" json:"expires_at"`
}

// GameMove represents a single move in a game
type GameMove struct {
	ID           int       `db:"id" json:"id"`
	SessionID    int       `db:"session_id" json:"session_id"`
	PlayerID     int       `db:"player_id" json:"player_id"`
	MoveNumber   int       `db:"move_number" json:"move_number"`
	MoveType     string    `db:"move_type" json:"move_type"`
	CardPlayed   string    `db:"card_played" json:"card_played,omitempty"`
	SuitDeclared string    `db:"suit_declared" json:"suit_declared,omitempty"`
	CreatedAt    time.Time `db:"created_at" json:"created_at"`
}

// Dispute represents a reported issue
type Dispute struct {
	ID          int          `db:"id" json:"id"`
	SessionID   int          `db:"session_id" json:"session_id"`
	ReportedBy  int          `db:"reported_by" json:"reported_by"`
	DisputeType string       `db:"dispute_type" json:"dispute_type"`
	Description string       `db:"description" json:"description,omitempty"`
	Status      string       `db:"status" json:"status"`
	Resolution  string       `db:"resolution" json:"resolution,omitempty"`
	CreatedAt   time.Time    `db:"created_at" json:"created_at"`
	ResolvedAt  sql.NullTime `db:"resolved_at" json:"resolved_at,omitempty"`
}

// Account represents an accounting bucket (player winnings, platform, escrow, settlement, tax, etc.)
type Account struct {
	ID            int           `db:"id" json:"id"`
	AccountType   string        `db:"account_type" json:"account_type"`
	OwnerPlayerID sql.NullInt64 `db:"owner_player_id" json:"owner_player_id,omitempty"`
	Balance       float64       `db:"balance" json:"balance"`
	CreatedAt     time.Time     `db:"created_at" json:"created_at"`
	UpdatedAt     time.Time     `db:"updated_at" json:"updated_at"`
}

// AccountTransaction records a debit/credit movement between accounts
type AccountTransaction struct {
	ID              int            `db:"id" json:"id"`
	DebitAccountID  sql.NullInt64  `db:"debit_account_id" json:"debit_account_id,omitempty"`
	CreditAccountID sql.NullInt64  `db:"credit_account_id" json:"credit_account_id,omitempty"`
	Amount          float64        `db:"amount" json:"amount"`
	ReferenceType   sql.NullString `db:"reference_type" json:"reference_type,omitempty"`
	ReferenceID     sql.NullInt64  `db:"reference_id" json:"reference_id,omitempty"`
	Description     sql.NullString `db:"description" json:"description,omitempty"`
	CreatedAt       time.Time      `db:"created_at" json:"created_at"`
}

// AdminAccount represents an admin operator account
type AdminAccount struct {
	Phone       string         `db:"phone" json:"phone"`
	DisplayName sql.NullString `db:"display_name" json:"display_name,omitempty"`
	TokenHash   string         `db:"token_hash" json:"-"`
	Roles       pq.StringArray `db:"roles" json:"roles,omitempty"`
	AllowedIPs  pq.StringArray `db:"allowed_ips" json:"allowed_ips,omitempty"`
	CreatedAt   time.Time      `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time      `db:"updated_at" json:"updated_at"`
}

// AdminAudit represents an audit log entry for admin actions
type AdminAudit struct {
	ID         int            `db:"id" json:"id"`
	AdminPhone sql.NullString `db:"admin_phone" json:"admin_phone,omitempty"`
	IP         sql.NullString `db:"ip" json:"ip,omitempty"`
	Route      sql.NullString `db:"route" json:"route,omitempty"`
	Action     sql.NullString `db:"action" json:"action,omitempty"`
	Details    sql.NullString `db:"details" json:"details,omitempty"` // JSONB stored as string
	Success    sql.NullBool   `db:"success" json:"success,omitempty"`
	CreatedAt  time.Time      `db:"created_at" json:"created_at"`
}
