package payment

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/playmatatu/backend/internal/config"
	"github.com/redis/go-redis/v9"
)

// Client handles DMarkPay API integration
type Client struct {
	baseURL    string
	tokenURL   string
	username   string
	password   string
	wallet     string
	rdb        *redis.Client
	httpClient *http.Client
	cacheKey   string
}

// Default is the package-level default client
var Default *Client

// NewClient creates a new DMarkPay client
func NewClient(cfg *config.Config, rdb *redis.Client) *Client {
	if cfg == nil || cfg.DMarkPayBaseURL == "" || cfg.DMarkPayUsername == "" || cfg.DMarkPayPassword == "" {
		log.Printf("[PAYMENT] DMarkPay not fully configured - skipping initialization")
		return nil
	}

	return &Client{
		baseURL:    strings.TrimRight(cfg.DMarkPayBaseURL, "/"),
		tokenURL:   cfg.DMarkPayTokenURL,
		username:   cfg.DMarkPayUsername,
		password:   cfg.DMarkPayPassword,
		wallet:     cfg.DMarkPayWallet,
		rdb:        rdb,
		httpClient: &http.Client{Timeout: time.Duration(cfg.DMarkPayTimeout) * time.Second},
		cacheKey:   "dmark_pay_token:",
	}
}

// SetDefault sets the package-level default client
func SetDefault(c *Client) {
	Default = c
}

// getAccessToken fetches or retrieves cached OAuth2 token
func (c *Client) getAccessToken(ctx context.Context) (string, error) {
	// Try cache first
	if c.rdb != nil {
		cacheKey := c.cacheKey + c.username[:min(8, len(c.username))]
		if token, err := c.rdb.Get(ctx, cacheKey).Result(); err == nil {
			log.Printf("[PAYMENT] Using cached DMarkPay token")
			return token, nil
		}
	}

	// Fetch new token
	log.Printf("[PAYMENT] Fetching new DMarkPay access token")
	tokenEndpoint := c.baseURL + c.tokenURL
	log.Printf("[PAYMENT] Token endpoint: %s", tokenEndpoint)

	payload := "grant_type=client_credentials"
	req, err := http.NewRequestWithContext(ctx, "POST", tokenEndpoint, bytes.NewBufferString(payload))
	if err != nil {
		return "", fmt.Errorf("failed to create token request: %w", err)
	}

	// Basic auth
	auth := base64.StdEncoding.EncodeToString([]byte(c.username + ":" + c.password))
	req.Header.Set("Authorization", "Basic "+auth)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	log.Printf("[PAYMENT] Requesting token with username: %s", c.username[:min(10, len(c.username))]+"...")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("[PAYMENT] Token request failed: status=%d body=%s", resp.StatusCode, string(body))
		return "", fmt.Errorf("token request failed with status %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", fmt.Errorf("failed to decode token response: %w", err)
	}

	if tokenResp.AccessToken == "" {
		return "", errors.New("no access_token in response")
	}

	// Cache with 90% of expiry time
	if c.rdb != nil && tokenResp.ExpiresIn > 0 {
		cacheDuration := time.Duration(float64(tokenResp.ExpiresIn)*0.9) * time.Second
		cacheKey := c.cacheKey + c.username[:min(8, len(c.username))]
		c.rdb.Set(ctx, cacheKey, tokenResp.AccessToken, cacheDuration)
		log.Printf("[PAYMENT] Cached token for %v", cacheDuration)
	}

	return tokenResp.AccessToken, nil
}

// GetAccountWallet determines which wallet to use based on phone number
func (c *Client) GetAccountWallet(msisdn string) (string, error) {
	// If "dmark" wallet configured, always use it
	if c.wallet == "dmark" {
		return "dmark", nil
	}

	// Otherwise, detect based on phone network
	details, err := NormalizePhoneNumber(msisdn)
	if err != nil {
		return "", err
	}

	switch details.Network {
	case "MTN":
		return "mtn", nil
	case "AIRTEL":
		return "airtel_oapi", nil
	default:
		return "", fmt.Errorf("unknown network for wallet selection")
	}
}

// PayinRequest represents a collection request
type PayinRequest struct {
	Phone         string
	Amount        float64
	TransactionID string
	NotifyURL     string
	Description   string
}

// PayinResponse represents DMarkPay payin response
type PayinResponse struct {
	Status          string `json:"status"`
	StatusCode      string `json:"status_code"`
	TransactionID   string `json:"transaction_id"`
	SPTransactionID string `json:"sp_transaction_id"`
	Message         string `json:"message"`
}

