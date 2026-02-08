package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/admin"
	"github.com/playmatatu/backend/internal/config"
)

// GetAdminRuntimeConfig returns all runtime config entries
func GetAdminRuntimeConfig(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		configs, err := admin.GetAllRuntimeConfig(db)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch runtime config: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch config"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"configs": configs})
	}
}

// UpdateAdminRuntimeConfig updates a single runtime config value
func UpdateAdminRuntimeConfig(db *sqlx.DB, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.GetString("admin_username")
		key := c.Param("key")

		var req struct {
			Value string `json:"value" binding:"required"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Value is required"})
			return
		}

		err := admin.UpdateRuntimeConfigValue(db, key, req.Value, adminUsername)
		if err != nil {
			log.Printf("[ADMIN] Failed to update config %s: %v", key, err)
			admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/config/"+key, "update_config", map[string]interface{}{"key": key, "value": req.Value}, false)
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Re-apply runtime config to in-memory config
		if err := admin.ApplyRuntimeConfigToConfig(db, cfg); err != nil {
			log.Printf("[ADMIN] Warning: failed to apply runtime config: %v", err)
		}

		admin.LogAdminAction(db, adminUsername, c.ClientIP(), "/api/v1/admin/config/"+key, "update_config", map[string]interface{}{"key": key, "value": req.Value}, true)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}
