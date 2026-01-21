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
		c.Header("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
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

		// Mobile Money callbacks
		v1.POST("/momo/callback", handlers.HandleMomoCallback(db, rdb, cfg))

		// Game endpoints
		game := v1.Group("/game")
		{
			game.POST("/stake", handlers.InitiateStake(db, rdb, cfg))
			game.GET("/queue/status", handlers.CheckQueueStatus(db, rdb, cfg))
			game.GET("/status", handlers.GetQueueStatus(rdb))
			game.POST("/test", handlers.CreateTestGame(db, rdb, cfg)) // Dev only
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
	}
}
