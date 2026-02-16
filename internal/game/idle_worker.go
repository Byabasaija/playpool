package game

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/playpool/backend/internal/config"
	"github.com/redis/go-redis/v9"
)

// StartIdleWorker starts a background worker that processes idle warnings and forfeits using Redis sorted sets
func StartIdleWorker(ctx context.Context, db *sqlx.DB, rdb *redis.Client, cfg *config.Config) {
	if rdb == nil || cfg == nil {
		log.Println("[IDLE] Redis or config missing; idle worker not started")
		return
	}

	log.Println("[IDLE] Idle worker started")
	go func() {
		ticker := time.NewTicker(time.Duration(cfg.IdleWorkerPollInterval) * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("[IDLE] Idle worker stopping")
				return
			case <-ticker.C:
				now := time.Now().Unix()

				// Process warnings
				members, err := rdb.ZRangeByScore(ctx, "idle_warning", &redis.ZRangeBy{Min: "-inf", Max: fmt.Sprintf("%d", now)}).Result()
				if err != nil {
					log.Printf("[IDLE] Failed to fetch idle warnings: %v", err)
				} else {
					for _, m := range members {
						// Attempt to remove (race-safe)
						if removed, _ := rdb.ZRem(ctx, "idle_warning", m).Result(); removed > 0 {
							// check last_active
							last, _ := rdb.Get(ctx, "last_active:"+m).Result()
							lastTs, _ := strconv.ParseInt(last, 10, 64)
							if time.Now().Unix()-lastTs >= int64(cfg.IdleWarningSeconds) {
								// publish warning
								gameToken, playerID := parseMember(m)
								if gameToken == "" || playerID == "" {
									continue
								}
								// Resolve game - only warn if game is in progress and it's player's turn
								if g, err := Manager.GetGameByToken(gameToken); err == nil {
									if g.Status != StatusInProgress || g.CurrentTurn != playerID {
										log.Printf("[IDLE] skipping warning for player %s in game %s (status=%s currentTurn=%s)", playerID, gameToken, g.Status, g.CurrentTurn)
										continue
									}
									// forfeitAt should be computed from the player's last active time (lastTs) + IdleForfeitSeconds
									forfeitAt := time.Unix(lastTs, 0).Add(time.Duration(cfg.IdleForfeitSeconds) * time.Second)
									remaining := int(time.Until(forfeitAt).Seconds())
									// resolve game ID if possible
									gameID := g.ID
									payload := map[string]interface{}{"type": "player_idle_warning", "game_token": gameToken, "game_id": gameID, "player": playerID, "forfeit_at": forfeitAt.Format(time.RFC3339), "remaining_seconds": remaining, "message": "Player idle; will forfeit soon."}
									b, _ := json.Marshal(payload)
									if n, err := rdb.Publish(ctx, "idle_events", b).Result(); err != nil {
										log.Printf("[IDLE] publish warning failed: game=%s player=%s err=%v", gameToken, playerID, err)
									} else {
										log.Printf("[IDLE] published warning: game=%s player=%s subscribers=%d remaining=%d forfeit_at=%s", gameToken, playerID, n, remaining, forfeitAt.Format(time.RFC3339))
									}
								}
							}
						}
					}
				}

				// Process forfeits
				membersF, err := rdb.ZRangeByScore(ctx, "idle_forfeit", &redis.ZRangeBy{Min: "-inf", Max: fmt.Sprintf("%d", now)}).Result()
				if err != nil {
					log.Printf("[IDLE] Failed to fetch idle forfeits: %v", err)
				} else {
					for _, m := range membersF {
						if removed, _ := rdb.ZRem(ctx, "idle_forfeit", m).Result(); removed > 0 {
							last, _ := rdb.Get(ctx, "last_active:"+m).Result()
							lastTs, _ := strconv.ParseInt(last, 10, 64)
							if time.Now().Unix()-lastTs >= int64(cfg.IdleForfeitSeconds) {
								// parse member
								gameToken, playerID := parseMember(m)
								if gameToken == "" || playerID == "" {
									continue
								}
								// Attempt to load game and forfeit
								if g, err := Manager.GetGameByToken(gameToken); err == nil {
									// Only forfeit if game is in progress and it's the player's turn
									if g.Status != StatusInProgress || g.CurrentTurn != playerID {
										log.Printf("[IDLE] skipping forfeit for player %s in game %s (status=%s currentTurn=%s)", playerID, gameToken, g.Status, g.CurrentTurn)
										continue
									}
									log.Printf("[IDLE] Forfeiting player %s in game %s due to inactivity", playerID, gameToken)
									// Forfeit the game (this persists and triggers payout logic)
									g.ForfeitByDisconnect(playerID)
									// publish event that forfeit happened and include final states
									p1State := g.GetGameStateForPlayer(g.Player1.ID)
									p2State := g.GetGameStateForPlayer(g.Player2.ID)
									payload := map[string]interface{}{"type": "player_forfeit", "game_token": gameToken, "game_id": g.ID, "player": playerID, "message": "Player forfeited due to inactivity", "player1_state": p1State, "player2_state": p2State, "winner": g.Winner}
									b, _ := json.Marshal(payload)
									if n, err := rdb.Publish(ctx, "idle_events", b).Result(); err != nil {
										log.Printf("[IDLE] publish forfeit failed: game=%s player=%s err=%v", gameToken, playerID, err)
									} else {
										log.Printf("[IDLE] published forfeit: game=%s player=%s subscribers=%d winner=%s", gameToken, playerID, n, g.Winner)
									}
								}
							}
						}
					}
				}
			}
		}
	}()
}

// parseMember expects member format g:<gameToken>:p:<playerID>
func parseMember(m string) (string, string) {
	// naive split
	parts := strings.Split(m, ":")
	if len(parts) >= 4 && parts[0] == "g" && parts[2] == "p" {
		return parts[1], parts[3]
	}
	return "", ""
}
