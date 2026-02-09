package middleware

import (
	"log"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/playmatatu/backend/internal/config"
)

// CORSMiddleware returns a CORS middleware configured for the environment
func CORSMiddleware(cfg *config.Config) gin.HandlerFunc {
	log.Printf("[CORS] Environment: %s, FrontendURL: %s", cfg.Environment, cfg.FrontendURL)

	corsConfig := cors.Config{
		AllowMethods: []string{
			"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS",
		},
		AllowHeaders: []string{
			"Origin", "Content-Length", "Content-Type", "Authorization",
			"X-Phone-Number", "X-Game-Token", "Accept", "Cache-Control",
			"X-Requested-With",
		},
		ExposeHeaders: []string{
			"Content-Length", "X-Game-ID", "X-Player-Count",
		},
		MaxAge: 12 * time.Hour, // Cache preflight responses
	}

	// Configure allowed origins based on environment
	if cfg.Environment == "development" {
		corsConfig.AllowOrigins = []string{
			"http://localhost:5173", // Vite dev server
			"http://127.0.0.1:5173", // Alternative localhost format
		}
		corsConfig.AllowCredentials = true
		corsConfig.AllowAllOrigins = false
	} else {
		// Production: explicit allowed origins with credentials for cookie auth
		allowedOrigins := []string{
			"https://playmatatu.com",
			"https://demo.playmatatu.com",
		}
		if cfg.FrontendURL != "" {
			allowedOrigins = append(allowedOrigins, cfg.FrontendURL)
		}
		corsConfig.AllowOrigins = allowedOrigins
		corsConfig.AllowCredentials = true
		corsConfig.AllowAllOrigins = false
		log.Printf("[CORS] Production allowed origins: %v", allowedOrigins)
	}

	return cors.New(corsConfig)
}

// WebSocketCORSCheck validates WebSocket upgrade origins
func WebSocketCORSCheck(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Only check for WebSocket upgrade requests
		if strings.ToLower(c.GetHeader("Connection")) != "upgrade" ||
			strings.ToLower(c.GetHeader("Upgrade")) != "websocket" {
			c.Next()
			return
		}

		origin := c.GetHeader("Origin")
		if origin == "" {
			c.JSON(400, gin.H{"error": "WebSocket origin required"})
			c.Abort()
			return
		}

		var allowed bool
		if cfg.Environment == "development" {
			// Allow localhost variants in dev
			allowed = strings.HasPrefix(origin, "http://localhost:") ||
				strings.HasPrefix(origin, "http://127.0.0.1:")
		} else {
			// Production: check against allowed domains
			allowedOrigins := []string{
				"https://demo.playmatatu.com",
				"https://playmatatu.com",
			}
			if cfg.FrontendURL != "" {
				allowedOrigins = append(allowedOrigins, cfg.FrontendURL)
			}

			for _, allowedOrigin := range allowedOrigins {
				if origin == allowedOrigin {
					allowed = true
					break
				}
			}
		}

		if !allowed {
			c.JSON(403, gin.H{"error": "WebSocket origin not allowed"})
			c.Abort()
			return
		}

		c.Next()
	}
}