// Payin initiates a mobile money collection
func (c *Client) Payin(ctx context.Context, req PayinRequest) (*PayinResponse, error) {
	if c == nil {
		return nil, errors.New("dmark pay client not initialized")
	}

	// Get access token with retry
	var token string
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		var err error
		token, err = c.getAccessToken(ctx)
		if err == nil {
			break
		}
		lastErr = err
		time.Sleep(time.Duration(100+attempt*200) * time.Millisecond)
	}
	if token == "" {
		return nil, fmt.Errorf("failed to get access token: %w", lastErr)
	}

	// Normalize phone
	phoneDetails, err := NormalizePhoneNumber(req.Phone)
	if err != nil {
		return nil, fmt.Errorf("invalid phone number: %w", err)
	}

	// Determine wallet and payment method
	wallet, err := c.GetAccountWallet(req.Phone)
	if err != nil {
		return nil, err
	}

	paymentMethod, err := GetPaymentMethod(req.Phone)
	if err != nil {
		return nil, err
	}

	// Build request
	endpoint := fmt.Sprintf("%s/api/v1/accounts/%s/transactions/payin/", c.baseURL, c.wallet)

	payload := map[string]interface{}{
		"wallet":            wallet,
		"payment_method":    paymentMethod,
		"msisdn":            phoneDetails.NormalizedNumber,
		"description":       req.Description,
		"amount":            fmt.Sprintf("%.2f", req.Amount),
		"sp_transaction_id": req.TransactionID,
	}

	if req.NotifyURL != "" {
		payload["notify_url"] = req.NotifyURL
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload: %w", err)
	}

	log.Printf("[PAYMENT] Initiating payin: phone=%s amount=%.2f txn=%s endpoint=%s", req.Phone, req.Amount, req.TransactionID, endpoint)
	log.Printf("[PAYMENT] Payin payload: %s", string(jsonPayload))

	// Send request with retry for transient errors
	for attempt := 0; attempt < 3; attempt++ {
		httpReq, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewBuffer(jsonPayload))
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}

		httpReq.Header.Set("Authorization", "Bearer "+token)
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Accept", "application/json")

		resp, err := c.httpClient.Do(httpReq)
		if err != nil {
			lastErr = err
			if attempt < 2 {
				time.Sleep(time.Duration(100+attempt*200) * time.Millisecond)
				continue
			}
			return nil, fmt.Errorf("payin request failed: %w", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("failed to read response: %w", err)
		}

		log.Printf("[PAYMENT] Payin response: status=%d body=%s", resp.StatusCode, string(body))

		var payinResp PayinResponse
		if err := json.Unmarshal(body, &payinResp); err != nil {
			// If 403, try to clear token cache and fail (user can retry with fresh token)
			if resp.StatusCode == http.StatusForbidden && c.rdb != nil {
				cacheKey := c.cacheKey + c.username[:min(8, len(c.username))]
				c.rdb.Del(ctx, cacheKey)
				log.Printf("[PAYMENT] 403 error - cleared cached token")
			}
			return nil, fmt.Errorf("failed to decode response: %w (body: %s)", err, string(body))
		}

		// Success
		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
			log.Printf("[PAYMENT] Payin initiated: status=%s code=%s dmark_id=%s",
				payinResp.Status, payinResp.StatusCode, payinResp.TransactionID)
			return &payinResp, nil
		}

		// If 403, clear token cache and don't retry
		if resp.StatusCode == http.StatusForbidden {
			if c.rdb != nil {
				cacheKey := c.cacheKey + c.username[:min(8, len(c.username))]
				c.rdb.Del(ctx, cacheKey)
				log.Printf("[PAYMENT] 403 error - cleared cached token")
			}
			return &payinResp, fmt.Errorf("payin failed (auth error): %d - %s", resp.StatusCode, payinResp.Message)
		}

		// Retry on 5xx errors
		if resp.StatusCode >= 500 && attempt < 2 {
			lastErr = fmt.Errorf("payin failed with status %d: %s", resp.StatusCode, string(body))
			time.Sleep(time.Duration(100+attempt*200) * time.Millisecond)
			continue
		}

		// 4xx errors - don't retry
		return &payinResp, fmt.Errorf("payin failed: %d - %s", resp.StatusCode, payinResp.Message)
	}

	return nil, fmt.Errorf("payin failed after retries: %w", lastErr)
}

