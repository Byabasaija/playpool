package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/redis/go-redis/v9"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/ws"
)

// HandleGameWebSocket handles real-time game communication
func HandleGameWebSocket(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return ws.HandleWebSocket
}
