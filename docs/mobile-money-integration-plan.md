# Mobile Money Integration Plan (DMarkPay)

## Overview

This plan details the integration of real mobile money payments via DMarkPay API to replace the current mock/dummy payment system. The integration will handle both **collections (payin)** for deposits and **payouts** for withdrawals.

**Current State:**
- Deposits: Dummy mode (auto-approved, no real payment)
- Withdrawals: Mock mode (simulated 2-second delay, no real payout)
- No external provider integration

**Target State:**
- Deposits: Real mobile money collection via DMarkPay payin API
- Withdrawals: Real mobile money payout via DMarkPay payout API
- Async webhook handling for payment status updates
- Transaction tracking with external provider IDs
- Retry logic and error handling

---

## Architecture Components

### 1. DMarkPay Client Package
**New Package:** `/internal/payment/dmark.go`

Responsibilities:
- OAuth2 token management with Redis caching
- Payin (collection) API calls
- Payout API calls
- Transaction status checking
- Phone number normalization (256XXXXXXXXX format)
- Network detection (MTN vs Airtel)
- Wallet selection logic (dmark/mtn/airtel)
- Retry logic for transient errors

### 2. Webhook Handler
**New File:** `/internal/api/handlers/payment_webhook.go`

Responsibilities:
- Receive DMarkPay webhook callbacks for **deposits only** (withdrawals are immediate)
- NO signature validation needed
- Update transaction status based on webhook
- Trigger follow-up actions (SMS notifications, matchmaking)
- Idempotency protection (prevent duplicate processing)

### 3. Database Schema Updates
**New Migration:** `000013_add_mobile_money_fields.up.sql`

Changes:
- Add `dmark_transaction_id` to `transactions` table
- Add `dmark_transaction_id` to `withdraw_requests` table
- Add `provider_status_code` to both tables
- Create `payment_webhooks` table for audit trail
- Add indexes for fast lookups

### 4. Configuration Updates
**File:** `/internal/config/config.go`

New settings:
- DMarkPay API credentials (base URL, username, password)
- DMarkPay wallet name configuration
- Webhook callback URL (for deposit callbacks only)
- Payment timeout settings

---

## Implementation Phases

### Phase 1: Infrastructure Setup

#### 1.1 Configuration (config.go)

Add to `Config` struct:
```go
// DMarkPay Mobile Money Gateway
DMarkPayBaseURL      string
DMarkPayTokenURL     string
DMarkPayUsername     string
DMarkPayPassword     string
DMarkPayWallet       string  // "dmark", "mtn", "airtel_oapi"
DMarkPayCallbackURL  string
DMarkPayTimeout      int     // Default: 30 seconds
```

Add to `Load()` function:
```go
DMarkPayBaseURL:     getEnv("DMARK_PAY_BASE_URL", "https://wallet.dmarkmobile.com"),
DMarkPayTokenURL:    getEnv("DMARK_PAY_TOKEN_URL", "/o/token/"),
DMarkPayUsername:    getEnv("DMARK_PAY_USERNAME", ""),
DMarkPayPassword:    getEnv("DMARK_PAY_PASSWORD", ""),
DMarkPayWallet:      getEnv("DMARK_PAY_WALLET", "dmark"),
DMarkPayCallbackURL: getEnv("DMARK_PAY_CALLBACK_URL", ""),
DMarkPayTimeout:     getEnvInt("DMARK_PAY_TIMEOUT", 30),
```

#### 1.2 Database Migration

**File:** `/migrations/000013_add_mobile_money_fields.up.sql`

```sql
-- Add DMarkPay tracking to transactions
ALTER TABLE transactions
ADD COLUMN dmark_transaction_id VARCHAR(100),
ADD COLUMN provider_status_code VARCHAR(10),
ADD COLUMN provider_status_message TEXT;

CREATE INDEX idx_transactions_dmark_id ON transactions(dmark_transaction_id);

-- Add DMarkPay tracking to withdraw_requests
ALTER TABLE withdraw_requests
ADD COLUMN dmark_transaction_id VARCHAR(100),
ADD COLUMN provider_status_code VARCHAR(10),
ADD COLUMN provider_status_message TEXT;

CREATE INDEX idx_withdraw_requests_dmark_id ON withdraw_requests(dmark_transaction_id);

-- Create payment webhooks audit table (payin only - withdrawals are immediate)
CREATE TABLE IF NOT EXISTS payment_webhooks (
    id SERIAL PRIMARY KEY,
    dmark_transaction_id VARCHAR(100) NOT NULL,
    sp_transaction_id VARCHAR(100),
    status VARCHAR(50),
    status_code VARCHAR(10),
    payload JSONB,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webhooks_dmark_id ON payment_webhooks(dmark_transaction_id);
CREATE INDEX idx_webhooks_sp_id ON payment_webhooks(sp_transaction_id);
CREATE INDEX idx_webhooks_processed ON payment_webhooks(processed);
```

