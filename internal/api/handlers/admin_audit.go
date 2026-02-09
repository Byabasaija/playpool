package handlers

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/admin"
)

// GetAdminAuditLogs returns paginated audit log entries
func GetAdminAuditLogs(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		adminUsername := c.DefaultQuery("admin_username", "")
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
		if limit > 200 {
			limit = 200
		}

		type auditRow struct {
			ID            int     `db:"id" json:"id"`
			AdminUsername *string `db:"admin_username" json:"admin_username"`
			IP            *string `db:"ip" json:"ip"`
			Route         *string `db:"route" json:"route"`
			Action        *string `db:"action" json:"action"`
			Details       *string `db:"details" json:"details"`
			Success       *bool   `db:"success" json:"success"`
			CreatedAt     string  `db:"created_at" json:"created_at"`
			TotalCount    int     `db:"total_count" json:"-"`
		}

		query := `
			SELECT id, admin_username, ip, route, action, details, success,
				to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
				COUNT(*) OVER() as total_count
			FROM admin_audit
			WHERE ($1 = '' OR admin_username = $1)
			ORDER BY created_at DESC
			LIMIT $2 OFFSET $3
		`

		var rows []auditRow
		err := db.Select(&rows, query, adminUsername, limit, offset)
		if err != nil {
			log.Printf("[ADMIN] Failed to fetch audit logs: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch audit logs"})
			return
		}

		total := 0
		if len(rows) > 0 {
			total = rows[0].TotalCount
		}

		// Suppress audit logging for viewing audit logs to avoid noise
		_ = admin.LogAdminAction
		c.JSON(http.StatusOK, gin.H{"logs": rows, "total": total, "limit": limit, "offset": offset})
	}
}
