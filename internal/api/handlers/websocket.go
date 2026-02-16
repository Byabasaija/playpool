package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playpool/backend/internal/config"
	"github.com/playpool/backend/internal/ws"
	"github.com/redis/go-redis/v9"
)

// HandleGameWebSocket handles real-time game communication
func HandleGameWebSocket(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return ws.HandleWebSocket
}
