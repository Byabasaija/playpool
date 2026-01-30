package payment

import (
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Phone number normalization
var phoneRegex = regexp.MustCompile(`^(7[0|5|7|8|9|4|6])(\d{7})$`)

// PhoneDetails contains normalized phone information
type PhoneDetails struct {
	NormalizedNumber string
	Network          string // "MTN" or "AIRTEL"
}

// NormalizePhoneNumber validates and normalizes Ugandan phone numbers
// Returns phone in 256XXXXXXXXX format and detects network (MTN vs Airtel)
func NormalizePhoneNumber(phone string) (*PhoneDetails, error) {
	phone = strings.TrimSpace(phone)

	// Remove leading '+'
	if strings.HasPrefix(phone, "+") {
		phone = phone[1:]
	}

	var localPart string
	if strings.HasPrefix(phone, "256") {
		localPart = phone[3:]
	} else if strings.HasPrefix(phone, "0") {
		localPart = phone[1:]
	} else {
		localPart = phone
	}

	// Validate and detect network
	match := phoneRegex.FindStringSubmatch(localPart)
	if match == nil {
		return nil, fmt.Errorf("invalid phone number format: %s", phone)
	}

	prefix := match[1]
	var network string

	// MTN: 77, 78, 76, 39, 79
	// Airtel: 70, 75, 74
	switch {
	case prefix == "77" || prefix == "78" || prefix == "76" || prefix == "39" || prefix == "79":
		network = "MTN"
	case prefix == "70" || prefix == "75" || prefix == "74":
		network = "AIRTEL"
	default:
		network = "UNKNOWN"
	}

	return &PhoneDetails{
		NormalizedNumber: "256" + localPart,
		Network:          network,
	}, nil
}

// GetPaymentMethod returns the DMarkPay payment method string for a phone number
func GetPaymentMethod(phone string) (string, error) {
	details, err := NormalizePhoneNumber(phone)
	if err != nil {
		return "", err
	}

	switch details.Network {
	case "MTN":
		return "mtn_mobile_money", nil
	case "AIRTEL":
		return "airtel_mobile_money", nil
	default:
		return "", fmt.Errorf("unknown network for phone: %s", phone)
	}
}

// Snowflake-style transaction ID generator
var (
	lastTimestamp int64
	sequence      int64
	mu            sync.Mutex

	nodeID       = int64(1) // 0-1023
	nodeBits     = 10
	sequenceBits = 12
	customEpoch  = int64(1700000000000) // milliseconds
	maxSequence  = (1 << sequenceBits) - 1
)

// GenerateTransactionID generates a unique 64-bit Snowflake ID
// Format: [timestamp (42 bits)][node ID (10 bits)][sequence (12 bits)]
func GenerateTransactionID() int64 {
	mu.Lock()
	defer mu.Unlock()

	ts := time.Now().UnixMilli() - customEpoch

	if ts < lastTimestamp {
		ts = lastTimestamp
	}

	if ts == lastTimestamp {
		sequence++
		if sequence > int64(maxSequence) {
			// Wait for next millisecond
			for ts <= lastTimestamp {
				time.Sleep(time.Millisecond)
				ts = time.Now().UnixMilli() - customEpoch
			}
			sequence = 0
		}
	} else {
		sequence = 0
	}

	lastTimestamp = ts

	// Construct 64-bit ID
	id := (ts << (nodeBits + sequenceBits)) | (nodeID << sequenceBits) | sequence
	return id
}
