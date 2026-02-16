package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playpool/backend/internal/config"
	"github.com/redis/go-redis/v9"
)

// USSDResponse represents the response to USSD gateway
type USSDResponse struct {
	ResponseString string `json:"responseString"`
	Action         string `json:"action"` // "request" (continue) or "end" (terminate)
}

// HandleUSSD processes USSD gateway requests with session-based state management
func HandleUSSD(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Extract USSD gateway parameters
		sessionID := c.Query("sessionId")
		msisdn := c.Query("msisdn")
		inputString := c.Query("ussdRequestString")
		serviceCode := c.Query("ussdServiceCode")

		// Log incoming request for debugging
		log.Printf("[USSD] Incoming - SessionID: %s, MSISDN: %s, Input: %s, ServiceCode: %s",
			sessionID, msisdn, inputString, serviceCode)

		// Validate required parameters
		if sessionID == "" || msisdn == "" {
			log.Printf("[USSD] Missing required parameters")
			c.JSON(http.StatusOK, USSDResponse{
				ResponseString: "Service temporarily unavailable.",
				Action:         "end",
			})
			return
		}

		// Normalize phone number
		phone := normalizePhone(msisdn)
		if phone == "" {
			log.Printf("[USSD] Invalid phone number: %s", msisdn)
			c.JSON(http.StatusOK, USSDResponse{
				ResponseString: "Invalid phone number format.",
				Action:         "end",
			})
			return
		}

		log.Printf("[USSD] Normalized phone: %s -> %s", msisdn, phone)

		// Create or load USSD session handler
		handler, err := NewUSSDSessionHandler(sessionID, phone, db, rdb, cfg)
		if err != nil {
			log.Printf("[USSD] Failed to create session handler: %v", err)
			c.JSON(http.StatusOK, USSDResponse{
				ResponseString: "System error occurred. Please try again.",
				Action:         "end",
			})
			return
		}

		// Process USSD request using session-based approach
		response, action := handler.GetResponse(inputString)

		// Log response
		log.Printf("[USSD] Response - SessionID: %s, Action: %s, Text: %.50s...",
			sessionID, action, response)

		// Return response in expected format
		c.JSON(http.StatusOK, USSDResponse{
			ResponseString: response,
			Action:         action,
		})
	}
}
