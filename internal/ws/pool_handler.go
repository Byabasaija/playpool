package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/playpool/backend/internal/game"
	"github.com/redis/go-redis/v9"
)

// Pool-specific message data types
type TakeShotData struct {
	Angle   float64 `json:"angle"`
	Power   float64 `json:"power"`
	Screw   float64 `json:"screw"`
	English float64 `json:"english"`
}

type PlaceCueBallData struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// GameHub is the single hub for all games.
var GameHub *Hub

func init() {
	GameHub = NewHub()
	go runGameHub(GameHub)
}

// HandleWebSocket handles WebSocket connections for pool games.
func HandleWebSocket(c *gin.Context) {
	gameToken := c.Query("token")
	playerToken := c.Query("pt")

	if gameToken == "" || playerToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token and pt required"})
		return
	}

	g, err := game.Manager.GetGameByToken(gameToken)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}

	var playerID string
	if g.Player1.PlayerToken == playerToken {
		playerID = g.Player1.ID
	} else if g.Player2.PlayerToken == playerToken {
		playerID = g.Player2.ID
	} else {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid player token"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[WS] Upgrade error: %v", err)
		return
	}

	client := &Client{
		conn:       conn,
		playerID:   playerID,
		opponentID: g.GetOpponentID(playerID),
		gameID:     g.ID,
		gameToken:  gameToken,
		send:       make(chan []byte, 256),
	}

	GameHub.register <- client

	go client.writePump()
	go client.readPump()
}

