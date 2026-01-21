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
	DisconnectGracePeriodSecs int
	NoShowFeePercentage       int
	CommissionPercentage      int
	CommissionFlat            int
	MinStakeAmount            int

	// USSD Gateway
	USSDShortcode  string
	USSDGatewayURL string
	USSDAPIKey     string
	USSDAPISecret  string

	// SMS (Africa's Talking)
	SMSSenderID            string
	AfricasTalkingUsername string
	AfricasTalkingAPIKey   string

	// Mobile Money
	MomoAPIKey          string
	MomoAPISecret       string
	MomoCollectionURL   string
	MomoDisbursementURL string

	// Security
	JWTSecret         string
	SessionTimeoutMin int
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
		DisconnectGracePeriodSecs: getEnvInt("DISCONNECT_GRACE_PERIOD_SECONDS", 120),
		NoShowFeePercentage:       getEnvInt("NO_SHOW_FEE_PERCENTAGE", 5),
		CommissionPercentage:      getEnvInt("COMMISSION_PERCENTAGE", 10),
		CommissionFlat:            getEnvInt("COMMISSION_FLAT", 1000),
		MinStakeAmount:            getEnvInt("MIN_STAKE_AMOUNT", 1000),

		// USSD Gateway
		USSDShortcode:  getEnv("USSD_SHORTCODE", "*123*1#"),
		USSDGatewayURL: getEnv("USSD_GATEWAY_URL", ""),
		USSDAPIKey:     getEnv("USSD_API_KEY", ""),
		USSDAPISecret:  getEnv("USSD_API_SECRET", ""),

		// SMS
		SMSSenderID:            getEnv("SMS_SENDER_ID", "PlayMatatu"),
		AfricasTalkingUsername: getEnv("AFRICAS_TALKING_USERNAME", ""),
		AfricasTalkingAPIKey:   getEnv("AFRICAS_TALKING_API_KEY", ""),

		// Mobile Money
		MomoAPIKey:          getEnv("MOMO_API_KEY", ""),
		MomoAPISecret:       getEnv("MOMO_API_SECRET", ""),
		MomoCollectionURL:   getEnv("MOMO_COLLECTION_URL", ""),
		MomoDisbursementURL: getEnv("MOMO_DISBURSEMENT_URL", ""),

		// Security
		JWTSecret:         getEnv("JWT_SECRET", "change-me-in-production"),
		SessionTimeoutMin: getEnvInt("SESSION_TIMEOUT_MINUTES", 30),
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