**File:** `/migrations/000013_add_mobile_money_fields.down.sql`

```sql
DROP INDEX IF EXISTS idx_webhooks_processed;
DROP INDEX IF EXISTS idx_webhooks_sp_id;
DROP INDEX IF EXISTS idx_webhooks_dmark_id;
DROP TABLE IF EXISTS payment_webhooks;

ALTER TABLE withdraw_requests
DROP COLUMN IF EXISTS provider_status_message,
DROP COLUMN IF EXISTS provider_status_code,
DROP COLUMN IF EXISTS dmark_transaction_id;

DROP INDEX IF EXISTS idx_withdraw_requests_dmark_id;

ALTER TABLE transactions
DROP COLUMN IF EXISTS provider_status_message,
DROP COLUMN IF EXISTS provider_status_code,
DROP COLUMN IF EXISTS dmark_transaction_id;

DROP INDEX IF EXISTS idx_transactions_dmark_id;
```

#### 1.3 Utility Functions

**New File:** `/internal/payment/utils.go`

```go
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

type PhoneDetails struct {
    NormalizedNumber string
    Network          string  // "MTN" or "AIRTEL"
}

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

    nodeID         = int64(1)  // 0-1023
    nodeBits       = 10
    sequenceBits   = 12
    customEpoch    = int64(1700000000000) // milliseconds
    maxSequence    = (1 << sequenceBits) - 1
)

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
```

---

### Phase 2: DMarkPay Client Implementation

**New File:** `/internal/payment/dmark.go`

```go
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

func SetDefault(c *Client) {
    Default = c
}

// getAccessToken fetches or retrieves cached OAuth2 token
func (c *Client) getAccessToken(ctx context.Context) (string, error) {
    // Try cache first
    if c.rdb != nil {
        cacheKey := c.cacheKey + c.username[:8]
        if token, err := c.rdb.Get(ctx, cacheKey).Result(); err == nil {
            log.Printf("[PAYMENT] Using cached DMarkPay token")
            return token, nil
        }
    }

    // Fetch new token
    log.Printf("[PAYMENT] Fetching new DMarkPay access token")
    tokenEndpoint := c.baseURL + c.tokenURL

    payload := "grant_type=client_credentials"
    req, err := http.NewRequestWithContext(ctx, "POST", tokenEndpoint, bytes.NewBufferString(payload))
    if err != nil {
        return "", fmt.Errorf("failed to create token request: %w", err)
    }

    // Basic auth
    auth := base64.StdEncoding.EncodeToString([]byte(c.username + ":" + c.password))
    req.Header.Set("Authorization", "Basic "+auth)
    req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

    resp, err := c.httpClient.Do(req)
    if err != nil {
        return "", fmt.Errorf("token request failed: %w", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        body, _ := io.ReadAll(resp.Body)
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
        cacheKey := c.cacheKey + c.username[:8]
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

    log.Printf("[PAYMENT] Initiating payin: phone=%s amount=%.2f txn=%s", req.Phone, req.Amount, req.TransactionID)

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

        var payinResp PayinResponse
        if err := json.Unmarshal(body, &payinResp); err != nil {
            return nil, fmt.Errorf("failed to decode response: %w", err)
        }

        // Success
        if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
            log.Printf("[PAYMENT] Payin initiated: status=%s code=%s dmark_id=%s",
                payinResp.Status, payinResp.StatusCode, payinResp.TransactionID)
            return &payinResp, nil
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
    NotifyURL     string
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

// Payout initiates a mobile money payout
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

    if req.NotifyURL != "" {
        payload["notify_url"] = req.NotifyURL
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
```

---

### Phase 3: Integrate Payin (Deposits) with Webhook

#### 3.1 Update InitiateStake Handler

**File:** `/internal/api/handlers/game.go` (around line 214)

Replace dummy payment logic with real DMarkPay payin:

