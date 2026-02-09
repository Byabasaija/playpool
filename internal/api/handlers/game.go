package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
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
	"github.com/playmatatu/backend/internal/payment"
	"github.com/playmatatu/backend/internal/sms"
	"github.com/redis/go-redis/v9"
)

// generateQueueToken returns a short random hex token used as the external queue token
func generateQueueToken() string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("qt_%d", time.Now().UnixNano()%1000000)
	}
	return hex.EncodeToString(b)
}

// generateMatchCode returns a short, human-friendly match code using Crockford-style base32
func generateMatchCode(length int) string {
	const charset = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	var out strings.Builder
	for i := 0; i < length; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			// fallback using time
			idx := int(time.Now().UnixNano() % int64(len(charset)))
			out.WriteByte(charset[idx])
			continue
		}
		out.WriteByte(charset[n.Int64()])
	}
	return out.String()
}

// InitiateStake handles stake initiation from web
// For development: This is a DUMMY payment - no actual Mobile Money integration
func InitiateStake(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			PhoneNumber   string `json:"phone_number" binding:"required"`
			StakeAmount   int    `json:"stake_amount" binding:"required"`
			DisplayName   string `json:"display_name,omitempty"`
			CreatePrivate bool   `json:"create_private,omitempty"`
			MatchCode     string `json:"match_code,omitempty"`
			InvitePhone   string `json:"invite_phone,omitempty"`
			Source        string `json:"source,omitempty"`
			ActionToken   string `json:"action_token,omitempty"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request. Phone number and stake amount required.",
			})
			return
		}

		// Validate stake amount
		minStake := 1000
		if cfg != nil && cfg.MinStakeAmount > 0 {
			minStake = cfg.MinStakeAmount
		}
		if req.StakeAmount < minStake {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Minimum stake amount is 1000 UGX",
			})
			return
		}

		// Normalize phone number
		phone := normalizePhone(req.PhoneNumber)
		if phone == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid phone number format",
			})
			return
		}

		// Upsert player by phone (create DisplayName if new)
		player, err := GetOrCreatePlayerByPhone(db, phone)
		if err != nil {
			log.Printf("[ERROR] InitiateStake - failed to upsert player %s: %v", phone, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process player"})
			return
		}

		// If client supplied a display name, validate and persist it (overrides generated/default)
		if req.DisplayName != "" {
			name := strings.TrimSpace(req.DisplayName)
			if name == "" || len(name) > 50 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid display_name"})
				return
			}
			// validation: allow letters, numbers, punctuation, symbols and space separators
			var validName = regexp.MustCompile("^[\\p{L}\\p{N}\\p{P}\\p{S}\\p{Zs}]+$")
			if !validName.MatchString(name) {
				log.Printf("[INFO] Invalid display_name attempt for phone %s: %q", phone, name)
				c.JSON(http.StatusBadRequest, gin.H{"error": "display_name contains invalid characters"})
				return
			}

			// Persist the provided name if different
			if name != player.DisplayName {
				if _, err := db.Exec(`UPDATE players SET display_name=$1 WHERE id=$2`, name, player.ID); err != nil {
					log.Printf("[DB] Failed to update display_name for player %d: %v", player.ID, err)
				} else {
					player.DisplayName = name
				}
			}
		}

		// Validate match_code if provided (join-by-code path)
		const defaultMatchCodeLength = 6
		if req.MatchCode != "" {
			code := strings.ToUpper(strings.TrimSpace(req.MatchCode))
			if len(code) != defaultMatchCodeLength {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid match_code"})
				return
			}
			// basic charset check
			if matched, _ := regexp.MatchString(`^[A-Z2-9]{6}$`, code); !matched {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid match_code format"})
				return
			}
			req.MatchCode = code
		}

		// If source is "winnings", validate and perform winnings transfer
		var useWinnings bool
		if req.Source == "winnings" {
			useWinnings = true

			// Require auth: action_token OR player session cookie
			if req.ActionToken == "" {
				// Fall back to player session cookie
				cookieToken, err := c.Cookie(playerCookieName)
				if err != nil || cookieToken == "" {
					c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required for winnings stake"})
					return
				}
				ctx := context.Background()
				sessionJSON, err := rdb.Get(ctx, fmt.Sprintf("player_session:%s", cookieToken)).Result()
				if err != nil {
					c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired session"})
					return
				}
				var sess map[string]interface{}
				if err := json.Unmarshal([]byte(sessionJSON), &sess); err != nil {
					c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session"})
					return
				}
				sessPlayerID, ok := sess["player_id"].(float64)
				if !ok || int(sessPlayerID) != player.ID {
					c.JSON(http.StatusUnauthorized, gin.H{"error": "session does not match player"})
					return
				}
				log.Printf("[INFO] Winnings stake authorized via session cookie: player=%d", player.ID)
			} else if req.ActionToken != "" {
				// Validate and consume action token (atomic GET+DEL with Lua)
				ctx := context.Background()
				tokenHash := sha256.Sum256([]byte(req.ActionToken))
				tokenHashStr := hex.EncodeToString(tokenHash[:])

				luaScript := `
					local payload = redis.call('GET', KEYS[1])
					if payload then
						redis.call('DEL', KEYS[1])
						return payload
					else
						return nil
					end
				`

				result, err := rdb.Eval(ctx, luaScript, []string{fmt.Sprintf("action_token:%s", tokenHashStr)}).Result()
				if err != nil || result == nil {
					c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired action token"})
					return
				}

				// Parse and validate payload
				var tokenPayload struct {
					Phone    string `json:"phone"`
					Action   string `json:"action"`
					PlayerID int    `json:"player_id"`
				}
				if err := json.Unmarshal([]byte(result.(string)), &tokenPayload); err != nil {
					log.Printf("Failed to parse action token payload: %v", err)
					c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid action token"})
					return
				}

				// Validate phone, action, and player_id match
				if tokenPayload.Phone != phone || tokenPayload.Action != "stake_winnings" || tokenPayload.PlayerID != player.ID {
					c.JSON(http.StatusUnauthorized, gin.H{"error": "action token validation failed"})
					return
				}
			}

			// Check sufficient winnings balance (regardless of action token)
			winningsAcc, err := accounts.GetOrCreateAccount(db, accounts.AccountPlayerWinnings, &player.ID)
			if err != nil {
				log.Printf("[ERROR] Failed to get winnings account for player %d: %v", player.ID, err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to access winnings account"})
				return
			}

			if winningsAcc.Balance < float64(req.StakeAmount) {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("insufficient winnings balance (have %.2f, need %d)", winningsAcc.Balance, req.StakeAmount)})
				return
			}

			log.Printf("[INFO] Validated action token for winnings stake: player=%d phone=%s amount=%d", player.ID, phone, req.StakeAmount)
		}

		log.Printf("[INFO] InitiateStake - player: id=%d phone=%s display_name=%s", player.ID, player.PhoneNumber, player.DisplayName)

		// DUMMY PAYMENT: Auto-approve payment (no actual Mobile Money call)
		transactionID := generateTransactionID()
		queueToken := generateQueueToken()

		// PAYMENT FLOW: Different logic for winnings vs. normal stake
		var txID int
		netAmount := float64(req.StakeAmount)

		if useWinnings {
			// WINNINGS FLOW: Charge commission like normal stake
			commission := float64(cfg.CommissionFlat)
			grossAmount := float64(req.StakeAmount + cfg.CommissionFlat)

			log.Printf("[WINNINGS STAKE] Player %d using winnings for stake %d UGX (with %d commission)", player.ID, req.StakeAmount, cfg.CommissionFlat)

			// Record transaction (type=STAKE_WINNINGS, WITH commission)
			if err := db.QueryRowx(`INSERT INTO transactions (player_id, transaction_type, amount, status, created_at) VALUES ($1,'STAKE_WINNINGS',$2,'COMPLETED',NOW()) RETURNING id`, player.ID, grossAmount).Scan(&txID); err != nil {
				log.Printf("[DB] Failed to insert winnings stake transaction: %v", err)
				// Continue - transaction is best-effort
			}

			// Prevent duplicate active queues for the same player
			var existingCount int
			if err := db.Get(&existingCount, `SELECT COUNT(*) FROM matchmaking_queue WHERE player_id=$1 AND status IN ('queued','processing','matching')`, player.ID); err == nil && existingCount > 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "player already has an active queue entry"})
				return
			}

			// Begin transaction for account transfers
			tx, err := db.Beginx()
			if err != nil {
				log.Printf("[DB] Failed to begin tx for winnings stake: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to process winnings stake"})
				return
			}

			// Get accounts
			winningsAcc, err := accounts.GetOrCreateAccount(db, accounts.AccountPlayerWinnings, &player.ID)
			if err != nil {
				tx.Rollback()
				log.Printf("[DB] Failed to get winnings account: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to access winnings account"})
				return
			}

			// Check sufficient balance (must cover stake + commission)
			if winningsAcc.Balance < grossAmount {
				tx.Rollback()
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("insufficient winnings balance (have %.2f, need %.2f for stake + commission)", winningsAcc.Balance, grossAmount)})
				return
			}

			settlementAcc, err := accounts.GetOrCreateAccount(db, accounts.AccountSettlement, nil)
			if err != nil {
				tx.Rollback()
				log.Printf("[DB] Failed to get settlement account: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to access settlement account"})
				return
			}

			platformAcc, err := accounts.GetOrCreateAccount(db, accounts.AccountPlatform, nil)
			if err != nil {
				tx.Rollback()
				log.Printf("[DB] Failed to get platform account: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to access platform account"})
				return
			}

			// Transfer: PLAYER_WINNINGS → SETTLEMENT (gross amount)
			if err := accounts.Transfer(tx, winningsAcc.ID, settlementAcc.ID, grossAmount, "TRANSACTION", sql.NullInt64{Int64: int64(txID), Valid: txID > 0}, "Winnings stake (gross)"); err != nil {
				tx.Rollback()
				log.Printf("[DB] Failed to transfer from winnings to settlement: %v", err)
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}

			// Transfer: SETTLEMENT → PLATFORM (commission)
			if err := accounts.Transfer(tx, settlementAcc.ID, platformAcc.ID, commission, "TRANSACTION", sql.NullInt64{Int64: int64(txID), Valid: txID > 0}, "Commission (winnings stake)"); err != nil {
				tx.Rollback()
				log.Printf("[DB] Failed to transfer commission: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to process commission"})
				return
			}

			// Transfer: SETTLEMENT → PLAYER_WINNINGS (net stake - stays in winnings for matching)
			if err := accounts.Transfer(tx, settlementAcc.ID, winningsAcc.ID, netAmount, "TRANSACTION", sql.NullInt64{Int64: int64(txID), Valid: txID > 0}, "Stake (net)"); err != nil {
				tx.Rollback()
				log.Printf("[DB] Failed to transfer net stake back to winnings: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to process net stake"})
				return
			}

			if err := tx.Commit(); err != nil {
				log.Printf("[DB] Commit failed for winnings stake: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit transaction"})
				return
			}

			log.Printf("[WINNINGS STAKE] Successfully processed winnings stake for player %d: commission=%.2f, net=%.2f", player.ID, commission, netAmount)

		} else {
			// NORMAL FLOW: Real DMarkPay payin integration (unless MockMode is enabled)
			var realPayment bool
			if payment.Default != nil && !cfg.MockMode {
				realPayment = true
				// Generate unique transaction ID
				txnID := fmt.Sprintf("%d", payment.GenerateTransactionID())

				// Build callback URL
				callbackURL := fmt.Sprintf("%s/api/v1/webhooks/dmark", cfg.DMarkPayCallbackURL)

				// Initiate payin
				payinReq := payment.PayinRequest{
					Phone:         phone,
					Amount:        float64(req.StakeAmount + cfg.CommissionFlat),
					TransactionID: txnID,
					NotifyURL:     callbackURL,
					Description:   fmt.Sprintf("Matatu stake: %d UGX", req.StakeAmount),
				}

				payinResp, err := payment.Default.Payin(context.Background(), payinReq)
				if err != nil {
					log.Printf("[PAYMENT] Payin failed for %s: %v", phone, err)
					c.JSON(http.StatusInternalServerError, gin.H{"error": "payment initiation failed"})
					return
				}

				// Create transaction record with status='PENDING' (account movements happen in webhook)
				if db != nil {
					if err := db.QueryRowx(`INSERT INTO transactions
						(player_id, transaction_type, amount, status, dmark_transaction_id, provider_status_code, provider_status_message, created_at)
						VALUES ($1, 'STAKE', $2, 'PENDING', $3, $4, $5, NOW()) RETURNING id`,
						player.ID,
						float64(req.StakeAmount+cfg.CommissionFlat),
						payinResp.TransactionID,
						payinResp.StatusCode,
						payinResp.Status).Scan(&txID); err != nil {
						log.Printf("[PAYMENT] Failed to create transaction: %v", err)
						c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record transaction"})
						return
					}
				}

				log.Printf("[PAYMENT] Payin initiated: txn=%s dmark_id=%s status=%s", txnID, payinResp.TransactionID, payinResp.Status)

				// Return immediately - player will be added to queue after webhook confirms payment
				c.JSON(http.StatusOK, gin.H{
					"message":              "Payment initiated. Complete payment on your phone to join the queue.",
					"transaction_id":       txnID,
					"dmark_transaction_id": payinResp.TransactionID,
					"status":               "PENDING",
				})
				return

			} else {
				// MOCK MODE: Dummy payment (no DMarkPay call or MockMode=true)
				realPayment = false
				if cfg.MockMode {
					log.Printf("[MOCK PAYMENT] MockMode enabled - simulating payment for %s %d UGX (transaction: %s)",
						phone, req.StakeAmount+cfg.CommissionFlat, transactionID)
				} else {
					log.Printf("[DUMMY PAYMENT] DMarkPay not configured - would charge %s %d UGX (transaction: %s)",
						phone, req.StakeAmount+cfg.CommissionFlat, transactionID)
				}

				// Record a transaction in DB and capture its id
				if db != nil {
					if err := db.QueryRowx(`INSERT INTO transactions (player_id, transaction_type, amount, status, created_at) VALUES ($1,'STAKE',$2,'COMPLETED',NOW()) RETURNING id`, player.ID, float64(req.StakeAmount+cfg.CommissionFlat)).Scan(&txID); err != nil {
						log.Printf("[DB] Failed to insert transaction for player %d: %v", player.ID, err)
						// continue - transaction best-effort for now
					}
				}
			}

			// Prevent duplicate active queues for the same player
			var existingCount int
			if err := db.Get(&existingCount, `SELECT COUNT(*) FROM matchmaking_queue WHERE player_id=$1 AND status IN ('queued','processing','matching')`, player.ID); err == nil && existingCount > 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "player already has an active queue entry"})
				return
			}

			// Perform account movements ONLY in dummy mode (real payment happens in webhook)
			if !realPayment {
				// Perform account movements: debit settlement, credit platform (commission), credit player_winnings (net)
				commission := float64(cfg.CommissionFlat)
				tx, err := db.Beginx()
				if err != nil {
					log.Printf("[DB] Failed to begin tx for stake deposit: %v", err)
				} else {
					// Get system accounts
					settlementAcc, errGet := accounts.GetOrCreateAccount(db, accounts.AccountSettlement, nil)
					if errGet != nil {
						log.Printf("[DB] Failed to get settlement account: %v", errGet)
						tx.Rollback()
					} else {
						platformAcc, errGet2 := accounts.GetOrCreateAccount(db, accounts.AccountPlatform, nil)
						if errGet2 != nil {
							log.Printf("[DB] Failed to get platform account: %v", errGet2)
							tx.Rollback()
						} else {
							winningsAcc, errGet3 := accounts.GetOrCreateAccount(db, accounts.AccountPlayerWinnings, &player.ID)
							if errGet3 != nil {
								log.Printf("[DB] Failed to get player winnings account for player %d: %v", player.ID, errGet3)
								tx.Rollback()
							} else {
								// Credit settlement account with the gross amount (stake + commission) so transfers can debit it
								gross := float64(req.StakeAmount + cfg.CommissionFlat)
								if _, err := tx.Exec(`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`, gross, settlementAcc.ID); err != nil {
									log.Printf("[DB] Failed to credit settlement account: %v", err)
									tx.Rollback()
								} else {
									// Record deposit as an account transaction (external -> settlement)
									if _, err := tx.Exec(`INSERT INTO account_transactions (debit_account_id, credit_account_id, amount, reference_type, reference_id, description, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`, nil, settlementAcc.ID, gross, "TRANSACTION", sql.NullInt64{Int64: int64(txID), Valid: txID > 0}, "Deposit (gross)"); err != nil {
										log.Printf("[DB] Failed to insert settlement deposit account_transaction: %v", err)
										tx.Rollback()
									} else {
										log.Printf("[DB] Credited settlement account id=%d amount=%.2f (tx=%d)", settlementAcc.ID, gross, txID)
										// Debit settlement -> credit platform (commission)
										if err := accounts.Transfer(tx, settlementAcc.ID, platformAcc.ID, commission, "TRANSACTION", sql.NullInt64{Int64: int64(txID), Valid: txID > 0}, "Commission (flat)"); err != nil {
											log.Printf("[DB] Failed to transfer commission: %v", err)
											tx.Rollback()
										} else {
											// Debit settlement -> credit player winnings (net amount)
											if err := accounts.Transfer(tx, settlementAcc.ID, winningsAcc.ID, netAmount, "TRANSACTION", sql.NullInt64{Int64: int64(txID), Valid: txID > 0}, "Deposit (net)"); err != nil {
												log.Printf("[DB] Failed to credit player winnings: %v", err)
												tx.Rollback()
											} else {
												if err := tx.Commit(); err != nil {
													log.Printf("[DB] Commit failed for stake deposit tx: %v", err)
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}

		// Insert into matchmaking_queue (durable ledger)
		var queueID int
		expiresAt := time.Now().Add(time.Duration(cfg.QueueExpiryMinutes) * time.Minute)
		if db != nil {
			// CREATE PRIVATE: generate a unique match code and mark row private
			if req.CreatePrivate {
				// Require invite phone for private matches
				if strings.TrimSpace(req.InvitePhone) == "" {
					c.JSON(http.StatusBadRequest, gin.H{"error": "invite_phone required for private matches"})
					return
				}
				invitePhoneNorm := normalizePhone(req.InvitePhone)
				if invitePhoneNorm == "" {
					c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invite_phone format"})
					return
				}
				// Attempt to generate and insert a unique match code several times on conflict
				attempts := 0
				var inserted bool
				for attempts < 5 && !inserted {
					attempts++
					code := generateMatchCode(defaultMatchCodeLength)
					insertQ := `INSERT INTO matchmaking_queue (player_id, phone_number, stake_amount, transaction_id, queue_token, status, created_at, expires_at, match_code, is_private) VALUES ($1,$2,$3,$4,$5,'queued',NOW(),$6,$7, TRUE) RETURNING id`
					if err := db.QueryRowx(insertQ, player.ID, phone, float64(req.StakeAmount), txID, queueToken, expiresAt, code).Scan(&queueID); err != nil {
						if strings.Contains(err.Error(), "duplicate key") {
							log.Printf("[DB] match_code collision on attempt %d, retrying", attempts)
							continue
						}
						log.Printf("[DB] Failed to insert private matchmaking_queue for player %d: %v", player.ID, err)
						c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create private match"})
						return
					}
					inserted = true
					if game.Manager != nil {
						entry := game.QueueEntry{
							QueueToken:  queueToken,
							PhoneNumber: phone,
							StakeAmount: req.StakeAmount,
							DBPlayerID:  player.ID,
							DisplayName: player.DisplayName,
							JoinedAt:    time.Now(),
						}
						game.Manager.AddQueueEntry(req.StakeAmount, entry)
					}

					// If the creator supplied an invite phone, send an invite SMS asynchronously (best-effort)
					var smsInviteQueued bool
					if strings.TrimSpace(req.InvitePhone) != "" && sms.Default != nil {
						invitePhone := normalizePhone(req.InvitePhone)
						if invitePhone != "" {
							smsInviteQueued = true
							joinLink := fmt.Sprintf("%s/join?match_code=%s&stake=%d&invite_phone=%s", cfg.FrontendURL, code, req.StakeAmount, url.QueryEscape(invitePhone))
							go func(code string, invite string, stake int, link string) {
								msg := fmt.Sprintf("Join my PlayMatatu match!\nCode: %s\nStake: %d UGX\n\n%s", code, stake, link)
								if msgID, err := sms.SendSMS(context.Background(), invite, msg); err != nil {
									log.Printf("[SMS] Failed to send invite to %s: %v", invite, err)
								} else {
									log.Printf("[SMS] Invite sent to %s msg_id=%s", invite, msgID)
								}
							}(code, invitePhone, req.StakeAmount, joinLink)
						}
					}

					c.JSON(http.StatusOK, gin.H{
						"status":            "private_created",
						"match_code":        code,
						"expires_at":        expiresAt,
						"queue_id":          queueID,
						"queue_token":       queueToken,
						"sms_invite_queued": smsInviteQueued,
						"message":           "Private match created. Share the code with a friend.",
						"player_token":      player.PlayerToken,
					})
				}
				if !inserted {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate unique match code, try again"})
				}
				return
			}

			// NORMAL / JOINER PATH: regular insert (we still include match_code if supplied by the client as a join attempt but not for public queueing)
			insertQ := `INSERT INTO matchmaking_queue (player_id, phone_number, stake_amount, transaction_id, queue_token, status, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,'queued',NOW(),$6) RETURNING id`
			if err := db.QueryRowx(insertQ, player.ID, phone, float64(req.StakeAmount), txID, queueToken, expiresAt).Scan(&queueID); err != nil {
				log.Printf("[DB] Failed to insert matchmaking_queue for player %d: %v", player.ID, err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to queue player"})
				return
			}
		}

		// If client provided a match code, attempt to claim it atomically and create a private match
		if req.MatchCode != "" {
			if game.Manager == nil {
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "match service unavailable"})
				return
			}
			log.Printf("[MATCH] Attempting join-by-code for code=%s queue_id=%d phone=%s", req.MatchCode, queueID, phone)
			matchResult, err := game.Manager.JoinPrivateMatch(req.MatchCode, queueID, phone, player.ID, player.DisplayName, req.StakeAmount)
			if err != nil {
				log.Printf("[MATCH] JoinPrivateMatch failed for code %s: %v", req.MatchCode, err)
				// cleanup our inserted queue row to avoid leaving user in normal queue when join-by-code failed
				if _, err2 := db.Exec(`DELETE FROM matchmaking_queue WHERE id=$1`, queueID); err2 != nil {
					log.Printf("[DB] Failed to delete my queue row after JoinPrivateMatch failure: %v", err2)
				}
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}

			// Successful private join - return matched response (same structure as immediate match)
			var myLink string
			var myDisplayName, opponentDisplayName string
			if matchResult.Player2ID == queueToken {
				myLink = matchResult.Player2Link
				myDisplayName = matchResult.Player2DisplayName
				opponentDisplayName = matchResult.Player1DisplayName
			} else {
				myLink = matchResult.Player1Link
				myDisplayName = matchResult.Player1DisplayName
				opponentDisplayName = matchResult.Player2DisplayName
			}

			c.JSON(http.StatusOK, gin.H{
				"status":                "matched",
				"game_id":               matchResult.GameID,
				"game_token":            matchResult.GameToken,
				"player_id":             queueToken, // legacy field (kept for compatibility)
				"queue_token":           queueToken,
				"player_token":          player.PlayerToken,
				"game_link":             myLink,
				"stake_amount":          req.StakeAmount,
				"prize_amount":          int(float64(req.StakeAmount*2) * 0.9), // 10% commission
				"expires_at":            matchResult.ExpiresAt,
				"message":               "Opponent found! Click link to start game.",
				"transaction_id":        transactionID,
				"my_display_name":       myDisplayName,
				"opponent_display_name": opponentDisplayName,
				"session_id":            matchResult.SessionID,
			})
			return
		}

		// Try to match immediately using Redis (pop-before-push). If no match, push our queue id into Redis.
		if game.Manager != nil {
			log.Printf("[MATCH] Attempting immediate Redis match for queue_id=%d stake=%d phone=%s", queueID, req.StakeAmount, phone)
			matchResult, err := game.Manager.TryMatchFromRedis(req.StakeAmount, queueID, phone, player.ID, player.DisplayName)
			if err != nil {
				log.Printf("[ERROR] TryMatchFromRedis failed: %v", err)
			}
			if matchResult != nil {
				// Immediate match!
				log.Printf("Match found via Redis! Game %s between %s and %s", matchResult.GameID, matchResult.Player1ID, matchResult.Player2ID)

				// Return matched response
				var myLink string
				var myDisplayName, opponentDisplayName string
				if matchResult.Player2ID == queueToken {
					myLink = matchResult.Player2Link
					myDisplayName = matchResult.Player2DisplayName
					opponentDisplayName = matchResult.Player1DisplayName
				} else {
					myLink = matchResult.Player1Link
					myDisplayName = matchResult.Player1DisplayName
					opponentDisplayName = matchResult.Player2DisplayName
				}

				c.JSON(http.StatusOK, gin.H{
					"status":                "matched",
					"game_id":               matchResult.GameID,
					"game_token":            matchResult.GameToken,
					"player_id":             queueToken, // legacy field (kept for compatibility)
					"queue_token":           queueToken,
					"player_token":          player.PlayerToken,
					"game_link":             myLink,
					"stake_amount":          req.StakeAmount,
					"prize_amount":          int(float64(req.StakeAmount*2) * 0.9), // 10% commission (legacy field, precise payout computed later)
					"expires_at":            matchResult.ExpiresAt,
					"message":               "Opponent found! Click link to start game.",
					"transaction_id":        transactionID,
					"my_display_name":       myDisplayName,
					"opponent_display_name": opponentDisplayName,
					"session_id":            matchResult.SessionID,
				})
				return
			}
		}

		// No immediate match - queued (matchmaker worker will match from DB)
		log.Printf("[QUEUE] Player queued: player=%s phone=%s stake=%d queue_id=%d", queueToken, phone, req.StakeAmount, queueID)

		c.JSON(http.StatusOK, gin.H{
			"status":         "queued",
			"player_id":      queueToken, // legacy
			"queue_token":    queueToken,
			"player_token":   player.PlayerToken,
			"queue_id":       queueID,
			"stake_amount":   req.StakeAmount,
			"display_name":   player.DisplayName,
			"message":        "Payment received! Finding opponent...",
			"transaction_id": transactionID,
		})
	}
}

// CheckQueueStatus checks if a player has been matched (DB-only, matchmaker worker handles matching)
func CheckQueueStatus(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		queueToken := c.Query("queue_token")
		if queueToken == "" {
			queueToken = c.Query("player_id") // legacy fallback
		}

		// Support querying by phone number (for payment confirmation polling)
		phone := c.Query("phone")
		if queueToken == "" && phone != "" {
			// Look up most recent active or matched queue entry for this phone
			var queue struct {
				QueueToken string `db:"queue_token"`
			}
			err := db.Get(&queue, `
				SELECT queue_token
				FROM matchmaking_queue
				WHERE phone_number = $1
				  AND status IN ('queued', 'processing', 'matching', 'matched')
				ORDER BY created_at DESC
				LIMIT 1
			`, phone)

			if err == nil {
				queueToken = queue.QueueToken
			} else {
				// No active queue found for this phone
				log.Printf("[QUEUE STATUS] No active queue found for phone %s", phone)
				c.JSON(http.StatusOK, gin.H{
					"status":  "not_found",
					"message": "Payment not yet confirmed. Please wait...",
				})
				return
			}
		}

		if queueToken == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "queue_token or player_id required"})
			return
		}

		// Query DB for queue entry status (single source of truth)
		var dbQueue struct {
			ID          int     `db:"id"`
			PlayerID    int     `db:"player_id"`
			PhoneNumber string  `db:"phone_number"`
			StakeAmount float64 `db:"stake_amount"`
			QueueToken  string  `db:"queue_token"`
			Status      string  `db:"status"`
			SessionID   *int    `db:"session_id"`
			GameToken   *string `db:"game_token"`
		}
		err := db.Get(&dbQueue, `
			SELECT mq.id, mq.player_id, mq.phone_number, mq.stake_amount, mq.queue_token, mq.status, mq.session_id, gs.game_token
			FROM matchmaking_queue mq
			LEFT JOIN game_sessions gs ON mq.session_id = gs.id
			WHERE mq.queue_token = $1
			ORDER BY mq.created_at DESC
			LIMIT 1
		`, queueToken)

		if err != nil {
			log.Printf("[QUEUE STATUS] Queue token %s not found in DB", queueToken)
			c.JSON(http.StatusOK, gin.H{
				"status":  "not_found",
				"message": "Player not in queue. Please stake again.",
			})
			return
		}

		log.Printf("[QUEUE STATUS] Queue entry found: token=%s status=%s session_id=%v", queueToken, dbQueue.Status, dbQueue.SessionID)

		// Get player's player_token for auth purposes
		var playerToken string
		db.Get(&playerToken, `SELECT player_token FROM players WHERE id = $1`, dbQueue.PlayerID)

		switch dbQueue.Status {
		case "matched":
			if dbQueue.GameToken == nil {
				log.Printf("[QUEUE STATUS] Player %s matched but no game token yet", queueToken)
				c.JSON(http.StatusOK, gin.H{
					"status":       "queued",
					"queue_token":  queueToken,
					"player_token": playerToken,
					"message":      "Match found, preparing game...",
				})
				return
			}

			// Get game from in-memory for player token lookup
			gameState, err := game.Manager.GetGameByToken(*dbQueue.GameToken)
			var gameLink string
			if err == nil {
				// Found in memory - use player tokens
				if gameState.Player1.ID == queueToken {
					gameLink = cfg.FrontendURL + "/g/" + *dbQueue.GameToken + "?pt=" + gameState.Player1.PlayerToken
				} else {
					gameLink = cfg.FrontendURL + "/g/" + *dbQueue.GameToken + "?pt=" + gameState.Player2.PlayerToken
				}
			} else {
				// Not in memory yet - use basic link (player will auth via queue token)
				gameLink = cfg.FrontendURL + "/g/" + *dbQueue.GameToken
			}

			c.JSON(http.StatusOK, gin.H{
				"status":       "matched",
				"game_token":   *dbQueue.GameToken,
				"game_link":    gameLink,
				"queue_token":  queueToken,
				"player_token": playerToken,
				"stake_amount": int(dbQueue.StakeAmount),
				"message":      "Opponent found! Click link to play.",
			})

		case "queued", "processing", "matching":
			c.JSON(http.StatusOK, gin.H{
				"status":       "queued",
				"queue_token":  queueToken,
				"player_token": playerToken,
				"message":      "Still waiting for opponent...",
			})

		case "expired":
			c.JSON(http.StatusOK, gin.H{
				"status":  "expired",
				"message": "Queue expired. Your balance is available to play again or withdraw.",
			})

		case "declined":
			c.JSON(http.StatusOK, gin.H{
				"status":  "declined",
				"message": "Your match invite was declined. You can create a new match anytime!",
			})

		default:
			c.JSON(http.StatusOK, gin.H{
				"status":  dbQueue.Status,
				"message": "Queue status: " + dbQueue.Status,
			})
		}
	}
}

// GetGameState returns current game state for a player
func GetGameState(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.Param("token")
		pt := c.Query("pt") // pt is either a player token (preferred) or a player id

		// Get game by token
		gameState, err := game.Manager.GetGameByToken(token)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Game not found",
			})
			return
		}

		if pt == "" {
			// Return basic game info without player-specific data
			c.JSON(http.StatusOK, gin.H{
				"game_id":      gameState.ID,
				"status":       gameState.Status,
				"stake_amount": gameState.StakeAmount,
				"created_at":   gameState.CreatedAt,
			})
			return
		}

		// Resolve pt to a player ID. 'pt' may be either a player ID already or a player token.
		var resolvedPlayerID string
		if pt == gameState.Player1.ID || pt == gameState.Player2.ID {
			resolvedPlayerID = pt
		} else if pt == gameState.Player1.PlayerToken {
			resolvedPlayerID = gameState.Player1.ID
		} else if pt == gameState.Player2.PlayerToken {
			resolvedPlayerID = gameState.Player2.ID
		} else {
			c.JSON(http.StatusForbidden, gin.H{"error": "invalid player token"})
			return
		}

		// Return player-specific game state
		state := gameState.GetGameStateForPlayer(resolvedPlayerID)
		c.JSON(http.StatusOK, state)
	}
}

// GetPlayerStats returns player statistics
func GetPlayerStats(db *sqlx.DB, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		phone := c.Param("phone")

		// Load player record
		var p struct {
			ID               int     `db:"id"`
			TotalGamesPlayed int     `db:"total_games_played"`
			TotalGamesWon    int     `db:"total_games_won"`
			TotalGamesDrawn  int     `db:"total_games_drawn"`
			TotalWinnings    float64 `db:"total_winnings"`
		}
		if err := db.Get(&p, `SELECT id, total_games_played, total_games_won, total_games_drawn, total_winnings FROM players WHERE phone_number=$1`, phone); err != nil {
			// If no player found, return defaults
			c.JSON(http.StatusOK, gin.H{
				"phone_number":   phone,
				"games_played":   0,
				"games_won":      0,
				"games_drawn":    0,
				"win_rate":       0.0,
				"total_winnings": 0,
				"current_streak": 0,
				"rank":           "Bronze",
			})
			return
		}

		// Compute win rate
		winRate := 0.0
		if p.TotalGamesPlayed > 0 {
			winRate = (float64(p.TotalGamesWon) / float64(p.TotalGamesPlayed)) * 100.0
		}

		// Compute current streak (consecutive wins from most recent completed games)
		rows, err := db.Queryx(`SELECT winner_id FROM game_sessions WHERE (player1_id=$1 OR player2_id=$1) AND status='COMPLETED' ORDER BY completed_at DESC LIMIT 50`, p.ID)
		if err != nil {
			log.Printf("Failed to query recent games for streak: %v", err)
		}
		streak := 0
		for rows != nil && rows.Next() {
			var winnerID sql.NullInt64
			if err := rows.Scan(&winnerID); err != nil {
				break
			}
			if winnerID.Valid && int(winnerID.Int64) == p.ID {
				streak++
			} else {
				break
			}
		}
		if rows != nil {
			rows.Close()
		}

		// Derive a simple rank from total winnings
		rank := "Bronze"
		if p.TotalWinnings >= 20000 {
			rank = "Gold"
		} else if p.TotalWinnings >= 5000 {
			rank = "Silver"
		}

		c.JSON(http.StatusOK, gin.H{
			"phone_number":   phone,
			"games_played":   p.TotalGamesPlayed,
			"games_won":      p.TotalGamesWon,
			"games_drawn":    p.TotalGamesDrawn,
			"win_rate":       winRate,
			"total_winnings": p.TotalWinnings,
			"current_streak": streak,
			"rank":           rank,
		})
	}
}

// GetQueueStatus returns the current matchmaking queue status
func GetQueueStatus(rdb *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		status := game.Manager.GetQueueStatus()
		activeGames := game.Manager.GetActiveGameCount()

		c.JSON(http.StatusOK, gin.H{
			"queue_by_stake": status,
			"active_games":   activeGames,
		})
	}
}

// CreateTestGame creates a game for testing (dev mode only)
func CreateTestGame(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			StakeAmount int `json:"stake_amount"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			req.StakeAmount = 1000 // default
		}

		// Create a test game with two dummy players
		gameState, err := game.Manager.CreateTestGame(
			"+256700111111",
			"+256700222222",
			req.StakeAmount,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"game_id":    gameState.ID,
			"game_token": gameState.Token,
			"player1_id": gameState.Player1.ID,
			"player2_id": gameState.Player2.ID,
			"stake":      gameState.StakeAmount,
			"message":    "Test game created",
		})
	}
}

