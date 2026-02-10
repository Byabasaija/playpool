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
	// CORS is handled by middleware.CORSMiddleware applied in main.go

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

		// Queue operations
		// Cancel an active queue and refund the stake to player's winnings (auth required via session cookie)
		v1.POST("/queue/:id/cancel", handlers.PlayerSessionMiddleware(rdb, db, cfg), handlers.CancelQueue(db, cfg))

		// Auth endpoints (OTP)
		v1.POST("/auth/request-otp", handlers.RequestOTP(db, rdb, cfg))
		v1.POST("/auth/verify-otp", handlers.VerifyOTP(db, rdb, cfg))
		v1.POST("/auth/verify-otp-action", handlers.VerifyOTPAction(db, rdb, cfg))

		// Game/Match endpoints
		v1.POST("/match/decline", handlers.DeclineMatchInvite(db, rdb, cfg))
		v1.GET("/match/:matchcode", handlers.GetMatchDetails(db, rdb, cfg))

		// PIN auth endpoints
		v1.GET("/player/check", handlers.CheckPlayerStatus(db))
		v1.POST("/auth/set-pin", handlers.SetPIN(db, rdb, cfg))
		v1.POST("/auth/verify-pin", handlers.VerifyPIN(db, rdb, cfg))
		v1.POST("/auth/reset-pin", handlers.ResetPIN(db, rdb, cfg))

		// Player session endpoints
		v1.GET("/session/check", handlers.PlayerSessionMiddleware(rdb, db, cfg), handlers.PlayerCheckSession(rdb, db))
		v1.POST("/session/logout", handlers.PlayerLogout(rdb, cfg))

		// Protected profile endpoint
		v1.GET("/me", handlers.AuthMiddleware(cfg, rdb), handlers.GetMe(db))
		// Withdraw
		v1.POST("/me/withdraw", handlers.AuthMiddleware(cfg, rdb), handlers.RequestWithdraw(db, cfg))
		v1.GET("/me/withdraws", handlers.AuthMiddleware(cfg, rdb), handlers.GetMyWithdraws(db))

		// Config endpoint
		v1.GET("/config", handlers.GetConfig(cfg))

		// Admin endpoints
		adminGroup := v1.Group("/admin")
		{
			// Auth endpoints (no middleware)
			adminGroup.POST("/login", handlers.AdminLogin(db, rdb, cfg))
			adminGroup.POST("/verify-otp", handlers.AdminVerifyOTP(db, rdb, cfg))
			adminGroup.POST("/logout", handlers.AdminLogout(rdb))

			// Protected admin endpoints (require session cookie)
			protected := adminGroup.Group("")
			protected.Use(handlers.AdminSessionMiddleware(rdb, db))
			{
				protected.GET("/me", handlers.AdminMe())
				protected.GET("/stats", handlers.GetAdminStats(db))
				protected.GET("/accounts", handlers.GetAdminAccounts(db))
				protected.GET("/account_transactions", handlers.GetAdminAccountTransactions(db))
				protected.GET("/transactions", handlers.GetAdminTransactions(db))

				// Player management
				protected.GET("/players", handlers.GetAdminPlayers(db))
				protected.GET("/players/:id", handlers.GetAdminPlayerDetail(db))
				protected.POST("/players/:id/block", handlers.AdminBlockPlayer(db))
				protected.POST("/players/:id/unblock", handlers.AdminUnblockPlayer(db))
				protected.POST("/players/:id/reset-pin", handlers.AdminResetPlayerPIN(db))
				protected.GET("/players/:id/games", handlers.GetAdminPlayerGames(db))
				protected.GET("/players/:id/transactions", handlers.GetAdminPlayerTransactions(db))

				// Game management
				protected.GET("/games", handlers.GetAdminGames(db))
				protected.GET("/games/:id", handlers.GetAdminGameDetail(db))
				protected.POST("/games/:id/cancel", handlers.AdminCancelGame(db))

				// Financial operations
				protected.GET("/withdrawals", handlers.GetAdminWithdrawals(db))
				protected.POST("/withdrawals/:id/approve", handlers.AdminApproveWithdrawal(db))
				protected.POST("/withdrawals/:id/reject", handlers.AdminRejectWithdrawal(db))
				protected.GET("/revenue", handlers.GetAdminRevenue(db))

				// Audit log
				protected.GET("/audit-logs", handlers.GetAdminAuditLogs(db))

				// Runtime config
				protected.GET("/config", handlers.GetAdminRuntimeConfig(db))
				protected.PUT("/config/:key", handlers.UpdateAdminRuntimeConfig(db, cfg))
			}
		}
	}
}
