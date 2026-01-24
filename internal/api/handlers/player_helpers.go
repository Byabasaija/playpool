package handlers

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/accounts"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/game"
	"github.com/playmatatu/backend/internal/models"
	"github.com/playmatatu/backend/internal/sms"
	"github.com/playmatatu/backend/internal/ws"
	"github.com/redis/go-redis/v9"
)

// generatePlayerToken returns a short random hex token for player_token
func generatePlayerToken() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// fallback to timestamp-based token
		return fmt.Sprintf("pt_%d", time.Now().UnixNano()%1000000)
	}
	return hex.EncodeToString(b)
}

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
	fullQuery := `SELECT id, phone_number, display_name, player_token, created_at, total_games_played, total_games_won, total_winnings, is_active, is_blocked, block_reason, block_until, disconnect_count, no_show_count, last_active FROM players WHERE phone_number=$1`
	if err := db.Get(&p, fullQuery, phone); err == nil {
		// Ensure player_token exists
		if p.PlayerToken == "" {
			pt := generatePlayerToken()
			if _, err := db.Exec(`UPDATE players SET player_token=$1 WHERE id=$2`, pt, p.ID); err == nil {
				p.PlayerToken = pt
			}
		}
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
			fallbackQuery := `SELECT id, phone_number, player_token, created_at, total_games_played, total_games_won, total_winnings, is_active, is_blocked, block_reason, block_until, disconnect_count, no_show_count, last_active FROM players WHERE phone_number=$1`
			if err3 := db.Get(&p, fallbackQuery, phone); err3 == nil {
				p.DisplayName = ""
				// Ensure player_token exists
				if p.PlayerToken == "" {
					pt := generatePlayerToken()
					if _, err := db.Exec(`UPDATE players SET player_token=$1 WHERE id=$2`, pt, p.ID); err == nil {
						p.PlayerToken = pt
					}
				}
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
	pt := generatePlayerToken()
	var id int
	insert := `INSERT INTO players (phone_number, display_name, player_token, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id`
	if err := db.QueryRowx(insert, phone, display, pt).Scan(&id); err != nil {
		// If insert fails because display_name column missing, try insert without it
		var colCount int
		if err2 := db.Get(&colCount, `SELECT COUNT(*) FROM information_schema.columns WHERE table_name='players' AND column_name='display_name'`); err2 == nil && colCount == 0 {
			if err3 := db.QueryRowx(`INSERT INTO players (phone_number, player_token, created_at) VALUES ($1, $2, NOW()) RETURNING id`, phone, pt).Scan(&id); err3 != nil {
				return nil, err3
			}
		} else {
			return nil, err
		}
	}

	// Fetch and return
	if err := db.Get(&p, `SELECT id, phone_number, display_name, player_token, created_at, total_games_played, total_games_won, total_winnings, is_active, is_blocked, block_reason, block_until, disconnect_count, no_show_count, last_active FROM players WHERE id=$1`, id); err != nil {
		// If the full select fails (e.g. missing display_name), try fallback
		var colCount int
		if err2 := db.Get(&colCount, `SELECT COUNT(*) FROM information_schema.columns WHERE table_name='players' AND column_name='display_name'`); err2 == nil && colCount == 0 {
			if err3 := db.Get(&p, `SELECT id, phone_number, player_token, created_at, total_games_played, total_games_won, total_winnings, is_active, is_blocked, block_reason, block_until, disconnect_count, no_show_count, last_active FROM players WHERE id=$1`, id); err3 != nil {
				return nil, err3
			}
			p.DisplayName = ""
			return &p, nil
		}
		return nil, err
	}
	return &p, nil
}

// UpdateDisplayName allows a client to change a player's display name.
// Route: PUT /api/v1/player/:phone/display-name
func UpdateDisplayName(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db not available"})
			return
		}

		phoneParam := c.Param("phone")
		phone := normalizePhone(phoneParam)
		if phone == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid phone format"})
			return
		}

		var body struct {
			DisplayName string `json:"display_name"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}

		name := strings.TrimSpace(body.DisplayName)
		if name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "display_name cannot be empty"})
			return
		}
		if len(name) > 50 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "display_name too long (max 50)"})
			return
		}

		// Simple character whitelist: letters, numbers, punctuation, symbols and space separators
		var validName = regexp.MustCompile("^[\\p{L}\\p{N}\\p{P}\\p{S}\\p{Zs}]+$")
		if !validName.MatchString(name) {
			log.Printf("[INFO] Invalid display_name attempt for phone %s: %q", phone, name)
			c.JSON(http.StatusBadRequest, gin.H{"error": "display_name contains invalid characters"})
			return
		}

		// Update database
		res, err := db.Exec(`UPDATE players SET display_name=$1 WHERE phone_number=$2`, name, phone)
		if err != nil {
			log.Printf("[DB] Failed to update display_name for %s: %v", phone, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update display_name"})
			return
		}
		rows, _ := res.RowsAffected()
		if rows == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "player not found"})
			return
		}

		// Update manager state (queue + games) and notify
		updatedGames := game.Manager.UpdateDisplayName(phone, name)
		for _, gid := range updatedGames {
			g, err := game.Manager.GetGame(gid)
			if err != nil || g == nil {
				log.Printf("[WARN] Updated game %s not found: %v", gid, err)
				continue
			}

			// Persist and notify
			go g.SaveToRedis()
			p1State := g.GetGameStateForPlayer(g.Player1.ID)
			p1State["type"] = "game_update"
			p2State := g.GetGameStateForPlayer(g.Player2.ID)
			p2State["type"] = "game_update"
			ws.GameHub.SendToPlayer(g.Player1.ID, p1State)
			ws.GameHub.SendToPlayer(g.Player2.ID, p2State)
		}

		c.JSON(http.StatusOK, gin.H{"status": "ok", "display_name": name})
	}
}

// GetPlayerProfile returns basic player info (display_name) + fee-exempt balance and expired queue info if any
func GetPlayerProfile(db *sqlx.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db not available"})
			return
		}

		phoneParam := c.Param("phone")
		phone := normalizePhone(phoneParam)
		if phone == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid phone format"})
			return
		}

		var p models.Player
		if err := db.Get(&p, `SELECT id, phone_number, display_name FROM players WHERE phone_number=$1`, phone); err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, gin.H{"error": "player not found"})
				return
			}
			log.Printf("[DB] Failed to fetch player %s: %v", phone, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch player"})
			return
		}

		// Get fee-exempt balance
		feeBalance := 0.0
		if acc, err := accounts.GetOrCreateAccount(db, accounts.AccountPlayerFeeExempt, &p.ID); err == nil {
			feeBalance = acc.Balance
		}

		// Check for latest expired queue row
		var expired struct {
			ID          int     `db:"id"`
			StakeAmount float64 `db:"stake_amount"`
			MatchCode   string  `db:"match_code"`
			IsPrivate   bool    `db:"is_private"`
		}
		hasExpired := false
		if err := db.Get(&expired, `SELECT id, stake_amount, match_code, is_private FROM matchmaking_queue WHERE player_id=$1 AND status='expired' ORDER BY created_at DESC LIMIT 1`, p.ID); err == nil {
			hasExpired = true
		}

		resp := gin.H{"display_name": p.DisplayName, "fee_exempt_balance": feeBalance, "player_token": p.PlayerToken}
		if hasExpired {
			resp["expired_queue"] = gin.H{"id": expired.ID, "stake_amount": int(expired.StakeAmount), "match_code": expired.MatchCode, "is_private": expired.IsPrivate}
		}

		c.JSON(http.StatusOK, resp)
	}
}

// RequeueStake allows a player to requeue using existing fee-exempt credit. Route: POST /api/v1/player/:phone/requeue
func RequeueStake(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db not available"})
			return
		}

		phoneParam := c.Param("phone")
		phone := normalizePhone(phoneParam)
		if phone == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid phone format"})
			return
		}

		var req struct {
			QueueID     *int   `json:"queue_id,omitempty"`
			StakeAmount *int   `json:"stake_amount,omitempty"`
			Mode        string `json:"mode,omitempty"` // "private" to retry private invite
			InvitePhone string `json:"invite_phone,omitempty"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			// allow empty body
		}

		player, err := GetOrCreatePlayerByPhone(db, phone)
		if err != nil {
			log.Printf("[ERROR] RequeueStake - failed to resolve player %s: %v", phone, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve player"})
			return
		}

		// Determine stake amount
		var stakeAmount int
		if req.QueueID != nil {
			// fetch the expired queue row
			var q models.MatchmakingQueue
			if err := db.Get(&q, `SELECT id, stake_amount FROM matchmaking_queue WHERE id=$1 AND player_id=$2 AND status='expired'`, *req.QueueID, player.ID); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "expired queue not found or not eligible"})
				return
			}
			stakeAmount = int(q.StakeAmount)
		} else if req.StakeAmount != nil {
			stakeAmount = *req.StakeAmount
			// attempt to find a matching expired queue row for audit link (optional)
			var q models.MatchmakingQueue
			if err := db.Get(&q, `SELECT id FROM matchmaking_queue WHERE player_id=$1 AND stake_amount=$2 AND status='expired' ORDER BY created_at DESC LIMIT 1`, player.ID, float64(stakeAmount)); err == nil {
				// nothing to do; optional linkage
			}
		} else {
			// try to pick latest expired queue
			var q models.MatchmakingQueue
			if err := db.Get(&q, `SELECT id, stake_amount FROM matchmaking_queue WHERE player_id=$1 AND status='expired' ORDER BY created_at DESC LIMIT 1`, player.ID); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "no expired stake available to requeue"})
				return
			}
			stakeAmount = int(q.StakeAmount)
		}

		// Check fee-exempt balance
		feeBalance := 0.0
		if acc, err := accounts.GetOrCreateAccount(db, accounts.AccountPlayerFeeExempt, &player.ID); err == nil {
			feeBalance = acc.Balance
		}
		if feeBalance < float64(stakeAmount) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "insufficient fee-exempt balance to requeue"})
			return
		}

		// Ensure no active queued row exists
		var existingCount int
		if err := db.Get(&existingCount, `SELECT COUNT(*) FROM matchmaking_queue WHERE player_id=$1 AND status IN ('queued','processing','matching')`, player.ID); err == nil && existingCount > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "player already has an active queue entry"})
			return
		}

		// If caller asked to retry private, insert a private matchmaking_queue and optionally send invite SMS
		if strings.ToLower(req.Mode) == "private" {
			// Insert private match code with retries on collision
			attempts := 0
			var inserted bool
			var queueID int
			var code string
			expiresAt := time.Now().Add(time.Duration(cfg.QueueExpiryMinutes) * time.Minute)
			qToken := generateQueueToken()
			for attempts < 5 && !inserted {
				attempts++
				code = generateMatchCode(6)
				if err := db.QueryRowx(`INSERT INTO matchmaking_queue (player_id, phone_number, stake_amount, transaction_id, queue_token, status, created_at, expires_at, match_code, is_private) VALUES ($1,$2,$3,null,$4,'queued',NOW(),$5,$6, TRUE) RETURNING id`, player.ID, phone, float64(stakeAmount), qToken, expiresAt, code).Scan(&queueID); err != nil {
					if strings.Contains(err.Error(), "duplicate key") {
						log.Printf("[DB] match_code collision on requeue attempt %d, retrying", attempts)
						continue
					}
					log.Printf("[DB] Failed to insert private matchmaking_queue for player %d on requeue: %v", player.ID, err)
					c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create private match"})
					return
				}
				inserted = true
				// Add to in-memory queue for visibility
				if game.Manager != nil {
					entry := game.QueueEntry{
						QueueToken:  qToken,
						PhoneNumber: phone,
						StakeAmount: stakeAmount,
						DBPlayerID:  player.ID,
						DisplayName: player.DisplayName,
						JoinedAt:    time.Now(),
					}
					game.Manager.AddQueueEntry(stakeAmount, entry)
				}
			}

			// Optionally send invite SMS to provided number
			var smsInviteQueued bool
			if strings.TrimSpace(req.InvitePhone) != "" && sms.Default != nil {
				invite := normalizePhone(req.InvitePhone)
				if invite != "" {
					smsInviteQueued = true
					joinLink := fmt.Sprintf("%s/join?match_code=%s&stake=%d&invite_phone=%s", cfg.FrontendURL, code, stakeAmount, url.QueryEscape(invite))
					go func(code string, invite string, stake int, link string) {
						msg := fmt.Sprintf("Join my PlayMatatu private match! Code: %s. Stake: %d UGX. Join: %s", code, stake, link)
						if msgID, err := sms.SendSMS(context.Background(), invite, msg); err != nil {
							log.Printf("[SMS] Failed to send invite to %s on requeue: %v", invite, err)
						} else {
							log.Printf("[SMS] Invite sent to %s msg_id=%s", invite, msgID)
						}
					}(code, invite, stakeAmount, joinLink)
				}
			}

			// Return private_created payload
			c.JSON(http.StatusOK, gin.H{
				"status":            "private_created",
				"match_code":        code,
				"expires_at":        expiresAt,
				"queue_id":          queueID,
				"queue_token":       qToken,
				"sms_invite_queued": smsInviteQueued,
				"message":           "Private match recreated. Share the code with a friend.",
				"player_token":      player.PlayerToken,
			})
			return
		}

		// standardized queue token
		playerEphemeral := generateQueueToken()

		// Insert new matchmaking_queue row and try immediate match
		var queueID int
		expiresAt := time.Now().Add(time.Duration(cfg.QueueExpiryMinutes) * time.Minute)
		if err := db.QueryRowx(`INSERT INTO matchmaking_queue (player_id, phone_number, stake_amount, transaction_id, queue_token, status, created_at, expires_at) VALUES ($1,$2,$3,null,$4,'queued',NOW(),$5) RETURNING id`, player.ID, phone, float64(stakeAmount), playerEphemeral, expiresAt).Scan(&queueID); err != nil {
			log.Printf("[DB] Failed to insert requeue matchmaking_queue for player %d: %v", player.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to requeue player"})
			return
		}

		// Add to in-memory matchmaking queue
		if game.Manager != nil {
			entry := game.QueueEntry{
				QueueToken:  playerEphemeral,
				PhoneNumber: phone,
				StakeAmount: stakeAmount,
				DBPlayerID:  player.ID,
				DisplayName: player.DisplayName,
				JoinedAt:    time.Now(),
			}
			game.Manager.AddQueueEntry(stakeAmount, entry)
			// Return the queue token in the response
			c.JSON(http.StatusOK, gin.H{"status": "queued", "queue_id": queueID, "stake_amount": stakeAmount, "queue_token": playerEphemeral, "player_token": player.PlayerToken})
			return
		}

		c.JSON(http.StatusOK, gin.H{"status": "queued", "queue_id": queueID, "stake_amount": stakeAmount})
	}
}
