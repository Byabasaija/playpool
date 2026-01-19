package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/models"
)

// generateDisplayName creates a short fun display name
func generateDisplayName() string {
	adjectives := []string{"Lucky", "Swift", "Brave", "Jolly", "Mighty", "Quiet", "Clever", "Happy", "Kitenge", "Zesty"}
	nouns := []string{"Zebu", "Rider", "Matatu", "Champion", "Sevens", "Ace", "Mamba", "Jua", "Lion", "Drift"}
	// use current time to avoid collisions
	si := time.Now().UnixNano() % int64(len(nouns))
	ai := (time.Now().UnixNano() / 7) % int64(len(adjectives))
	num := int(time.Now().UnixNano() % 1000) // 0-999
	return fmt.Sprintf("%s %s %d", adjectives[ai], nouns[si], num)
}

// GetOrCreatePlayerByPhone returns existing player or creates a new one with random display name
func GetOrCreatePlayerByPhone(db *sqlx.DB, phone string) (*models.Player, error) {
	if db == nil {
		return nil, fmt.Errorf("db is nil")
	}

	phone = strings.TrimSpace(phone)
	if phone == "" {
		return nil, fmt.Errorf("empty phone")
	}

	var p models.Player
	fullQuery := `SELECT id, phone_number, display_name, created_at, total_games_played, total_games_won, total_winnings, is_active, is_blocked, block_reason, block_until, disconnect_count, no_show_count, last_active FROM players WHERE phone_number=$1`
	if err := db.Get(&p, fullQuery, phone); err == nil {
		// Update last_active
		if _, err := db.Exec(`UPDATE players SET last_active = NOW() WHERE id = $1`, p.ID); err != nil {
			log.Printf("[DB] Failed to update last_active for player %d: %v", p.ID, err)
		}
		return &p, nil
	} else if err != sql.ErrNoRows {
		// Might be that display_name column doesn't exist (migration missing)
		// Try a fallback that selects without display_name
		var colCount int
		if err2 := db.Get(&colCount, `SELECT COUNT(*) FROM information_schema.columns WHERE table_name='players' AND column_name='display_name'`); err2 == nil && colCount == 0 {
			// Column missing - try selecting without it
			fallbackQuery := `SELECT id, phone_number, created_at, total_games_played, total_games_won, total_winnings, is_active, is_blocked, block_reason, block_until, disconnect_count, no_show_count, last_active FROM players WHERE phone_number=$1`
			if err3 := db.Get(&p, fallbackQuery, phone); err3 == nil {
				p.DisplayName = ""
				if _, err := db.Exec(`UPDATE players SET last_active = NOW() WHERE id = $1`, p.ID); err != nil {
					log.Printf("[DB] Failed to update last_active for player %d: %v", p.ID, err)
				}
				return &p, nil
			} else if err3 != sql.ErrNoRows {
				return nil, err3
			}
		}

		// Other error - return it
		return nil, err
	}

	// No existing player - create one
	display := generateDisplayName()
	var id int
	insert := `INSERT INTO players (phone_number, display_name, created_at) VALUES ($1, $2, NOW()) RETURNING id`
	if err := db.QueryRowx(insert, phone, display).Scan(&id); err != nil {
		// If insert fails because display_name column missing, try insert without it
		var colCount int
		if err2 := db.Get(&colCount, `SELECT COUNT(*) FROM information_schema.columns WHERE table_name='players' AND column_name='display_name'`); err2 == nil && colCount == 0 {
			if err3 := db.QueryRowx(`INSERT INTO players (phone_number, created_at) VALUES ($1, NOW()) RETURNING id`, phone).Scan(&id); err3 != nil {
				return nil, err3
			}
		} else {
			return nil, err
		}
	}

	// Fetch and return
	if err := db.Get(&p, `SELECT id, phone_number, display_name, created_at, total_games_played, total_games_won, total_winnings, is_active, is_blocked, block_reason, block_until, disconnect_count, no_show_count, last_active FROM players WHERE id=$1`, id); err != nil {
		// If the full select fails (e.g. missing display_name), try fallback
		var colCount int
		if err2 := db.Get(&colCount, `SELECT COUNT(*) FROM information_schema.columns WHERE table_name='players' AND column_name='display_name'`); err2 == nil && colCount == 0 {
			if err3 := db.Get(&p, `SELECT id, phone_number, created_at, total_games_played, total_games_won, total_winnings, is_active, is_blocked, block_reason, block_until, disconnect_count, no_show_count, last_active FROM players WHERE id=$1`, id); err3 != nil {
				return nil, err3
			}
			p.DisplayName = ""
			return &p, nil
		}
		return nil, err
	}
	return &p, nil
}