```go
import (
    "github.com/playmatatu/backend/internal/payment"
)

// Real payment collection
if payment.Default != nil {
    // Generate unique transaction ID
    txnID := fmt.Sprintf("%d", payment.GenerateTransactionID())

    // Build callback URL
    callbackURL := fmt.Sprintf("%s/api/v1/webhooks/dmark", cfg.DMarkPayCallbackURL)

    // Initiate payin
    payinReq := payment.PayinRequest{
        Phone:         phone,
        Amount:        float64(req.StakeAmount + cfg.CommissionFlat),
        TransactionID: txnID,
        NotifyURL:     callbackURL,
        Description:   fmt.Sprintf("Matatu stake: %d UGX", req.StakeAmount),
    }

    payinResp, err := payment.Default.Payin(context.Background(), payinReq)
    if err != nil {
        log.Printf("[PAYMENT] Payin failed for %s: %v", phone, err)
        c.JSON(http.StatusInternalServerError, gin.H{"error": "payment initiation failed"})
        return
    }

    // Create transaction record with status='PENDING'
    if db != nil {
        _, err = db.Exec(`INSERT INTO transactions
            (player_id, transaction_type, amount, status, dmark_transaction_id, provider_status_code, provider_status_message, created_at)
            VALUES ($1, 'STAKE', $2, 'PENDING', $3, $4, $5, NOW())`,
            player.ID,
            float64(req.StakeAmount+cfg.CommissionFlat),
            payinResp.TransactionID,
            payinResp.StatusCode,
            payinResp.Status)
        if err != nil {
            log.Printf("[PAYMENT] Failed to create transaction: %v", err)
        }
    }

    // Return success - payment is pending
    c.JSON(http.StatusOK, gin.H{
        "message": "Payment initiated. Please complete on your phone.",
        "transaction_id": txnID,
        "dmark_transaction_id": payinResp.TransactionID,
        "status": "PENDING",
    })
    return
} else {
    // Fallback to dummy mode
    log.Printf("[DUMMY PAYMENT] Would charge %s %d UGX", phone, req.StakeAmount+cfg.CommissionFlat)
}
```

**Note:** Account movements (SETTLEMENT → PLATFORM + PLAYER_WINNINGS) happen in webhook handler, NOT here.

#### 3.2 Create Payin Webhook Handler

**New File:** `/internal/api/handlers/payment_webhook.go`

```go
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
```

#### 3.3 Register Webhook Route

**File:** `/internal/api/routes.go`

Add webhook endpoint:

```go
// Webhook endpoint (no auth required)
v1.POST("/webhooks/dmark", handlers.DMarkPayinWebhook(db, cfg))
```

---

### Phase 4: Integrate Payout (Withdrawals) - Immediate/Synchronous

**Key Difference:** Withdrawals are processed IMMEDIATELY with synchronous API response. NO webhook needed.

#### 4.1 Update Auto-Withdrawal Logic

**File:** `/internal/game/manager.go`

Replace `processAutoWithdrawMock()` with real payout:

