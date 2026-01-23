package sms

import (
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/playmatatu/backend/internal/config"
	"github.com/redis/go-redis/v9"
)

// Client is a minimal DMark SMS client with token caching in Redis.
type Client struct {
	baseURL              string
	username             string
	password             string
	rdb                  *redis.Client
	httpClient           *http.Client
	rateLimitSeconds     int
	tokenFallbackSeconds int
	cacheKeyPrefix       string
}

// Default package-level client (set from main on startup)
var Default *Client

// SetDefault sets the package Default client.
func SetDefault(c *Client) {
	Default = c
}

// NewClient constructs a DMark client. Returns nil if not configured.
func NewClient(cfg *config.Config, rdb *redis.Client) *Client {
	if cfg == nil || cfg.SMSServiceBaseURL == "" || cfg.SMSServiceUsername == "" || cfg.SMSServicePassword == "" {
		return nil
	}

	return &Client{
		baseURL:              strings.TrimRight(cfg.SMSServiceBaseURL, "/"),
		username:             cfg.SMSServiceUsername,
		password:             cfg.SMSServicePassword,
		rdb:                  rdb,
		httpClient:           &http.Client{Timeout: 15 * time.Second},
		rateLimitSeconds:     cfg.SMSRateLimitSeconds,
		tokenFallbackSeconds: cfg.SMSTokenFallbackSeconds,
		cacheKeyPrefix:       "sms_token:",
	}
}

// SendSMS sends a single SMS to the given phone number using DMark API.
// Returns a provider message id (if available) and an error if the operation definitively failed.
func (c *Client) SendSMS(ctx context.Context, phone string, message string) (string, error) {
	if c == nil {
		return "", errors.New("sms client not configured")
	}

	// Rate limit per phone
	if c.rdb != nil && c.rateLimitSeconds > 0 {
		key := fmt.Sprintf("sms_rate:%s", phone)
		ok, err := c.rdb.SetNX(ctx, key, "1", time.Duration(c.rateLimitSeconds)*time.Second).Result()
		if err == nil && !ok {
			return "", fmt.Errorf("rate limited: %s", phone)
		}
		// ignore Redis errors and proceed
	}

	formatted := formatPhoneForDMark(phone)

	// Retry loop for transient errors
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		accessToken, err := c.getAccessToken(ctx)
		if err != nil {
			lastErr = err
			// small backoff
			time.Sleep(time.Duration(100+attempt*200) * time.Millisecond)
			continue
		}

		payload := map[string]interface{}{
			"msg":     message,
			"numbers": formatted,
			"dlr_url": "",
			"scan_ip": false,
		}

		b, _ := json.Marshal(payload)
		req, _ := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/v3/api/send_sms/", strings.NewReader(string(b)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("authToken", accessToken)

		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err
			if attempt < 2 {
				time.Sleep(time.Duration(100+attempt*200) * time.Millisecond)
				continue
			}
			break
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == 200 {
			var parsed map[string]interface{}
			if err := json.Unmarshal(body, &parsed); err == nil {
				// try common keys for message id
				if v, ok := parsed["msg_id"].(string); ok {
					return v, nil
				}
				if v, ok := parsed["message_id"].(string); ok {
					return v, nil
				}
			}
			return "", nil
		}

		// For 5xx transient errors retry
		if resp.StatusCode >= 500 && attempt < 2 {
			lastErr = fmt.Errorf("sms provider error %d: %s", resp.StatusCode, string(body))
			time.Sleep(time.Duration(100+attempt*200) * time.Millisecond)
			continue
		}

		// 4xx or exhausted retries
		return "", fmt.Errorf("sms send failed: %d %s", resp.StatusCode, string(body))
	}

	if lastErr != nil {
		return "", lastErr
	}
	return "", errors.New("sms send failed")
}

// SendSMS sends an SMS using the package Default client (if set)
func SendSMS(ctx context.Context, phone, message string) (string, error) {
	if Default == nil {
		return "", errors.New("sms not configured")
	}
	return Default.SendSMS(ctx, phone, message)
}

// getAccessToken fetches or returns cached DMark access token
func (c *Client) getAccessToken(ctx context.Context) (string, error) {
	if c == nil {
		return "", errors.New("sms client not configured")
	}

	key := c.cacheKeyPrefix + shortCredHash(c.username, c.password)
	// Try Redis cache
	if c.rdb != nil {
		if tok, err := c.rdb.Get(ctx, key).Result(); err == nil {
			return tok, nil
		}
	}

	// Fetch new token from API
	data := map[string]string{
		"username": c.username,
		"password": c.password,
	}
	b, _ := json.Marshal(data)
	req, _ := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/api/get_token/", strings.NewReader(string(b)))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	accessToken, _ := parsed["access_token"].(string)
	if accessToken == "" {
		return "", errors.New("token not present in response")
	}

	// Try to parse exp from JWT
	exp, err := parseJWTExpiry(accessToken)
	if err == nil && exp > 0 {
		now := time.Now().Unix()
		secs := exp - now
		// safety buffer
		cacheSecs := int64(float64(secs) * 0.9)
		if cacheSecs <= 0 {
			cacheSecs = int64(c.tokenFallbackSeconds)
		}
		if c.rdb != nil {
			c.rdb.Set(ctx, key, accessToken, time.Duration(cacheSecs)*time.Second)
		}
	} else {
		if c.rdb != nil {
			c.rdb.Set(ctx, key, accessToken, time.Duration(c.tokenFallbackSeconds)*time.Second)
		}
	}

	return accessToken, nil
}

// parseJWTExpiry extracts 'exp' claim from a JWT and returns unix timestamp
func parseJWTExpiry(token string) (int64, error) {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return 0, errors.New("invalid token format")
	}
	payload := parts[1]
	// Try RawURLEncoding first (un-padded)
	decoded, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		// Try standard URL encoding (handles padding)
		decoded, err = base64.URLEncoding.DecodeString(payload)
		if err != nil {
			return 0, err
		}
	}

	var p map[string]interface{}
	if err := json.Unmarshal(decoded, &p); err != nil {
		return 0, err
	}
	if expVal, ok := p["exp"]; ok {
		switch v := expVal.(type) {
		case float64:
			return int64(v), nil
		case int64:
			return v, nil
		case json.Number:
			i, _ := v.Int64()
			return i, nil
		default:
			return 0, fmt.Errorf("unknown exp claim type %T", v)
		}
	}
	return 0, errors.New("exp claim not found")
}

// helper to compute a short cred hash
func shortCredHash(u, p string) string {
	h := md5.Sum([]byte(fmt.Sprintf("%s:%s", u, p)))
	return hex.EncodeToString(h[:])[:8]
}

// formatPhoneForDMark converts various phone inputs into 0XXXXXXXXX format
func formatPhoneForDMark(phone string) string {
	clean := ""
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			clean += string(r)
		}
	}
	if strings.HasPrefix(clean, "256") {
		return "0" + clean[3:]
	}
	if strings.HasPrefix(clean, "+256") {
		return "0" + clean[4:]
	}
	if strings.HasPrefix(clean, "0") {
		return clean
	}
	// fallback: take last 9 digits
	if len(clean) >= 9 {
		return "0" + clean[len(clean)-9:]
	}
	return clean
}
