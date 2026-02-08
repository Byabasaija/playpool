package config

import (
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	// Environment
	Environment string

	// Database
	DatabaseURL string

	// Redis
	RedisURL string

	// Server
	Port        string
	FrontendURL string

	// Game Settings
	GameExpiryMinutes         int
	QueueExpiryMinutes        int
	QueueProcessingVisibility int
NoShowFeePercentage       int
	CommissionPercentage      int
	CommissionFlat            int
	MinStakeAmount            int
	PayoutTaxPercent          int

	// USSD Gateway
	USSDShortcode  string
	USSDGatewayURL string
	USSDAPIKey     string
	USSDAPISecret  string

	// SMS (Africa's Talking)
	SMSSenderID            string
	AfricasTalkingUsername string
	AfricasTalkingAPIKey   string

	// SMS (DMark)
	SMSServiceBaseURL       string
	SMSServiceUsername      string
	SMSServicePassword      string
	SMSRateLimitSeconds     int
	SMSTokenFallbackSeconds int

	// Mobile Money (Legacy)
	MomoAPIKey          string
	MomoAPISecret       string
	MomoCollectionURL   string
	MomoDisbursementURL string

	// DMarkPay Mobile Money Gateway
	DMarkPayBaseURL     string
	DMarkPayTokenURL    string
	DMarkPayUsername    string
	DMarkPayPassword    string
	DMarkPayAccountCode string
	DMarkPayWallet      string
	DMarkPayCallbackURL string
	DMarkPayTimeout     int

	// Security
	JWTSecret         string
	SessionTimeoutMin int

	// OTP configuration
	OTPTokenTTLSeconds         int
	OTPRequestRateLimitSeconds int
	OTPMaxVerifyAttempts       int

	// PIN configuration
	PINMaxAttempts     int
	PINLockoutMinutes  int
	PINTokenTTLSeconds int

	// Idle detection and forfeit
	IdleWarningSeconds     int
	IdleForfeitSeconds     int
	IdleWorkerPollInterval int

	// Matchmaker worker
	MatchmakerPollSeconds int
	// Withdraw settings
	MockMode          bool
	MinWithdrawAmount int
	AdminUsername string
	AdminPassword string
	AdminPhone   string
}

