package handlers

import (
	"crypto/rand"
	"math/big"
)

// normalizePhone normalizes phone number to international format (no leading '+')
// Returns digits like: 256700123456
func normalizePhone(phone string) string {
	// Remove all non-digit characters
	digits := ""
	for _, char := range phone {
		if char >= '0' && char <= '9' {
			digits += string(char)
		}
	}

	// Handle Uganda phone numbers (expecting 9 local digits)
	if len(digits) == 9 && (digits[0] == '7' || digits[0] == '3') {
		return "256" + digits
	} else if len(digits) == 10 && digits[0] == '0' {
		return "256" + digits[1:]
	} else if len(digits) == 12 && digits[:3] == "256" {
		return digits
	} else if len(phone) > 0 && phone[0] == '+' && len(digits) == 12 && digits[:3] == "256" {
		return digits
	}

	return ""
}

// generateID generates a random alphanumeric ID
func generateID(length int) string {
	const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, length)
	for i := range result {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		result[i] = charset[n.Int64()]
	}
	return string(result)
}

// generateTransactionID generates a unique transaction ID
func generateTransactionID() string {
	return "TXN_" + generateID(10)
}

// generateQueueID generates a unique queue ID
func generateQueueID() string {
	return "QUEUE_" + generateID(8)
}

// generateGameToken generates a unique game token
func generateGameToken() string {
	return "GAME_" + generateID(10)
}
