package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

var startTime = time.Now()

const version = "2.0.0-game-links" // Updated with game link changes

// HealthCheck returns server health status
func HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"service": "playmatatu-api",
		"version": version,
		"uptime":  time.Since(startTime).String(),
	})
}