// runGameHub runs the game hub with pool-specific game logic.
func runGameHub(h *Hub) {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()

			isReconnect := false
			if oldClient, exists := h.clients[client.playerID]; exists {
				log.Printf("[WS] Player %s reconnecting - closing old connection", client.playerID)
				if err := oldClient.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "replaced by new connection"), time.Now().Add(5*time.Second)); err != nil {
					log.Printf("Error writing close control to old client %s: %v", oldClient.playerID, err)
				}
				oldClient.conn.Close()
				select {
				case <-oldClient.send:
				default:
					close(oldClient.send)
				}
				delete(h.clients, client.playerID)
				if room, exists := h.gameRooms[oldClient.gameID]; exists {
					delete(room, client.playerID)
				}
				isReconnect = true
			}

			h.clients[client.playerID] = client
			if _, exists := h.gameRooms[client.gameID]; !exists {
				h.gameRooms[client.gameID] = make(map[string]*Client)
			}
			h.gameRooms[client.gameID][client.playerID] = client
			h.mu.Unlock()

			log.Printf("[WS] Player %s connected to game %s", client.playerID, client.gameID)

			g, err := game.Manager.GetGameByToken(client.gameToken)
			if err != nil {
				log.Printf("[WS] Game not found for token %s: %v", client.gameToken, err)
				continue
			}

			client.opponentID = g.GetOpponentID(client.playerID)
			g.SetPlayerConnected(client.playerID, true)
			g.MarkPlayerShowedUp(client.playerID)

			if g.Status == game.StatusWaiting && g.BothPlayersConnected() {
				log.Printf("Both players connected - scheduling initialization of game %s", g.ID)

				go func(gRef *game.PoolGameState) {
					time.Sleep(150 * time.Millisecond)
					if gRef.Status != game.StatusWaiting || !gRef.BothPlayersConnected() {
						return
					}
					if err := gRef.Initialize(); err != nil {
						log.Printf("[WS] Init failed: %v", err)
						return
					}

					if gRef.SessionID > 0 && game.Manager != nil && gRef.StartedAt != nil {
						if err := game.Manager.MarkSessionStarted(gRef.SessionID, *gRef.StartedAt); err != nil {
							log.Printf("[DB] MarkSessionStarted failed for session %d: %v", gRef.SessionID, err)
						}
					}

					h.BroadcastToGame(client.gameID, map[string]interface{}{
						"type":    "game_starting",
						"message": "Both players connected! Break shot...",
					})

					p1State := gRef.GetGameStateForPlayer(gRef.Player1.ID)
					p1State["type"] = "game_state"
					p2State := gRef.GetGameStateForPlayer(gRef.Player2.ID)
					p2State["type"] = "game_state"
					h.SendToPlayer(gRef.Player1.ID, p1State)
					h.SendToPlayer(gRef.Player2.ID, p2State)
				}(g)
			} else if g.Status == game.StatusWaiting {
				h.SendToPlayer(client.playerID, map[string]interface{}{
					"type":    "waiting_for_opponent",
					"message": "Waiting for opponent...",
				})
			} else {
				state := g.GetGameStateForPlayer(client.playerID)
				state["type"] = "game_state"
				h.SendToPlayer(client.playerID, state)

				oppID := g.GetOpponentID(client.playerID)
				if oppID != "" {
					oppState := g.GetGameStateForPlayer(oppID)
					oppState["type"] = "game_state"
					h.SendToPlayer(oppID, oppState)
				}
			}

			if isReconnect && g.Status == game.StatusInProgress {
				h.BroadcastToGame(client.gameID, map[string]interface{}{
					"type":    "player_connected",
					"player":  client.playerID,
					"message": "Opponent connected",
				})
			}

		case client := <-h.unregister:
			h.mu.Lock()
			if cur, ok := h.clients[client.playerID]; ok && cur == client {
				delete(h.clients, client.playerID)
				if room, exists := h.gameRooms[client.gameID]; exists {
					delete(room, client.playerID)
					if len(room) == 0 {
						delete(h.gameRooms, client.gameID)
					}
				}

				log.Printf("[WS] Player %s disconnected from game %s", client.playerID, client.gameID)

				if g, err := game.Manager.GetGameByToken(client.gameToken); err == nil {
					g.SetPlayerDisconnected(client.playerID)
					if g.Status == game.StatusInProgress {
						go func(token, gameID, playerID string) {
							time.Sleep(500 * time.Millisecond)
							if g2, err := game.Manager.GetGameByToken(token); err == nil {
								if p := g2.GetPlayerByID(playerID); p != nil && !p.Connected && p.DisconnectedAt != nil && time.Since(*p.DisconnectedAt) >= 500*time.Millisecond {
									graceSeconds := game.Manager.GetConfig().DisconnectGraceSeconds
									h.BroadcastToGame(gameID, map[string]interface{}{
										"type":            "player_disconnected",
										"player":          playerID,
										"grace_seconds":   graceSeconds,
										"disconnected_at": p.DisconnectedAt.Unix(),
										"message":         fmt.Sprintf("Opponent disconnected. Waiting %d seconds...", graceSeconds),
									})
								}
							}
						}(client.gameToken, client.gameID, client.playerID)
					}
				}

				select {
				case <-client.send:
				default:
					close(client.send)
				}
			}
			h.mu.Unlock()
		}
	}
}

// readPump reads messages for pool games.
func (c *Client) readPump() {
	defer func() {
		GameHub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(65536)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error (unexpected) for player %s: %v", c.playerID, err)
			} else {
				log.Printf("WebSocket read error for player %s: %v", c.playerID, err)
			}
			break
		}

		// Update idle tracking in Redis
		if rdbClient != nil && wsConfig != nil {
			ctx := context.Background()
			member := fmt.Sprintf("g:%s:p:%s", c.gameToken, c.playerID)
			now := time.Now().Unix()

			shouldTrackIdle := true
			if c.opponentID != "" {
				GameHub.mu.RLock()
				opponentClient, opponentConnected := GameHub.clients[c.opponentID]
				GameHub.mu.RUnlock()

				if !opponentConnected || opponentClient == nil || opponentClient.gameID != c.gameID {
					shouldTrackIdle = false
				}
			}

			if shouldTrackIdle {
				rdbClient.Set(ctx, "last_active:"+member, fmt.Sprintf("%d", now), 0)
				rdbClient.ZAdd(ctx, "idle_warning", redis.Z{Score: float64(now + int64(wsConfig.IdleWarningSeconds)), Member: member})
				rdbClient.ZAdd(ctx, "idle_forfeit", redis.Z{Score: float64(now + int64(wsConfig.IdleForfeitSeconds)), Member: member})
			}
		}

		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		c.handleMessage(msg)
	}
}

