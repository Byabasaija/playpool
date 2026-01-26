package ws

import (
	"context"
	"encoding/json"
	"log"

	"github.com/playmatatu/backend/internal/config"
	"github.com/redis/go-redis/v9"
)

var rdbClient *redis.Client
var wsConfig *config.Config

func SetRedisClient(r *redis.Client, cfg *config.Config) {
	rdbClient = r
	wsConfig = cfg
}

// StartIdleEventSubscriber subscribes to the idle_events channel and broadcasts incoming events to games
func StartIdleEventSubscriber(ctx context.Context) {
	if rdbClient == nil {
		log.Println("[WS] Redis client not set; idle event subscriber not started")
		return
	}

	pubsub := rdbClient.Subscribe(ctx, "idle_events", "game_events")
	ch := pubsub.Channel()
	go func() {
		log.Println("[WS] idle_events/game_events subscriber started")
		for msg := range ch {
			log.Printf("[WS] event raw payload: %s", msg.Payload)
			var payload map[string]interface{}
			if err := json.Unmarshal([]byte(msg.Payload), &payload); err != nil {
				log.Printf("[WS] invalid event payload: %v", err)
				continue
			}

			// Expected payload types: player_idle_warning, player_forfeit, game_draw, session_cancelled
			typeStr, _ := payload["type"].(string)
			gameToken, _ := payload["game_token"].(string)
			gameID, _ := payload["game_id"].(string)
			if gameID == "" {
				gameID = gameToken
			}

			log.Printf("[WS] event received: type=%s game_id=%s", typeStr, gameID)

			switch typeStr {
			case "player_idle_warning":
				// Broadcast a warning message to the game room
				msg := map[string]interface{}{
					"type":       "player_idle_warning",
					"message":    payload["message"],
					"player":     payload["player"],
					"forfeit_at": payload["forfeit_at"],
				}
				// log room size before broadcasting
				GameHub.mu.RLock()
				if room, exists := GameHub.gameRooms[gameID]; !exists {
					log.Printf("[WS] no room for game %s; warning will not be broadcast", gameID)
				} else {
					log.Printf("[WS] broadcasting idle warning to game %s (room_size=%d)", gameID, len(room))
				}
				GameHub.mu.RUnlock()
				GameHub.BroadcastToGame(gameID, msg)

			case "player_forfeit":
				// If final states are included, send personalized states to each player
				if p1, ok := payload["player1_state"].(map[string]interface{}); ok {
					if pid, ok := p1["my_id"].(string); ok {
						p1["type"] = "game_state"
						// Log whether player has a connected client before sending
						GameHub.mu.RLock()
						if _, exists := GameHub.clients[pid]; !exists {
							log.Printf("[WS] no client connected for player %s (player1_state) - cannot send personalized state", pid)
						}
						GameHub.mu.RUnlock()
						GameHub.SendToPlayer(pid, p1)
					}
				} else {
					log.Printf("[WS] player1_state missing or invalid in payload for game %s", gameID)
				}
				if p2, ok := payload["player2_state"].(map[string]interface{}); ok {
					if pid, ok := p2["my_id"].(string); ok {
						p2["type"] = "game_state"
						GameHub.mu.RLock()
						if _, exists := GameHub.clients[pid]; !exists {
							log.Printf("[WS] no client connected for player %s (player2_state) - cannot send personalized state", pid)
						}
						GameHub.mu.RUnlock()
						GameHub.SendToPlayer(pid, p2)
					}
				} else {
					log.Printf("[WS] player2_state missing or invalid in payload for game %s", gameID)
				}

				// Broadcast a short game_over message
				msg := map[string]interface{}{
					"type":    "game_over",
					"message": payload["message"],
					"winner":  payload["winner"],
				}
				GameHub.mu.RLock()
				if room, exists := GameHub.gameRooms[gameID]; !exists {
					log.Printf("[WS] no room for game %s; game_over will not be broadcast", gameID)
				} else {
					log.Printf("[WS] broadcasting game_over for game %s (room_size=%d)", gameID, len(room))
				}
				GameHub.mu.RUnlock()
				GameHub.BroadcastToGame(gameID, msg)

			case "game_draw":
				// Mirror player_forfeit handling to send personalized final states and broadcast game_over
				if p1, ok := payload["player1_state"].(map[string]interface{}); ok {
					if pid, ok := p1["my_id"].(string); ok {
						p1["type"] = "game_state"
						GameHub.mu.RLock()
						if _, exists := GameHub.clients[pid]; !exists {
							log.Printf("[WS] no client connected for player %s (player1_state) - cannot send personalized state", pid)
						}
						GameHub.mu.RUnlock()
						GameHub.SendToPlayer(pid, p1)
					}
				} else {
					log.Printf("[WS] player1_state missing or invalid in game_draw payload for game %s", gameID)
				}
				if p2, ok := payload["player2_state"].(map[string]interface{}); ok {
					if pid, ok := p2["my_id"].(string); ok {
						p2["type"] = "game_state"
						GameHub.mu.RLock()
						if _, exists := GameHub.clients[pid]; !exists {
							log.Printf("[WS] no client connected for player %s (player2_state) - cannot send personalized state", pid)
						}
						GameHub.mu.RUnlock()
						GameHub.SendToPlayer(pid, p2)
					}
				} else {
					log.Printf("[WS] player2_state missing or invalid in game_draw payload for game %s", gameID)
				}

				// Broadcast a short game_over message
				msg := map[string]interface{}{
					"type":    "game_over",
					"message": payload["message"],
					"winner":  nil,
				}
				GameHub.mu.RLock()
				if room, exists := GameHub.gameRooms[gameID]; !exists {
					log.Printf("[WS] no room for game %s; game_over will not be broadcast", gameID)
				} else {
					log.Printf("[WS] broadcasting game_over (draw) for game %s (room_size=%d)", gameID, len(room))
				}
				GameHub.mu.RUnlock()
				GameHub.BroadcastToGame(gameID, msg)

			case "session_cancelled":
				// Send personalized states and broadcast a session_cancelled message
				if p1, ok := payload["player1_state"].(map[string]interface{}); ok {
					if pid, ok := p1["my_id"].(string); ok {
						p1["type"] = "game_state"
						GameHub.mu.RLock()
						if _, exists := GameHub.clients[pid]; !exists {
							log.Printf("[WS] no client connected for player %s (player1_state) - cannot send personalized state", pid)
						}
						GameHub.mu.RUnlock()
						GameHub.SendToPlayer(pid, p1)
					}
				} else {
					log.Printf("[WS] player1_state missing or invalid in session_cancelled payload for game %s", gameID)
				}
				if p2, ok := payload["player2_state"].(map[string]interface{}); ok {
					if pid, ok := p2["my_id"].(string); ok {
						p2["type"] = "game_state"
						GameHub.mu.RLock()
						if _, exists := GameHub.clients[pid]; !exists {
							log.Printf("[WS] no client connected for player %s (player2_state) - cannot send personalized state", pid)
						}
						GameHub.mu.RUnlock()
						GameHub.SendToPlayer(pid, p2)
					}
				} else {
					log.Printf("[WS] player2_state missing or invalid in session_cancelled payload for game %s", gameID)
				}

				msg := map[string]interface{}{
					"type":    "session_cancelled",
					"message": payload["message"],
				}
				GameHub.mu.RLock()
				if room, exists := GameHub.gameRooms[gameID]; !exists {
					log.Printf("[WS] no room for game %s; session_cancelled will not be broadcast", gameID)
				} else {
					log.Printf("[WS] broadcasting session_cancelled for game %s (room_size=%d)", gameID, len(room))
				}
				GameHub.mu.RUnlock()
				GameHub.BroadcastToGame(gameID, msg)

			case "player_idle_canceled":
				log.Printf("[WS] idle_event player_idle_canceled received for game %s", gameID)
				// nothing else to do - WS handler will have already handled broadcasted cancel
				break

			default:
				log.Printf("[WS] unknown event type: %s", typeStr)
			}
		}
	}()
}
