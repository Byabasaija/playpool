package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/playpool/backend/internal/admin"
	"github.com/playpool/backend/internal/api"
	"github.com/playpool/backend/internal/config"
	"github.com/playpool/backend/internal/database"
	"github.com/playpool/backend/internal/game"
	"github.com/playpool/backend/internal/middleware"
	"github.com/playpool/backend/internal/migrations"
	"github.com/playpool/backend/internal/payment"
	"github.com/playpool/backend/internal/redis"
	"github.com/playpool/backend/internal/sms"
	"github.com/playpool/backend/internal/ws"
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

	// Apply runtime config overrides from database
	if err := admin.ApplyRuntimeConfigToConfig(db, cfg); err != nil {
		log.Printf("[CONFIG] Warning: failed to load runtime config from database: %v", err)
	}

	// Ensure super admin account exists
	if cfg.AdminUsername != "" && cfg.AdminPassword != "" {
		if err := admin.EnsureSuperAdmin(db, cfg.AdminUsername, cfg.AdminPassword, cfg.AdminPhone); err != nil {
			log.Printf("[ADMIN] Warning: failed to ensure super admin: %v", err)
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

	// Initialize DMarkPay client (if configured)
	if cfg.DMarkPayBaseURL != "" && cfg.DMarkPayUsername != "" && cfg.DMarkPayPassword != "" {
		paymentClient := payment.NewClient(cfg, rdb)
		if paymentClient != nil {
			payment.SetDefault(paymentClient)
			log.Printf("[PAYMENT] DMarkPay client initialized (account=%s, wallet=%s)", cfg.DMarkPayAccountCode, cfg.DMarkPayWallet)
		}
	} else {
		log.Printf("[PAYMENT] DMarkPay not configured - payment operations will use mock mode")
	}

	// Start payment status checker (polls DMarkPay for PENDING transaction status)
	go payment.StartStatusChecker(context.Background(), db, rdb, cfg, 2) // Check every 2 minutes

	// Wire Redis and start idle event subscriber in WS layer
	ws.SetRedisClient(rdb)
	ws.StartIdleEventSubscriber(context.Background())

	// Start matchmaker worker (pairs players from DB queue and sends SMS)
	go game.StartMatchmakerWorker(context.Background(), db, rdb, cfg)

	// Set up Gin router
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.Default()

	// Apply CORS middleware before routes
	router.Use(middleware.CORSMiddleware(cfg))
	router.Use(middleware.WebSocketCORSCheck(cfg))

	// Initialize API handlers
	api.SetupRoutes(router, db, rdb, cfg)

	// Serve built frontend (SERVE_STATIC_FILES=true)
	if cfg.ServeStaticFiles {
		distDir := cfg.StaticFilesDir
		log.Printf("Serving static frontend from %s", distDir)
		router.NoRoute(func(c *gin.Context) {
			// Let API routes return 404 normally
			if strings.HasPrefix(c.Request.URL.Path, "/api/") {
				c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
				return
			}
			// Try to serve the exact file first
			filePath := filepath.Join(distDir, filepath.Clean(c.Request.URL.Path))
			if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
				c.File(filePath)
				return
			}
			// SPA fallback — all other paths get index.html
			c.File(filepath.Join(distDir, "index.html"))
		})
	}

	// Start server
	addr := cfg.BindAddr // preferred override
	if addr == "" {
		addr = cfg.Port
		if addr == "" {
			addr = "8000"
		}
	}

	// make sure there is at least one colon so Gin/http treats it as port
	if !strings.Contains(addr, ":") {
		addr = ":" + addr
	}

	log.Printf("Starting PlayPool server on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
