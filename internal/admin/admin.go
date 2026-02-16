package admin

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"

	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
	"github.com/playpool/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
)

// GetAdminAccountByUsername retrieves an admin account by username
func GetAdminAccountByUsername(db *sqlx.DB, username string) (*models.AdminAccount, error) {
	var admin models.AdminAccount
	err := db.Get(&admin, `
		SELECT phone, username, display_name, token_hash, password_hash, roles, allowed_ips, created_at, updated_at
		FROM admin_accounts WHERE username=$1
	`, username)
	if err != nil {
		return nil, err
	}
	return &admin, nil
}

// GetAdminAccount retrieves an admin account by phone (kept for backward compatibility)
func GetAdminAccount(db *sqlx.DB, phone string) (*models.AdminAccount, error) {
	var admin models.AdminAccount
	err := db.Get(&admin, `
		SELECT phone, username, display_name, token_hash, password_hash, roles, allowed_ips, created_at, updated_at
		FROM admin_accounts WHERE phone=$1
	`, phone)
	if err != nil {
		return nil, err
	}
	return &admin, nil
}

// ValidateAdminCredentials validates username + password combination
func ValidateAdminCredentials(db *sqlx.DB, username, password string) (*models.AdminAccount, error) {
	admin, err := GetAdminAccountByUsername(db, username)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("admin account not found")
		}
		return nil, fmt.Errorf("database error: %w", err)
	}

	if !admin.PasswordHash.Valid || admin.PasswordHash.String == "" {
		return nil, fmt.Errorf("password not set for admin account")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash.String), []byte(password)); err != nil {
		return nil, fmt.Errorf("invalid password")
	}

	return admin, nil
}

// EnsureSuperAdmin creates or updates the super admin account on startup
func EnsureSuperAdmin(db *sqlx.DB, username, password, phone string) error {
	if username == "" || password == "" {
		return fmt.Errorf("ADMIN_USERNAME and ADMIN_PASSWORD must be set")
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	// Use a dummy token_hash since the column is NOT NULL from the old schema
	dummyTokenHash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)

	_, err = db.Exec(`
		INSERT INTO admin_accounts (phone, username, display_name, token_hash, password_hash, roles, allowed_ips, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
		ON CONFLICT (phone) DO UPDATE SET
			username = EXCLUDED.username,
			display_name = EXCLUDED.display_name,
			password_hash = EXCLUDED.password_hash,
			token_hash = EXCLUDED.token_hash,
			roles = EXCLUDED.roles,
			updated_at = NOW()
	`, phone, username, "Super Admin", string(dummyTokenHash), string(passwordHash), pq.Array([]string{"super_admin"}), pq.Array([]string{}))

	if err != nil {
		return fmt.Errorf("failed to upsert super admin: %w", err)
	}

	log.Printf("[ADMIN] Super admin ensured (username=%s, phone=%s)", username, phone)
	return nil
}

// VerifyAdminToken checks if the provided token matches the stored hash (legacy, kept for compatibility)
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
func LogAdminAction(db *sqlx.DB, adminUsername, ip, route, action string, details map[string]interface{}, success bool) error {
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		log.Printf("Failed to marshal admin audit details: %v", err)
		detailsJSON = []byte("{}")
	}

	_, err = db.Exec(`
		INSERT INTO admin_audit (admin_username, ip, route, action, details, success, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
	`, adminUsername, ip, route, action, detailsJSON, success)

	if err != nil {
		log.Printf("Failed to log admin action: %v", err)
	}

	return err
}

// GetAdminAuditLogs retrieves recent admin audit logs with pagination
func GetAdminAuditLogs(db *sqlx.DB, limit, offset int) ([]models.AdminAudit, error) {
	var logs []models.AdminAudit
	query := `
		SELECT id, admin_phone, admin_username, ip, route, action, details, success, created_at
		FROM admin_audit
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`
	err := db.Select(&logs, query, limit, offset)
	return logs, err
}

// GetAdminAuditLogsByUsername retrieves audit logs for a specific admin
func GetAdminAuditLogsByUsername(db *sqlx.DB, username string, limit, offset int) ([]models.AdminAudit, error) {
	var logs []models.AdminAudit
	query := `
		SELECT id, admin_phone, admin_username, ip, route, action, details, success, created_at
		FROM admin_audit
		WHERE admin_username = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`
	err := db.Select(&logs, query, username, limit, offset)
	return logs, err
}

// ValidateAdminPhoneAndToken validates phone + token combination (legacy)
func ValidateAdminPhoneAndToken(db *sqlx.DB, phone, token string) (*models.AdminAccount, error) {
	admin, err := GetAdminAccount(db, phone)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("admin account not found")
		}
		return nil, fmt.Errorf("database error: %w", err)
	}

	if !VerifyAdminToken(admin.TokenHash, token) {
		return nil, fmt.Errorf("invalid token")
	}

	return admin, nil
}