func Load() *Config {
	// Load .env file if it exists
	godotenv.Load()

	return &Config{
		// Environment
		Environment: getEnv("APP_ENV", "development"),

		// Database
		DatabaseURL: getEnv("DATABASE_URL", "postgres://localhost:5432/playmatatu?sslmode=disable"),

		// Redis
		RedisURL: getEnv("REDIS_URL", "redis://localhost:6379/0"),

		// Server
		Port:        getEnv("APP_PORT", "8000"),
		FrontendURL: getEnv("FRONTEND_URL", "http://localhost:5173"),

		// Game Settings
		GameExpiryMinutes:         getEnvInt("GAME_EXPIRY_MINUTES", 3),
		QueueExpiryMinutes:        getEnvInt("QUEUE_EXPIRY_MINUTES", 3),
		QueueProcessingVisibility: getEnvInt("QUEUE_PROCESSING_VISIBILITY_SECONDS", 30),
CommissionPercentage:      getEnvInt("COMMISSION_PERCENTAGE", 10),
		CommissionFlat:            getEnvInt("COMMISSION_FLAT", 1000),
		MinStakeAmount:            getEnvInt("MIN_STAKE_AMOUNT", 1000),
		PayoutTaxPercent:          getEnvInt("PAYOUT_TAX_PERCENT", 15),

		// USSD Gateway
		USSDShortcode:  getEnv("USSD_SHORTCODE", "*123*1#"),
		USSDGatewayURL: getEnv("USSD_GATEWAY_URL", ""),
		USSDAPIKey:     getEnv("USSD_API_KEY", ""),
		USSDAPISecret:  getEnv("USSD_API_SECRET", ""),

		// SMS
		SMSSenderID:            getEnv("SMS_SENDER_ID", "PlayMatatu"),
		AfricasTalkingUsername: getEnv("AFRICAS_TALKING_USERNAME", ""),
		AfricasTalkingAPIKey:   getEnv("AFRICAS_TALKING_API_KEY", ""),

		// DMark SMS (minimal config)
		SMSServiceBaseURL:       getEnv("SMS_SERVICE_BASE_URL", ""),
		SMSServiceUsername:      getEnv("SMS_SERVICE_USERNAME", ""),
		SMSServicePassword:      getEnv("SMS_SERVICE_PASSWORD", ""),
		SMSRateLimitSeconds:     getEnvInt("SMS_RATE_LIMIT_SECONDS", 30),
		SMSTokenFallbackSeconds: getEnvInt("SMS_TOKEN_FALLBACK_SECONDS", 3000),

		// Mobile Money (Legacy)
		MomoAPIKey:          getEnv("MOMO_API_KEY", ""),
		MomoAPISecret:       getEnv("MOMO_API_SECRET", ""),
		MomoCollectionURL:   getEnv("MOMO_COLLECTION_URL", ""),
		MomoDisbursementURL: getEnv("MOMO_DISBURSEMENT_URL", ""),

		// DMarkPay Mobile Money Gateway
		DMarkPayBaseURL:     getEnv("DMARK_PAY_BASE_URL", "https://wallet.dmarkmobile.com"),
		DMarkPayTokenURL:    getEnv("DMARK_PAY_TOKEN_URL", "/o/token/"),
		DMarkPayUsername:    getEnv("DMARK_PAY_USERNAME", ""),
		DMarkPayPassword:    getEnv("DMARK_PAY_PASSWORD", ""),
		DMarkPayAccountCode: getEnv("DMARK_PAY_ACCOUNT_CODE", ""),
		DMarkPayWallet:      getEnv("DMARK_PAY_WALLET", "dmark"),
		DMarkPayCallbackURL: getEnv("DMARK_PAY_CALLBACK_URL", ""),
		DMarkPayTimeout:     getEnvInt("DMARK_PAY_TIMEOUT", 30),

		// Security
		JWTSecret:         getEnv("JWT_SECRET", "change-me-in-production"),
		SessionTimeoutMin: getEnvInt("SESSION_TIMEOUT_MINUTES", 30),

		// OTP settings
		// Default TTL 5 minutes
		OTPTokenTTLSeconds:         getEnvInt("OTP_TTL_SECONDS", 300),
		OTPRequestRateLimitSeconds: getEnvInt("OTP_RATE_LIMIT_SECONDS", 60),
		OTPMaxVerifyAttempts:       getEnvInt("OTP_MAX_VERIFY_ATTEMPTS", 5),

		// PIN settings
		PINMaxAttempts:     getEnvInt("PIN_MAX_ATTEMPTS", 5),
		PINLockoutMinutes:  getEnvInt("PIN_LOCKOUT_MINUTES", 15),
		PINTokenTTLSeconds: getEnvInt("PIN_TOKEN_TTL_SECONDS", 300),

		// Idle detection and forfeit
		IdleWarningSeconds:     getEnvInt("IDLE_WARNING_SECONDS", 45),
		IdleForfeitSeconds:     getEnvInt("IDLE_FORFEIT_SECONDS", 90),
		IdleWorkerPollInterval: getEnvInt("IDLE_WORKER_POLL_INTERVAL", 1),

		// Matchmaker worker (how often to check for pairs to match)
		MatchmakerPollSeconds: getEnvInt("MATCHMAKER_POLL_SECONDS", 2),

		// Withdraw configuration
		MockMode:          getEnv("MOCK_MODE", "true") == "true",
		MinWithdrawAmount: getEnvInt("MIN_WITHDRAW_AMOUNT", 1000),
		AdminUsername: getEnv("ADMIN_USERNAME", "admin"),
		AdminPassword: getEnv("ADMIN_PASSWORD", "change-me-in-production"),
		AdminPhone:   getEnv("ADMIN_PHONE", "256700000000"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}