```go
import (
    "github.com/playmatatu/backend/internal/payment"
)

// processAutoWithdrawReal replaces the mock version
func (gm *GameManager) processAutoWithdrawReal(reqID, playerID int, amount float64, phone string, pot, taxAmount float64) {
    log.Printf("[AUTO-WITHDRAW] Processing real payout: req=%d player=%d amount=%.2f phone=%s", reqID, playerID, amount, phone)

    // Generate transaction ID
    txnID := fmt.Sprintf("%d", payment.GenerateTransactionID())

    // Send initial SMS
    smsMsg := fmt.Sprintf(
        "Congratulations! You won on PlayMatatu!\n\nPot: %.0f UGX\nTax (15%%): -%.0f UGX\nWinnings: %.0f UGX\n\nPayout being sent to %s. (Telecom fees apply)",
        pot, taxAmount, amount, phone,
    )
    if gm.smsService.Default != nil {
        gm.smsService.SendSMS(context.Background(), phone, smsMsg)
    }

    // Initiate payout (SYNCHRONOUS - no callback needed)
    payoutReq := payment.PayoutRequest{
        Phone:         phone,
        Amount:        amount,
        TransactionID: txnID,
        Description:   fmt.Sprintf("Matatu winnings payout: %.0f UGX", amount),
    }

    payoutResp, err := payment.Default.Payout(context.Background(), payoutReq)
    if err != nil {
        log.Printf("[AUTO-WITHDRAW] Payout failed: %v", err)
        gm.refundWithdrawal(reqID, playerID, amount, fmt.Sprintf("Payout failed: %v", err))
        return
    }

    // Check immediate response
    if payoutResp.StatusCode != "0" {
        log.Printf("[AUTO-WITHDRAW] Payout rejected: %s", payoutResp.Message)
        gm.refundWithdrawal(reqID, playerID, amount, payoutResp.Message)
        return
    }

    // SUCCESS - complete payout immediately
    tx, err := gm.db.Beginx()
    if err != nil {
        log.Printf("[AUTO-WITHDRAW] Failed to begin transaction: %v", err)
        return
    }
    defer tx.Rollback()

    settlementAcc, _ := accounts.GetOrCreateAccount(gm.db, accounts.AccountSettlement, nil)

    // Deduct from settlement
    _, err = tx.Exec(`UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2`, amount, settlementAcc.ID)
    if err != nil {
        log.Printf("[AUTO-WITHDRAW] Failed to deduct from settlement: %v", err)
        return
    }

    // Record external payout
    _, err = tx.Exec(`INSERT INTO account_transactions
        (debit_account_id, credit_account_id, amount, reference_type, reference_id, description, created_at)
        VALUES ($1, NULL, $2, 'WITHDRAW', $3, 'Payout completed', NOW())`,
        settlementAcc.ID, amount, reqID)
    if err != nil {
        log.Printf("[AUTO-WITHDRAW] Failed to record payout: %v", err)
        return
    }

    // Insert transaction record
    _, err = tx.Exec(`INSERT INTO transactions
        (player_id, transaction_type, amount, status, dmark_transaction_id, provider_status_code, provider_status_message, created_at, completed_at)
        VALUES ($1, 'WITHDRAW', $2, 'COMPLETED', $3, $4, $5, NOW(), NOW())`,
        playerID, amount, payoutResp.TransactionID, payoutResp.StatusCode, payoutResp.Status)
    if err != nil {
        log.Printf("[AUTO-WITHDRAW] Failed to insert transaction: %v", err)
        return
    }

    // Update withdraw request
    _, err = tx.Exec(`UPDATE withdraw_requests SET
        status='COMPLETED',
        processed_at=NOW(),
        dmark_transaction_id=$1,
        provider_status_code=$2,
        provider_status_message=$3
        WHERE id=$4`,
        payoutResp.TransactionID, payoutResp.StatusCode, payoutResp.Status, reqID)
    if err != nil {
        log.Printf("[AUTO-WITHDRAW] Failed to update withdraw request: %v", err)
        return
    }

    if err := tx.Commit(); err != nil {
        log.Printf("[AUTO-WITHDRAW] Failed to commit: %v", err)
        return
    }

    log.Printf("[AUTO-WITHDRAW] ✓ Payout completed: req=%d amount=%.2f dmark_txn=%s", reqID, amount, payoutResp.TransactionID)

    // Send confirmation SMS
    confirmMsg := fmt.Sprintf(
        "PlayMatatu: Your winnings of %.0f UGX have been sent to %s. (Telecom fees apply). Thank you for playing!",
        amount, phone,
    )
    if gm.smsService.Default != nil {
        gm.smsService.SendSMS(context.Background(), phone, confirmMsg)
    }
}

// refundWithdrawal handles payout failure by refunding to player winnings
func (gm *GameManager) refundWithdrawal(reqID, playerID int, amount float64, reason string) {
    log.Printf("[AUTO-WITHDRAW] Refunding withdrawal %d: %.2f UGX", reqID, amount)

    tx, err := gm.db.Beginx()
    if err != nil {
        log.Printf("[AUTO-WITHDRAW] Failed to begin refund transaction: %v", err)
        return
    }
    defer tx.Rollback()

    settlementAcc, _ := accounts.GetOrCreateAccount(gm.db, accounts.AccountSettlement, nil)
    winningsAcc, _ := accounts.GetOrCreateAccount(gm.db, accounts.AccountPlayerWinnings, &playerID)

    // SETTLEMENT → PLAYER_WINNINGS (refund)
    err = accounts.Transfer(tx, settlementAcc.ID, winningsAcc.ID, amount,
        "WITHDRAW_REFUND", sql.NullInt64{Int64: int64(reqID), Valid: true}, "Payout failed - refund")

    if err != nil {
        log.Printf("[AUTO-WITHDRAW] Failed to refund: %v", err)
        return
    }

    // Update withdraw request
    _, err = tx.Exec(`UPDATE withdraw_requests SET status='FAILED', processed_at=NOW(), note=$1 WHERE id=$2`, reason, reqID)
    if err != nil {
        log.Printf("[AUTO-WITHDRAW] Failed to update withdraw request: %v", err)
        return
    }

    if err := tx.Commit(); err != nil {
        log.Printf("[AUTO-WITHDRAW] Failed to commit refund: %v", err)
        return
    }

    log.Printf("[AUTO-WITHDRAW] ✓ Withdrawal refunded: req=%d amount=%.2f", reqID, amount)
}
```

**Update `autoWithdrawWinnings()` to call real payout:**

