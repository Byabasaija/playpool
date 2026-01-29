package admin

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"

	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
	"github.com/playmatatu/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
)

// GetAdminAccount retrieves an admin account by phone
func GetAdminAccount(db *sqlx.DB, phone string) (*models.AdminAccount, error) {
	var admin models.AdminAccount
	err := db.Get(&admin, `SELECT phone, display_name, token_hash, roles, allowed_ips, created_at, updated_at FROM admin_accounts WHERE phone=$1`, phone)
	if err != nil {
		return nil, err
	}
	return &admin, nil
}

// VerifyAdminToken checks if the provided token matches the stored hash
func VerifyAdminToken(hashedToken, plainToken string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hashedToken), []byte(plainToken))
	return err == nil
}

// CreateAdminAccount creates a new admin account (used for seeding/testing)
func CreateAdminAccount(db *sqlx.DB, phone, displayName, plainToken string, roles, allowedIPs []string) error {
	hashedToken, err := bcrypt.GenerateFromPassword([]byte(plainToken), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash token: %w", err)
	}

	_, err = db.Exec(`
		INSERT INTO admin_accounts (phone, display_name, token_hash, roles, allowed_ips, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
		ON CONFLICT (phone) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			token_hash = EXCLUDED.token_hash,
			roles = EXCLUDED.roles,
			allowed_ips = EXCLUDED.allowed_ips,
			updated_at = NOW()
	`, phone, displayName, string(hashedToken), pq.Array(roles), pq.Array(allowedIPs))

	return err
}

// LogAdminAction records an admin action in the audit log
func LogAdminAction(db *sqlx.DB, adminPhone, ip, route, action string, details map[string]interface{}, success bool) error {
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		log.Printf("Failed to marshal admin audit details: %v", err)
		detailsJSON = []byte("{}")
	}

	_, err = db.Exec(`
		INSERT INTO admin_audit (admin_phone, ip, route, action, details, success, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
	`, adminPhone, ip, route, action, detailsJSON, success)

	if err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}

	return err
}

// GetAdminAuditLogs retrieves recent admin audit logs with pagination
func GetAdminAuditLogs(db *sqlx.DB, limit, offset int) ([]models.AdminAudit, error) {
	var logs []models.AdminAudit
	query := `
		SELECT id, admin_phone, ip, route, action, details, success, created_at
		FROM admin_audit
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`
	err := db.Select(&logs, query, limit, offset)
	return logs, err
}

// GetAdminAuditLogsByPhone retrieves audit logs for a specific admin
func GetAdminAuditLogsByPhone(db *sqlx.DB, phone string, limit, offset int) ([]models.AdminAudit, error) {
	var logs []models.AdminAudit
	query := `
		SELECT id, admin_phone, ip, route, action, details, success, created_at
		FROM admin_audit
		WHERE admin_phone = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`
	err := db.Select(&logs, query, phone, limit, offset)
	return logs, err
}

// ValidateAdminPhoneAndToken validates phone + token combination
func ValidateAdminPhoneAndToken(db *sqlx.DB, phone, token string) (*models.AdminAccount, error) {
	log.Printf("[ADMIN] Validating phone: %s", phone)

	admin, err := GetAdminAccount(db, phone)
	if err != nil {
		if err == sql.ErrNoRows {
			log.Printf("[ADMIN] No admin account found for phone: %s", phone)
			return nil, fmt.Errorf("admin account not found")
		}
		log.Printf("[ADMIN] Database error: %v", err)
		return nil, fmt.Errorf("database error: %w", err)
	}

	log.Printf("[ADMIN] Found admin account for: %s", phone)

	if !VerifyAdminToken(admin.TokenHash, token) {
		log.Printf("[ADMIN] Token verification failed for phone: %s", phone)
		return nil, fmt.Errorf("invalid token")
	}

	log.Printf("[ADMIN] Token verified successfully for: %s", phone)
	return admin, nil
}
