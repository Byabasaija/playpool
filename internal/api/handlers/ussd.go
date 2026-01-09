package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/redis/go-redis/v9"
	"github.com/playmatatu/backend/internal/config"
)

// USSDResponse represents the response to USSD gateway
type USSDResponse struct {
	ResponseString string `json:"responseString"`
	Action         string `json:"action"` // "request" (continue) or "end" (terminate)
}

// HandleUSSD processes USSD gateway requests
func HandleUSSD(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		sessionID := c.Query("sessionId")
		msisdn := c.Query("msisdn")
		inputString := c.Query("ussdRequestString")
		// serviceCode := c.Query("ussdServiceCode")

		// Normalize phone number
		phone := normalizePhone(msisdn)
		if phone == "" {
			c.JSON(http.StatusOK, USSDResponse{
				ResponseString: "Invalid phone number.",
				Action:         "end",
			})
			return
		}

		// Process USSD input (stateless approach)
		response, action := processUSSD(sessionID, phone, inputString, cfg)

		c.JSON(http.StatusOK, USSDResponse{
			ResponseString: response,
			Action:         action,
		})
	}
}

// processUSSD handles USSD flow based on input string
func processUSSD(sessionID, phone, inputString string, cfg *config.Config) (string, string) {
	parts := strings.Split(inputString, "*")

	// Remove empty parts
	var cleanParts []string
	for _, p := range parts {
		if p != "" {
			cleanParts = append(cleanParts, p)
		}
	}

	switch len(cleanParts) {
	case 0:
		// Initial menu
		return "Welcome to PlayMatatu\n1. Play\n2. Rules", "request"

	case 1:
		switch cleanParts[0] {
		case "1":
			// Play selected - ask for stake
			return "Enter stake amount (UGX):\n(Minimum: 1000 UGX)", "request"
		case "2":
			// Rules
			return "MATATU RULES:\n- Match card by suit/rank\n- 8: Change suit\n- 2: Next player draws 2\n- J/A: Skip opponent\n- K: Play on any card\n- First to finish wins!", "end"
		default:
			return "Invalid option.\n1. Play\n2. Rules", "request"
		}

	case 2:
		// parts[0] = "1" (Play), parts[1] = stake amount
		stake, err := strconv.Atoi(cleanParts[1])
		if err != nil || stake < cfg.MinStakeAmount {
			return "Invalid amount. Minimum stake is 1000 UGX.\n\nEnter stake amount:", "request"
		}
		winAmount := int(float64(stake) * 2 * (1 - float64(cfg.CommissionPercentage)/100))
		return "Confirm payment of " + cleanParts[1] + " UGX to play Matatu?\nWin up to " + strconv.Itoa(winAmount) + " UGX!\n1. Yes\n2. No", "request"

	case 3:
		// parts[0] = "1", parts[1] = stake, parts[2] = confirm
		if cleanParts[2] == "1" {
			// TODO: Initiate Mobile Money collection
			// go initiatePayment(phone, stake, sessionID)
			return "Payment request sent to your phone.\nYou'll receive an SMS when matched with an opponent.", "end"
		}
		return "Cancelled. Dial " + cfg.USSDShortcode + " to play again.", "end"

	default:
		return "Invalid input. Dial " + cfg.USSDShortcode + " to start again.", "end"
	}
}
