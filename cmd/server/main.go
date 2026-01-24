package main

import (
	"context"
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/playmatatu/backend/internal/api"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/database"
	"github.com/playmatatu/backend/internal/game"
	"github.com/playmatatu/backend/internal/migrations"
	"github.com/playmatatu/backend/internal/redis"
	"github.com/playmatatu/backend/internal/sms"
	"github.com/playmatatu/backend/internal/ws"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	// Initialize configuration
	cfg := config.Load()

	// Initialize database
	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Run migrations on start if requested
	if os.Getenv("MIGRATE_ON_START") == "true" {
		log.Println("↗ Running DB migrations on startup...")
		if err := migrations.RunMigrations(cfg.DatabaseURL); err != nil {
			log.Fatalf("Failed to run migrations: %v", err)
		}
	}

	// Initialize Redis
	rdb, err := redis.Connect(cfg.RedisURL)
	if err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}
	defer rdb.Close()

	// Initialize Game Manager with Redis and config
	game.InitializeManager(db, rdb, cfg)

	// Initialize DMark SMS client (if configured)
	if cfg.SMSServiceBaseURL != "" && cfg.SMSServiceUsername != "" && cfg.SMSServicePassword != "" {
		smsClient := sms.NewClient(cfg, rdb)
		if smsClient != nil {
			sms.SetDefault(smsClient)
			log.Printf("[SMS] DMark SMS client initialized (base=%s)", cfg.SMSServiceBaseURL)
		}
	} else {
		log.Printf("[SMS] SMS is not configured (SMS_SERVICE_BASE_URL/SMS_SERVICE_USERNAME missing)")
	}

	// Wire Redis and start idle event subscriber in WS layer
	ws.SetRedisClient(rdb, cfg)
	ws.StartIdleEventSubscriber(context.Background())

	// Start idle worker (warning -> forfeit) for idle detection
	game.StartIdleWorker(context.Background(), db, rdb, cfg)

	// Set up Gin router
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.Default()

	// Initialize API handlers
	api.SetupRoutes(router, db, rdb, cfg)

	// Start server
	port := cfg.Port
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting PlayMatatu server on port %s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
