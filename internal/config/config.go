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
	DisconnectGracePeriodSecs int
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

	// Mobile Money
	MomoAPIKey          string
	MomoAPISecret       string
	MomoCollectionURL   string
	MomoDisbursementURL string

	// Security
	JWTSecret         string
	SessionTimeoutMin int

	// OTP configuration
	OTPTokenTTLSeconds         int
	OTPRequestRateLimitSeconds int
	OTPMaxVerifyAttempts       int

	// Idle detection and forfeit
	IdleWarningSeconds     int
	IdleForfeitSeconds     int
	IdleWorkerPollInterval int
	// Withdraw provider fee percent (telecom fee applied at payout time)
	WithdrawProviderFeePercent int
	// Withdraw settings
	MockMode          bool
	MinWithdrawAmount int
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
		Port:        getEnv("APP_PORT", "8080"),
		FrontendURL: getEnv("FRONTEND_URL", "http://localhost:5173"),

		// Game Settings
		GameExpiryMinutes:         getEnvInt("GAME_EXPIRY_MINUTES", 10),
		QueueExpiryMinutes:        getEnvInt("QUEUE_EXPIRY_MINUTES", 10),
		QueueProcessingVisibility: getEnvInt("QUEUE_PROCESSING_VISIBILITY_SECONDS", 30),
		DisconnectGracePeriodSecs: getEnvInt("DISCONNECT_GRACE_PERIOD_SECONDS", 120),
		NoShowFeePercentage:       getEnvInt("NO_SHOW_FEE_PERCENTAGE", 5),
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

		// Mobile Money
		MomoAPIKey:          getEnv("MOMO_API_KEY", ""),
		MomoAPISecret:       getEnv("MOMO_API_SECRET", ""),
		MomoCollectionURL:   getEnv("MOMO_COLLECTION_URL", ""),
		MomoDisbursementURL: getEnv("MOMO_DISBURSEMENT_URL", ""),

		// Security
		JWTSecret:         getEnv("JWT_SECRET", "change-me-in-production"),
		SessionTimeoutMin: getEnvInt("SESSION_TIMEOUT_MINUTES", 30),

		// OTP settings
		// Default TTL 5 minutes
		OTPTokenTTLSeconds:         getEnvInt("OTP_TTL_SECONDS", 300),
		OTPRequestRateLimitSeconds: getEnvInt("OTP_RATE_LIMIT_SECONDS", 60),
		OTPMaxVerifyAttempts:       getEnvInt("OTP_MAX_VERIFY_ATTEMPTS", 5),

		// Idle detection and forfeit
		IdleWarningSeconds:     getEnvInt("IDLE_WARNING_SECONDS", 45),
		IdleForfeitSeconds:     getEnvInt("IDLE_FORFEIT_SECONDS", 90),
		IdleWorkerPollInterval: getEnvInt("IDLE_WORKER_POLL_INTERVAL", 1),
		// Withdraw provider fee percent (e.g., telecom/MOMO fee applied at payout time)
		WithdrawProviderFeePercent: getEnvInt("WITHDRAW_PROVIDER_FEE_PERCENT", 3),
		// Withdraw configuration
		MockMode:          getEnv("MOCK_MODE", "true") == "true",
		MinWithdrawAmount: getEnvInt("MIN_WITHDRAW_AMOUNT", 1000),
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
