package admin

import (
	"fmt"
	"log"
	"strconv"

	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/models"
)

// GetAllRuntimeConfig returns all runtime config entries
func GetAllRuntimeConfig(db *sqlx.DB) ([]models.RuntimeConfig, error) {
	var configs []models.RuntimeConfig
	err := db.Select(&configs, `
		SELECT key, value, value_type, description, updated_by, updated_at
		FROM runtime_config
		ORDER BY key
	`)
	return configs, err
}

// GetRuntimeConfigValue returns a single runtime config value
func GetRuntimeConfigValue(db *sqlx.DB, key string) (*models.RuntimeConfig, error) {
	var cfg models.RuntimeConfig
	err := db.Get(&cfg, `SELECT key, value, value_type, description, updated_by, updated_at FROM runtime_config WHERE key=$1`, key)
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

// UpdateRuntimeConfigValue updates a single runtime config value
func UpdateRuntimeConfigValue(db *sqlx.DB, key, value, adminUsername string) error {
	// Get existing config to validate type
	existing, err := GetRuntimeConfigValue(db, key)
	if err != nil {
		return fmt.Errorf("config key not found: %s", key)
	}

	// Validate value against type
	switch existing.ValueType {
	case "int":
		if _, err := strconv.Atoi(value); err != nil {
			return fmt.Errorf("invalid integer value: %s", value)
		}
	case "float":
		if _, err := strconv.ParseFloat(value, 64); err != nil {
			return fmt.Errorf("invalid float value: %s", value)
		}
	case "bool":
		if value != "true" && value != "false" {
			return fmt.Errorf("invalid boolean value: %s (must be 'true' or 'false')", value)
		}
	}

	_, err = db.Exec(`
		UPDATE runtime_config SET value=$1, updated_by=$2, updated_at=NOW() WHERE key=$3
	`, value, adminUsername, key)
	return err
}

// ApplyRuntimeConfigToConfig loads runtime config from DB and applies overrides to the Config struct
func ApplyRuntimeConfigToConfig(db *sqlx.DB, cfg *config.Config) error {
	configs, err := GetAllRuntimeConfig(db)
	if err != nil {
		return err
	}

	for _, c := range configs {
		switch c.Key {
		case "commission_flat":
			if v, err := strconv.Atoi(c.Value); err == nil {
				cfg.CommissionFlat = v
			}
		case "min_stake_amount":
			if v, err := strconv.Atoi(c.Value); err == nil {
				cfg.MinStakeAmount = v
			}
		case "payout_tax_percent":
			if v, err := strconv.Atoi(c.Value); err == nil {
				cfg.PayoutTaxPercent = v
			}
		case "game_expiry_minutes":
			if v, err := strconv.Atoi(c.Value); err == nil {
				cfg.GameExpiryMinutes = v
			}
		case "queue_expiry_minutes":
			if v, err := strconv.Atoi(c.Value); err == nil {
				cfg.QueueExpiryMinutes = v
			}
		case "idle_warning_seconds":
			if v, err := strconv.Atoi(c.Value); err == nil {
				cfg.IdleWarningSeconds = v
			}
		case "idle_forfeit_seconds":
			if v, err := strconv.Atoi(c.Value); err == nil {
				cfg.IdleForfeitSeconds = v
			}
		case "disconnect_grace_seconds":
			if v, err := strconv.Atoi(c.Value); err == nil {
				cfg.DisconnectGraceSeconds = v
			}
		case "min_withdraw_amount":
			if v, err := strconv.Atoi(c.Value); err == nil {
				cfg.MinWithdrawAmount = v
			}
		}
	}

	log.Printf("[CONFIG] Applied %d runtime config overrides from database", len(configs))
	return nil
}
