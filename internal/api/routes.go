package api

import (
	"log"
	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/redis/go-redis/v9"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/api/handlers"
)

// SetupRoutes configures all API routes
func SetupRoutes(router *gin.Engine, db *sqlx.DB, rdb *redis.Client, cfg *config.Config) {
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

	// Health check
	router.GET("/health", handlers.HealthCheck)

	// Serve static files
	router.Static("/css", "./web/css")
	router.Static("/js", "./web/js")
	router.Static("/images", "./web/images")
	router.StaticFile("/game.html", "./web/game.html")
	
	// Handle game links BEFORE root
	router.GET("/g/:token", func(c *gin.Context) {
		token := c.Param("token")
		log.Printf("[ROUTE] Serving game.html for token: %s", token)
		c.File("./web/game.html")
	})
	
	// Root must be last
	router.StaticFile("/", "./web/index.html")

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
			player.GET("/:phone/stats", handlers.GetPlayerStats(db, cfg))
		}
	}
}
