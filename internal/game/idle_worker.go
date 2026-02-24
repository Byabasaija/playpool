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

	// purge any stray idle_forfeit entries once at startup
	if err := rdb.Del(context.Background(), "idle_forfeit").Err(); err != nil {
		log.Printf("[IDLE] failed to delete idle_forfeit key: %v", err)
	}

	log.Println("[IDLE] Idle worker started (forfeit set cleared)")
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
									// compute forfeitAt for warning payload
									forfeitAt := time.Unix(lastTs, 0).Add(time.Duration(cfg.IdleForfeitSeconds) * time.Second)
									remaining := int(time.Until(forfeitAt).Seconds())
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

				// ensure idle_forfeit remains empty
				if err := rdb.Del(ctx, "idle_forfeit").Err(); err != nil {
					log.Printf("[IDLE] failed to purge idle_forfeit during tick: %v", err)
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