// PayoutRequest represents a payout request
type PayoutRequest struct {
	Phone         string
	Amount        float64
	TransactionID string
	Description   string
}

// PayoutResponse represents DMarkPay payout response
type PayoutResponse struct {
	Status          string `json:"status"`
	StatusCode      string `json:"status_code"`
	TransactionID   string `json:"transaction_id"`
	SPTransactionID string `json:"sp_transaction_id"`
	Message         string `json:"message"`
}

// Payout initiates a mobile money payout (synchronous - immediate response)
func (c *Client) Payout(ctx context.Context, req PayoutRequest) (*PayoutResponse, error) {
	if c == nil {
		return nil, errors.New("dmark pay client not initialized")
	}

	// Get access token with retry
	var token string
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		var err error
		token, err = c.getAccessToken(ctx)
		if err == nil {
			break
		}
		lastErr = err
		time.Sleep(time.Duration(100+attempt*200) * time.Millisecond)
	}
	if token == "" {
		return nil, fmt.Errorf("failed to get access token: %w", lastErr)
	}

	// Normalize phone
	phoneDetails, err := NormalizePhoneNumber(req.Phone)
	if err != nil {
		return nil, fmt.Errorf("invalid phone number: %w", err)
	}

	// Determine wallet and payment method
	wallet, err := c.GetAccountWallet(req.Phone)
	if err != nil {
		return nil, err
	}

	paymentMethod, err := GetPaymentMethod(req.Phone)
	if err != nil {
		return nil, err
	}

	// Build request
	endpoint := fmt.Sprintf("%s/api/v1/accounts/%s/transactions/payout/", c.baseURL, c.wallet)

	payload := map[string]interface{}{
		"wallet":            wallet,
		"payment_method":    paymentMethod,
		"msisdn":            phoneDetails.NormalizedNumber,
		"description":       req.Description,
		"amount":            fmt.Sprintf("%.2f", req.Amount),
		"sp_transaction_id": req.TransactionID,
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload: %w", err)
	}

	log.Printf("[PAYMENT] Initiating payout: phone=%s amount=%.2f txn=%s", req.Phone, req.Amount, req.TransactionID)

	// Send request with retry for transient errors
	for attempt := 0; attempt < 3; attempt++ {
		httpReq, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewBuffer(jsonPayload))
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}

		httpReq.Header.Set("Authorization", "Bearer "+token)
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Accept", "application/json")

		resp, err := c.httpClient.Do(httpReq)
		if err != nil {
			lastErr = err
			if attempt < 2 {
				time.Sleep(time.Duration(100+attempt*200) * time.Millisecond)
				continue
			}
			return nil, fmt.Errorf("payout request failed: %w", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("failed to read response: %w", err)
		}

		var payoutResp PayoutResponse
		if err := json.Unmarshal(body, &payoutResp); err != nil {
			return nil, fmt.Errorf("failed to decode response: %w", err)
		}

		// Success
		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
			log.Printf("[PAYMENT] Payout initiated: status=%s code=%s dmark_id=%s",
				payoutResp.Status, payoutResp.StatusCode, payoutResp.TransactionID)
			return &payoutResp, nil
		}

		// Retry on 5xx errors
		if resp.StatusCode >= 500 && attempt < 2 {
			lastErr = fmt.Errorf("payout failed with status %d: %s", resp.StatusCode, string(body))
			time.Sleep(time.Duration(100+attempt*200) * time.Millisecond)
			continue
		}

		// 4xx errors - don't retry
		return &payoutResp, fmt.Errorf("payout failed: %d - %s", resp.StatusCode, payoutResp.Message)
	}

	return nil, fmt.Errorf("payout failed after retries: %w", lastErr)
}

// GetTransactionStatus checks the status of a transaction
func (c *Client) GetTransactionStatus(ctx context.Context, dmarkTransactionID string) (*PayinResponse, error) {
	if c == nil {
		return nil, errors.New("dmark pay client not initialized")
	}

	token, err := c.getAccessToken(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get access token: %w", err)
	}

	endpoint := fmt.Sprintf("%s/api/v1/accounts/%s/transactions/%s/", c.baseURL, c.wallet, dmarkTransactionID)

	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("status request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var statusResp PayinResponse
	if err := json.Unmarshal(body, &statusResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return &statusResp, fmt.Errorf("status check failed: %d - %s", resp.StatusCode, statusResp.Message)
	}

	return &statusResp, nil
}

// Helper function for min (Go doesn't have built-in min for int)
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