// CreateTestDrawGame creates a game that will end in a draw (for testing)
func CreateTestDrawGame(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			StakeAmount int `json:"stake_amount"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			req.StakeAmount = 1000 // default
		}

		// Create a test game with equal point hands
		gameState, err := game.Manager.CreateTestDrawGame(
			"+256788674758",
			"+256752327022",
			req.StakeAmount,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"game_id":       gameState.ID,
			"game_token":    gameState.Token,
			"player1_id":    gameState.Player1.ID,
			"player1_token": gameState.Player1.PlayerToken,
			"player2_id":    gameState.Player2.ID,
			"player2_token": gameState.Player2.PlayerToken,
			"stake":         gameState.StakeAmount,
			"target_suit":   gameState.TargetSuit,
			"message":       "Test draw game created. Player 1 has the 7 of target suit. When played, game will end in a draw (both players have 17 points).",
			"instructions":  "Connect both players via WebSocket, then have Player 1 play the 7 of Hearts to trigger the draw.",
		})
	}
}

// DeclineMatchInvite handles declining a match invitation
// POST /api/v1/match/decline
func DeclineMatchInvite(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Phone     string `json:"phone"`
			MatchCode string `json:"match_code"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}

		phone := strings.TrimSpace(req.Phone)
		matchCode := strings.TrimSpace(req.MatchCode)

		if phone == "" || matchCode == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "phone and match_code required"})
			return
		}

		// Find the private match queue entry by match_code
		var queue struct {
			ID           int    `db:"id"`
			PlayerID     int    `db:"player_id"`
			InviterPhone string `db:"inviter_phone"`
			Status       string `db:"status"`
		}

		err := db.Get(&queue, `
			SELECT mq.id, mq.player_id, p.phone_number as inviter_phone, mq.status
			FROM matchmaking_queue mq
			JOIN players p ON p.id = mq.player_id
			WHERE mq.match_code = $1 AND mq.is_private = true AND mq.status IN ('queued', 'matching')
		`, matchCode)

		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "match not found or already expired"})
			return
		}
		if err != nil {
			log.Printf("DeclineMatchInvite DB error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
			return
		}

		// Update queue status to 'declined'
		_, err = db.Exec(`UPDATE matchmaking_queue SET status = 'declined' WHERE id = $1`, queue.ID)
		if err != nil {
			log.Printf("DeclineMatchInvite update error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to decline match"})
			return
		}

		// Notify the inviter about the decline via SMS
		go func() {
			ctx := context.Background()
			message := fmt.Sprintf("Your PlayMatatu match invite (Code: %s) was declined. You can create a new match anytime!", matchCode)

			if _, err := sms.SendSMS(ctx, queue.InviterPhone, message); err != nil {
				log.Printf("Failed to send decline SMS to %s: %v", queue.InviterPhone, err)
			} else {
				log.Printf("Decline SMS sent to %s for match %s", queue.InviterPhone, matchCode)
			}
		}()

		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "Match invitation declined successfully",
		})
	}
}