```go
// In autoWithdrawWinnings(), replace:
// go gm.processAutoWithdrawMock(...)

// With:
if payment.Default != nil {
    go gm.processAutoWithdrawReal(reqID, playerID, amount, player.PhoneNumber, pot, taxAmount)
} else {
    log.Printf("[AUTO-WITHDRAW] Payment client not initialized, using mock mode")
    go gm.processAutoWithdrawMock(reqID, playerID, amount, player.PhoneNumber, pot, taxAmount)
}
```

---

### Phase 5: Initialization & Testing

#### 5.1 Initialize DMarkPay Client in main.go

**File:** `/cmd/server/main.go`

```go
import (
    "github.com/playmatatu/backend/internal/payment"
)

// After SMS initialization
if cfg.DMarkPayBaseURL != "" && cfg.DMarkPayUsername != "" && cfg.DMarkPayPassword != "" {
    paymentClient := payment.NewClient(cfg, rdb)
    if paymentClient != nil {
        payment.SetDefault(paymentClient)
        log.Printf("[PAYMENT] DMarkPay client initialized (wallet=%s)", cfg.DMarkPayWallet)
    }
}
```

---

## Critical Files Summary

| File | Purpose | Status |
|------|---------|--------|
| `/internal/config/config.go` | Add DMarkPay config | MODIFY |
| `/internal/payment/utils.go` | Phone normalization, txn ID | NEW |
| `/internal/payment/dmark.go` | DMarkPay API client | NEW |
| `/internal/api/handlers/payment_webhook.go` | Webhook handlers | NEW |
| `/internal/api/handlers/game.go` | Replace dummy payin | MODIFY |
| `/internal/game/manager.go` | Replace mock payout | MODIFY |
| `/internal/api/routes.go` | Register webhook routes | MODIFY |
| `/cmd/server/main.go` | Initialize payment client | MODIFY |
| `/migrations/000013_add_mobile_money_fields.up.sql` | Database schema | NEW |
| `/migrations/000013_add_mobile_money_fields.down.sql` | Rollback migration | NEW |

---

## Environment Variables

Required `.env` configuration:

```bash
# DMarkPay Settings
DMARK_PAY_BASE_URL=https://wallet.dmarkmobile.com
DMARK_PAY_TOKEN_URL=/o/token/
DMARK_PAY_USERNAME=IbOJEwzuUMyAksjbrpyj6KjYxBRsN6xUYCMO5Fsg
DMARK_PAY_PASSWORD=I1t0YcGvF4aMgBB9bIG0GttSwyrqZHYsKfoXuToHkwfCkUVWmNCpxVKJ7LWtQtgTS0W0L88mYVyzYZfYuw1U0TxtFvdDvKIYPF7oh2EG9FGrtjgJJt4aHDIHjJWr7gGn
DMARK_PAY_WALLET=dmark
DMARK_PAY_CALLBACK_URL=https://yourdomain.com
DMARK_PAY_TIMEOUT=30
```

---

## Verification Checklist

### Pre-Launch
- [ ] DMarkPay credentials configured in `.env`
- [ ] Database migrations applied successfully
- [ ] Payment client initializes without errors
- [ ] Webhook endpoints registered in routes
- [ ] Phone normalization works for MTN/Airtel
- [ ] Transaction ID generator produces unique IDs

### Payin Testing
- [ ] Initiate deposit → DMarkPay API called successfully
- [ ] Transaction record created with status='PENDING'
- [ ] Webhook callback updates transaction to 'COMPLETED'
- [ ] Account movements correct (commission to platform, net to player_winnings)
- [ ] SMS notification sent to player
- [ ] Failed payment marks transaction as 'FAILED'
- [ ] Duplicate webhooks handled gracefully

### Payout Testing
- [ ] Win game → auto-withdrawal initiated
- [ ] Payout API called successfully
- [ ] Withdraw request created with status='PENDING'
- [ ] Webhook callback completes payout
- [ ] Settlement account deducted correctly
- [ ] Confirmation SMS sent to player
- [ ] Failed payout refunds to player_winnings
- [ ] Duplicate webhooks handled gracefully

---

## Success Criteria

✅ **Deposits (Payin):**
- Users can deposit money via mobile money
- Payment confirmation received via webhook
- Balances updated correctly
- SMS notifications sent

✅ **Withdrawals (Payout):**
- Winners receive automatic payouts
- Payout confirmation received via webhook
- Balances deducted correctly
- SMS notifications sent

✅ **Reliability:**
- >95% success rate for payments
- Failed payments handled gracefully with refunds
- No double-spending or balance inconsistencies
- Idempotent webhook processing
