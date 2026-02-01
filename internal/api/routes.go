package api

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/api/handlers"
	"github.com/playmatatu/backend/internal/config"
	"github.com/redis/go-redis/v9"
)

// SetupRoutes configures all API routes
func SetupRoutes(router *gin.Engine, db *sqlx.DB, rdb *redis.Client, cfg *config.Config) {
	// CORS middleware for React development server
	router.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, X-Admin-Session")
		c.Header("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// CRITICAL: No-cache middleware MUST be first in development
	if cfg.Environment != "production" {
		router.Use(func(c *gin.Context) {
			// Aggressive no-cache for development
			c.Header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
			c.Header("Pragma", "no-cache")
			c.Header("Expires", "0")
			c.Next()
		})
		log.Println("[DEV MODE] Aggressive no-cache headers enabled for all routes")
	}

	// API v1 group
	v1 := router.Group("/api/v1")
	{
		// Health check (also available at /api/v1/health)
		v1.GET("/health", handlers.HealthCheck)

		// USSD endpoint (internal gateway)
		v1.GET("/ussd", handlers.HandleUSSD(db, rdb, cfg))

		// DMarkPay webhook endpoint (no auth required)
		v1.POST("/webhooks/dmark", handlers.DMarkPayinWebhook(db, rdb, cfg))

		// Game endpoints
		game := v1.Group("/game")
		{
			game.POST("/stake", handlers.InitiateStake(db, rdb, cfg))
			game.GET("/queue/status", handlers.CheckQueueStatus(db, rdb, cfg))
			game.GET("/status", handlers.GetQueueStatus(rdb))
			game.POST("/test", handlers.CreateTestGame(db, rdb, cfg))          // Dev only
			game.POST("/test/draw", handlers.CreateTestDrawGame(db, rdb, cfg)) // Dev only - test draw scenario
			game.GET("/:token", handlers.GetGameState(db, rdb, cfg))
			game.GET("/:token/ws", handlers.HandleGameWebSocket(db, rdb, cfg))
		}

		// Player endpoints
		player := v1.Group("/player")
		{
			player.GET(":phone/stats", handlers.GetPlayerStats(db, cfg))
			player.GET(":phone", handlers.GetPlayerProfile(db))
			player.PUT(":phone/display-name", handlers.UpdateDisplayName(db))
			player.POST(":phone/requeue", handlers.RequeueStake(db, rdb, cfg))
		}

		// Auth endpoints (OTP)
		v1.POST("/auth/request-otp", handlers.RequestOTP(db, rdb, cfg))
		v1.POST("/auth/verify-otp", handlers.VerifyOTP(db, rdb, cfg))
		v1.POST("/auth/verify-otp-action", handlers.VerifyOTPAction(db, rdb, cfg))

		// Game/Match endpoints
		v1.POST("/match/decline", handlers.DeclineMatchInvite(db, rdb, cfg))

		// PIN auth endpoints
		v1.GET("/player/check", handlers.CheckPlayerStatus(db))
		v1.POST("/auth/set-pin", handlers.SetPIN(db, rdb, cfg))
		v1.POST("/auth/verify-pin", handlers.VerifyPIN(db, rdb, cfg))
		v1.POST("/auth/reset-pin", handlers.ResetPIN(db, rdb, cfg))

		// Protected profile endpoint
		v1.GET("/me", handlers.AuthMiddleware(cfg, rdb), handlers.GetMe(db))
		// Withdraw
		v1.POST("/me/withdraw", handlers.AuthMiddleware(cfg, rdb), handlers.RequestWithdraw(db, cfg))
		v1.GET("/me/withdraws", handlers.AuthMiddleware(cfg, rdb), handlers.GetMyWithdraws(db))

		// Config endpoint
		v1.GET("/config", handlers.GetConfig(cfg))

		// Admin endpoints
		admin := v1.Group("/admin")
		{
			// Admin auth endpoints (no middleware)
			admin.POST("/request-otp", handlers.AdminRequestOTP(db, rdb, cfg))
			admin.POST("/verify-otp", handlers.AdminVerifyOTP(db, rdb, cfg))

			// Protected admin endpoints (require session)
			admin.GET("/accounts", handlers.AdminSessionMiddleware(rdb, db), handlers.GetAdminAccounts(db))
			admin.GET("/account_transactions", handlers.AdminSessionMiddleware(rdb, db), handlers.GetAdminAccountTransactions(db))
			admin.GET("/transactions", handlers.AdminSessionMiddleware(rdb, db), handlers.GetAdminTransactions(db))
			admin.GET("/stats", handlers.AdminSessionMiddleware(rdb, db), handlers.GetAdminStats(db))
		}
	}
}