// handleMessage processes incoming pool game messages.
func (c *Client) handleMessage(msg WSMessage) {
	g, err := game.Manager.GetGameByToken(c.gameToken)
	if err != nil {
		c.sendError("Game not found")
		return
	}

	switch msg.Type {
	case "take_shot":
		var data TakeShotData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			c.sendError("Invalid shot data")
			return
		}
		c.handleTakeShot(g, data)

	case "place_cue_ball":
		var data PlaceCueBallData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			c.sendError("Invalid placement data")
			return
		}
		c.handlePlaceCueBall(g, data)

	case "get_state":
		state := g.GetGameStateForPlayer(c.playerID)
		state["type"] = "game_state"
		d, _ := json.Marshal(state)
		c.send <- d

	case "concede":
		c.handleConcede(g)

	default:
		c.sendError("Unknown message type")
	}
}

// handleTakeShot processes a take_shot message.
func (c *Client) handleTakeShot(g *game.PoolGameState, data TakeShotData) {
	params := game.ShotParams{
		Angle:   data.Angle,
		Power:   data.Power,
		Screw:   data.Screw,
		English: data.English,
	}

	// Relay shot params to opponent immediately (before physics simulation)
	// so they can start client-side animation while server computes the result
	GameHub.SendToPlayer(c.opponentID, map[string]interface{}{
		"type":        "shot_relay",
		"player":      c.playerID,
		"shot_params": params,
	})

	result, err := g.TakeShot(c.playerID, params)
	if err != nil {
		c.sendError(err.Error())
		return
	}

	// Broadcast shot result to both players
	GameHub.BroadcastToGame(c.gameID, map[string]interface{}{
		"type":           "shot_result",
		"player":         c.playerID,
		"shot_params":    result.ShotParams,
		"ball_positions": result.BallPositions,
		"pocketed_balls": result.PocketedBalls,
		"foul":           result.Foul,
		"group_assigned": result.GroupAssigned,
		"player1_group":  result.Player1Group,
		"player2_group":  result.Player2Group,
		"turn_change":    result.TurnChange,
		"next_turn":      result.NextTurn,
		"ball_in_hand":   result.BallInHand,
		"game_over":      result.GameOver,
		"winner":         result.Winner,
		"win_type":       result.WinType,
	})

	// Reset idle timers for both players
	resetIdleTimersForGame(c.gameToken, g.Player1.ID, g.Player2.ID)
	GameHub.BroadcastToGame(c.gameID, map[string]interface{}{"type": "player_idle_canceled", "player": c.playerID})

	// Send updated game state to each player
	c.broadcastGameState(g)

	// Save to Redis
	g.SaveToRedis()
}

// handlePlaceCueBall processes cue ball placement.
func (c *Client) handlePlaceCueBall(g *game.PoolGameState, data PlaceCueBallData) {
	if err := g.PlaceCueBall(c.playerID, data.X, data.Y); err != nil {
		c.sendError(err.Error())
		return
	}

	GameHub.BroadcastToGame(c.gameID, map[string]interface{}{
		"type": "ball_placed",
		"x":    data.X,
		"y":    data.Y,
	})

	c.broadcastGameState(g)
	g.SaveToRedis()
}

// handleConcede processes a concede in a pool game.
func (c *Client) handleConcede(g *game.PoolGameState) {
	if g.Status != game.StatusInProgress {
		c.sendError("Game is not in progress")
		return
	}

	g.ForfeitByConcede(c.playerID)

	GameHub.BroadcastToGame(c.gameID, map[string]interface{}{
		"type":    "player_conceded",
		"player":  c.playerID,
		"message": "Player conceded",
	})

	c.broadcastGameState(g)
}

// broadcastGameState sends personalized state to each player.
func (c *Client) broadcastGameState(g *game.PoolGameState) {
	if g.Player1 != nil {
		state := g.GetGameStateForPlayer(g.Player1.ID)
		state["type"] = "game_update"
		GameHub.SendToPlayer(g.Player1.ID, state)
	}
	if g.Player2 != nil {
		state := g.GetGameStateForPlayer(g.Player2.ID)
		state["type"] = "game_update"
		GameHub.SendToPlayer(g.Player2.ID, state)
	}
}
