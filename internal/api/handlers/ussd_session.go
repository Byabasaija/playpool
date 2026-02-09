package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/config"
	"github.com/redis/go-redis/v9"
)

// USSDSession represents a USSD session stored in Redis
type USSDSession struct {
	SessionID   string                 `json:"session_id"`
	MSISDN      string                 `json:"msisdn"`
	Method      string                 `json:"method"`       // Current handler method
	MethodLevel string                 `json:"method_level"` // Sub-step within method
	Data        map[string]interface{} `json:"data"`         // Session data storage
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
}

// USSDSessionHandler handles USSD session logic
type USSDSessionHandler struct {
	session *USSDSession
	db      *sqlx.DB
	rdb     *redis.Client
	cfg     *config.Config
	ctx     context.Context
}

// NewUSSDSessionHandler creates a new USSD session handler
func NewUSSDSessionHandler(sessionID, msisdn string, db *sqlx.DB, rdb *redis.Client, cfg *config.Config) (*USSDSessionHandler, error) {
	ctx := context.Background()

	// Try to load existing session from Redis
	sessionKey := fmt.Sprintf("ussd_session:%s", sessionID)
	sessionJSON, err := rdb.Get(ctx, sessionKey).Result()

	var session *USSDSession

	if err == nil {
		// Session exists, unmarshal it
		session = &USSDSession{}
		if err := json.Unmarshal([]byte(sessionJSON), session); err != nil {
			log.Printf("[USSD] Failed to unmarshal session %s: %v", sessionID, err)
			return nil, err
		}
		session.UpdatedAt = time.Now()
	} else {
		// New session
		session = &USSDSession{
			SessionID:   sessionID,
			MSISDN:      msisdn,
			Method:      "main_menu",
			MethodLevel: "",
			Data:        make(map[string]interface{}),
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
	}

	return &USSDSessionHandler{
		session: session,
		db:      db,
		rdb:     rdb,
		cfg:     cfg,
		ctx:     ctx,
	}, nil
}

// SaveSession persists the session to Redis with 5 minute TTL
func (h *USSDSessionHandler) SaveSession() error {
	sessionKey := fmt.Sprintf("ussd_session:%s", h.session.SessionID)
	sessionJSON, err := json.Marshal(h.session)
	if err != nil {
		return err
	}

	return h.rdb.Set(h.ctx, sessionKey, sessionJSON, 5*time.Minute).Err()
}

// GetResponse processes the current input and returns USSD response
func (h *USSDSessionHandler) GetResponse(inputString string) (string, string) {
	// Log for debugging
	log.Printf("[USSD] Session: %s, Method: %s, Level: %s, Input: %s",
		h.session.SessionID, h.session.Method, h.session.MethodLevel, inputString)

	// Route to appropriate handler based on method
	var response string
	var action string

	switch h.session.Method {
	case "main_menu":
		response, action = h.mainMenu(inputString)
	case "play_match":
		response, action = h.playMatch(inputString)
	case "my_account":
		response, action = h.myAccount(inputString)
	case "withdraw":
		response, action = h.withdraw(inputString)
	case "game_rules":
		response, action = h.gameRules(inputString)
	case "help":
		response, action = h.help(inputString)
	default:
		response = "System error. Please try again."
		action = "end"
	}

	// Save session state
	if err := h.SaveSession(); err != nil {
		log.Printf("[USSD] Failed to save session: %v", err)
	}

	return response, action
}

// mainMenu handles the main menu flow
func (h *USSDSessionHandler) mainMenu(inputString string) (string, string) {
	// First time - show main menu
	if h.session.MethodLevel == "" {
		h.session.MethodLevel = "awaiting_selection"
		return h.buildMainMenu(), "request"
	}

	// Handle menu selection
	switch inputString {
	case "1":
		h.session.Method = "play_match"
		h.session.MethodLevel = ""
		return h.playMatch("")
	case "2":
		h.session.Method = "my_account"
		h.session.MethodLevel = ""
		return h.myAccount("")
	case "3":
		h.session.Method = "withdraw"
		h.session.MethodLevel = ""
		return h.withdraw("")
	case "4":
		h.session.Method = "game_rules"
		h.session.MethodLevel = ""
		return h.gameRules("")
	case "5":
		h.session.Method = "help"
		h.session.MethodLevel = ""
		return h.help("")
	default:
		return "Invalid selection. Please try again.\n" + h.buildMainMenu(), "request"
	}
}

// buildMainMenu constructs the main menu text
func (h *USSDSessionHandler) buildMainMenu() string {
	return `Welcome to PlayMatatu
1. Play Match
2. My Account
3. Withdraw
4. Game Rules
5. Help`
}

// playMatch handles the play match flow
func (h *USSDSessionHandler) playMatch(inputString string) (string, string) {
	switch h.session.MethodLevel {
	case "":
		// Show match type selection
		h.session.MethodLevel = "select_match_type"
		return `Select match type:
1. Quick Match
2. Private Match
3. View Active Game
0. Back`, "request"

	case "select_match_type":
		switch inputString {
		case "0":
			// Back to main menu
			h.session.Method = "main_menu"
			h.session.MethodLevel = ""
			return h.buildMainMenu(), "request"
		case "1":
			// Quick match - ask for stake
			h.session.MethodLevel = "enter_stake"
			return fmt.Sprintf("Enter stake amount (UGX):\nMin: %d\nExamples: 1000, 2000, 5000\n0. Cancel", h.cfg.MinStakeAmount), "request"
		case "2":
			// Private match
			h.session.MethodLevel = "private_match_menu"
			return `Private Match:
1. Create match code
2. Join with code
0. Back`, "request"
		case "3":
			// View active game
			return h.checkActiveGame()
		default:
			return "Invalid selection.\n0. Back to main menu", "request"
		}

	case "enter_stake":
		if inputString == "0" {
			h.session.Method = "main_menu"
			h.session.MethodLevel = ""
			return h.buildMainMenu(), "request"
		}

		stake, err := strconv.Atoi(strings.ReplaceAll(inputString, ",", ""))
		if err != nil || stake < h.cfg.MinStakeAmount {
			return fmt.Sprintf("Invalid amount. Min: %d UGX\nEnter amount or 0 to cancel:", h.cfg.MinStakeAmount), "request"
		}

		// Store stake and show confirmation
		h.session.Data["stake"] = stake
		h.session.MethodLevel = "confirm_stake"

		commission := h.cfg.CommissionFlat
		total := stake + commission
		potentialWin := (stake * 2) - commission

		return fmt.Sprintf(`Stake: UGX %d
Commission: UGX %d
You pay: UGX %d
Potential win: UGX %d

1. Confirm & Pay
2. Change amount
0. Cancel`, stake, commission, total, potentialWin), "request"

	case "confirm_stake":
		switch inputString {
		case "1":
			// Initiate payment
			stake := h.session.Data["stake"].(int)
			// TODO: Integrate with payment system
			return fmt.Sprintf("Payment request for UGX %d sent to your phone.\nYou'll receive an SMS when matched with an opponent.", stake), "end"
		case "2":
			// Go back to stake entry
			h.session.MethodLevel = "enter_stake"
			return fmt.Sprintf("Enter stake amount (UGX):\nMin: %d\n0. Cancel", h.cfg.MinStakeAmount), "request"
		case "0":
			h.session.Method = "main_menu"
			h.session.MethodLevel = ""
			return h.buildMainMenu(), "request"
		default:
			return "Invalid selection.\n1. Confirm\n2. Change\n0. Cancel", "request"
		}

	case "private_match_menu":
		switch inputString {
		case "1":
			// Create match code
			matchCode := generateMatchCode(6)
			return fmt.Sprintf("Your match code: %s\nShare this code with your opponent.\nValid for 15 minutes.", matchCode), "end"
		case "2":
			// Join with code
			h.session.MethodLevel = "enter_match_code"
			return "Enter match code:", "request"
		case "0":
			h.session.MethodLevel = "select_match_type"
			return `Select match type:
1. Quick Match
2. Private Match
3. View Active Game
0. Back`, "request"
		default:
			return "Invalid selection.", "request"
		}

	case "enter_match_code":
		// TODO: Validate match code and initiate game
		matchCode := strings.ToUpper(inputString)
		return fmt.Sprintf("Joining match %s...\nYou'll receive an SMS with the game link.", matchCode), "end"

	default:
		return "Invalid operation.", "end"
	}
}

// checkActiveGame checks if player has an active game
func (h *USSDSessionHandler) checkActiveGame() (string, string) {
	// TODO: Query database for active game
	// For now, return placeholder
	return "No active game found.\nStart a new match to play!", "end"
}

// myAccount handles account balance and stats
func (h *USSDSessionHandler) myAccount(inputString string) (string, string) {
	switch h.session.MethodLevel {
	case "":
		h.session.MethodLevel = "show_account"
		// TODO: Fetch actual balance from database
		balance := 0
		gamesPlayed := 0
		gamesWon := 0

		return fmt.Sprintf(`My Account:
Balance: UGX %d
Games: %d played, %d won

1. View Balance Details
2. Transaction History
3. My Stats
0. Back`, balance, gamesPlayed, gamesWon), "request"

	case "show_account":
		switch inputString {
		case "1":
			// Balance details
			return `Account Balance:
- Available: UGX 0
- In Play: UGX 0
- Total Winnings: UGX 0

1. Play with balance
0. Back`, "request"
		case "2":
			// Transaction history
			return `Recent Transactions:
No transactions yet.

0. Back to account`, "request"
		case "3":
			// Stats
			return `Your Stats:
Games Played: 0
Games Won: 0
Win Rate: 0%
Total Winnings: UGX 0

0. Back`, "request"
		case "0":
			h.session.Method = "main_menu"
			h.session.MethodLevel = ""
			return h.buildMainMenu(), "request"
		default:
			return "Invalid selection.\n0. Back", "request"
		}

	default:
		if inputString == "0" {
			h.session.Method = "main_menu"
			h.session.MethodLevel = ""
			return h.buildMainMenu(), "request"
		}
		return "Invalid operation.", "end"
	}
}

// withdraw handles withdrawal requests
func (h *USSDSessionHandler) withdraw(inputString string) (string, string) {
	switch h.session.MethodLevel {
	case "":
		h.session.MethodLevel = "show_withdraw_menu"
		// TODO: Fetch actual balance
		balance := 0
		minWithdraw := h.cfg.MinWithdrawAmount

		return fmt.Sprintf(`Withdraw Funds
Available: UGX %d
Min withdrawal: UGX %d

Enter amount or:
1. Withdraw all
0. Cancel`, balance, minWithdraw), "request"

	case "show_withdraw_menu":
		if inputString == "0" {
			h.session.Method = "main_menu"
			h.session.MethodLevel = ""
			return h.buildMainMenu(), "request"
		}

		if inputString == "1" {
			// Withdraw all (placeholder)
			return "Insufficient balance to withdraw.", "end"
		}

		amount, err := strconv.Atoi(strings.ReplaceAll(inputString, ",", ""))
		if err != nil || amount < h.cfg.MinWithdrawAmount {
			return fmt.Sprintf("Invalid amount. Min: %d UGX\n0. Cancel", h.cfg.MinWithdrawAmount), "request"
		}

		// Store amount and show confirmation
		h.session.Data["withdraw_amount"] = amount
		h.session.MethodLevel = "confirm_withdraw"

		tax := int(float64(amount) * float64(h.cfg.PayoutTaxPercent) / 100)
		netAmount := amount - tax

		return fmt.Sprintf(`Withdraw: UGX %d
Fee: UGX %d (Tax %d%%)
You receive: UGX %d

Sent to: %s

1. Confirm
0. Cancel`, amount, tax, h.cfg.PayoutTaxPercent, netAmount, h.session.MSISDN), "request"

	case "confirm_withdraw":
		if inputString == "1" {
			// Process withdrawal
			amount := h.session.Data["withdraw_amount"].(int)
			// TODO: Process withdrawal
			return fmt.Sprintf("Withdrawal request for UGX %d submitted.\nYou'll receive the money shortly.", amount), "end"
		}
		h.session.Method = "main_menu"
		h.session.MethodLevel = ""
		return "Withdrawal cancelled.\n" + h.buildMainMenu(), "request"

	default:
		return "Invalid operation.", "end"
	}
}

// gameRules shows game rules
func (h *USSDSessionHandler) gameRules(inputString string) (string, string) {
	switch h.session.MethodLevel {
	case "":
		h.session.MethodLevel = "show_rules"
		return `MATATU RULES:

Basic:
- Match card suit/rank
- First to 0 cards wins

Special Cards:
1. View special effects
2. Play tips
0. Back to Main Menu`, "request"

	case "show_rules":
		switch inputString {
		case "1":
			return `Special Cards:
2: +2 draw
8: Change suit
J: Skip opponent
K: Play on anything
A: Choose suit + skip

For more: playmatatu.com/rules

0. Back`, "request"
		case "2":
			return `Play Tips:
- Save your 8s and Aces
- Watch opponent's cards
- Use skip cards wisely
- Don't let opponent finish

0. Back to main menu`, "request"
		case "0":
			h.session.Method = "main_menu"
			h.session.MethodLevel = ""
			return h.buildMainMenu(), "request"
		default:
			return "Invalid selection.\n0. Back", "request"
		}

	default:
		if inputString == "0" {
			h.session.Method = "main_menu"
			h.session.MethodLevel = ""
			return h.buildMainMenu(), "request"
		}
		return "Invalid operation.", "end"
	}
}

// help shows help and support information
func (h *USSDSessionHandler) help(inputString string) (string, string) {
	switch h.session.MethodLevel {
	case "":
		h.session.MethodLevel = "show_help"
		return `PlayMatatu Help:

1. How to play
2. Payment issues
3. Contact support
4. Terms & conditions
0. Back to Main Menu`, "request"

	case "show_help":
		switch inputString {
		case "1":
			return `How to Play:
1. Dial USSD code
2. Select stake amount
3. Get matched with opponent
4. Play on web/mobile
5. Winner takes pot!

playmatatu.com for more info

0. Back`, "request"
		case "2":
			return `Payment Issues:
- Check your Mobile Money balance
- Ensure PIN is correct
- Wait for payment prompt
- Contact support if issue persists

0. Back`, "request"
		case "3":
			h.session.MethodLevel = "contact_support"
			return `Support:
WhatsApp: +256700000000
Email: support@playmatatu.com
Hours: 8AM-10PM EAT

1. Report game issue
0. Back`, "request"
		case "4":
			return `Terms & Conditions:
- Must be 18+ to play
- Real money gaming
- Fair play enforced
- No cheating tolerated

Full terms at:
playmatatu.com/terms

0. Back`, "request"
		case "0":
			h.session.Method = "main_menu"
			h.session.MethodLevel = ""
			return h.buildMainMenu(), "request"
		default:
			return "Invalid selection.\n0. Back", "request"
		}

	case "contact_support":
		if inputString == "1" {
			return "Please describe your issue via WhatsApp or Email. Our team will assist you shortly.", "end"
		}
		if inputString == "0" {
			h.session.MethodLevel = "show_help"
			return `PlayMatatu Help:

1. How to play
2. Payment issues
3. Contact support
4. Terms & conditions
0. Back to Main Menu`, "request"
		}
		return "Invalid selection.", "request"

	default:
		if inputString == "0" {
			h.session.Method = "main_menu"
			h.session.MethodLevel = ""
			return h.buildMainMenu(), "request"
		}
		return "Invalid operation.", "end"
	}
}
