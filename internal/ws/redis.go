package ws

import (
	"context"
	"encoding/json"
	"log"

	"github.com/redis/go-redis/v9"
)

var rdbClient *redis.Client

func SetRedisClient(r *redis.Client) {
	rdbClient = r
}

// StartIdleEventSubscriber subscribes to the game_events channel and broadcasts incoming events to games
func StartIdleEventSubscriber(ctx context.Context) {
	if rdbClient == nil {
		log.Println("[WS] Redis client not set; game event subscriber not started")
		return
	}

	pubsub := rdbClient.Subscribe(ctx, "game_events")
	ch := pubsub.Channel()
	go func() {
		log.Println("[WS] game_events subscriber started")
		for msg := range ch {
			log.Printf("[WS] event raw payload: %s", msg.Payload)
			var payload map[string]interface{}
			if err := json.Unmarshal([]byte(msg.Payload), &payload); err != nil {
				log.Printf("[WS] invalid event payload: %v", err)
				continue
			}

			typeStr, _ := payload["type"].(string)
			gameToken, _ := payload["game_token"].(string)
			gameID, _ := payload["game_id"].(string)
			if gameID == "" {
				gameID = gameToken
			}

			log.Printf("[WS] event received: type=%s game_id=%s", typeStr, gameID)

			switch typeStr {
			case "game_draw":
				if p1, ok := payload["player1_state"].(map[string]interface{}); ok {
					if pid, ok := p1["my_id"].(string); ok {
						p1["type"] = "game_state"
						GameHub.SendToPlayer(pid, p1)
					}
				}
				if p2, ok := payload["player2_state"].(map[string]interface{}); ok {
					if pid, ok := p2["my_id"].(string); ok {
						p2["type"] = "game_state"
						GameHub.SendToPlayer(pid, p2)
					}
				}
				GameHub.BroadcastToGame(gameID, map[string]interface{}{
					"type":    "game_over",
					"message": payload["message"],
					"winner":  nil,
				})

			case "session_cancelled":
				if p1, ok := payload["player1_state"].(map[string]interface{}); ok {
					if pid, ok := p1["my_id"].(string); ok {
						p1["type"] = "game_state"
						GameHub.SendToPlayer(pid, p1)
					}
				}
				if p2, ok := payload["player2_state"].(map[string]interface{}); ok {
					if pid, ok := p2["my_id"].(string); ok {
						p2["type"] = "game_state"
						GameHub.SendToPlayer(pid, p2)
					}
				}
				GameHub.BroadcastToGame(gameID, map[string]interface{}{
					"type":    "session_cancelled",
					"message": payload["message"],
				})

			default:
				log.Printf("[WS] unknown event type: %s", typeStr)
			}
		}
	}()
}
