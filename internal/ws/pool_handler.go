package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/playpool/backend/internal/game"
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

// HandlePoolWebSocket handles WebSocket connections for pool games.
func HandlePoolWebSocket(c *gin.Context) {
	gameToken := c.Query("token")
	playerToken := c.Query("pt")

	if gameToken == "" || playerToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token and pt required"})
		return
	}

	g, err := game.Manager.GetPoolGameByToken(gameToken)
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
		log.Printf("[WS/Pool] Upgrade error: %v", err)
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

	// Use the same Hub infrastructure
	PoolHub.register <- client

	go client.writePump()
	go client.readPoolPump()
}

// PoolHub is a separate hub for pool games, using the same Hub type.
var PoolHub *Hub

func init() {
	PoolHub = NewHub()
	go runPoolHub(PoolHub)
}

// runPoolHub runs the pool hub with pool-specific game logic.
func runPoolHub(h *Hub) {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()

			isReconnect := false
			if oldClient, exists := h.clients[client.playerID]; exists {
				log.Printf("[Pool] Player %s reconnecting", client.playerID)
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

			log.Printf("[Pool] Player %s connected to game %s", client.playerID, client.gameID)

			g, err := game.Manager.GetPoolGameByToken(client.gameToken)
			if err != nil {
				log.Printf("[Pool] Game not found for token %s: %v", client.gameToken, err)
				continue
			}

			client.opponentID = g.GetOpponentID(client.playerID)
			g.SetPlayerConnected(client.playerID, true)
			g.MarkPlayerShowedUp(client.playerID)

			if g.Status == game.StatusWaiting && g.BothPlayersConnected() {
				go func(gRef *game.PoolGameState) {
					time.Sleep(150 * time.Millisecond)
					if gRef.Status != game.StatusWaiting || !gRef.BothPlayersConnected() {
						return
					}
					if err := gRef.Initialize(); err != nil {
						log.Printf("[Pool] Init failed: %v", err)
						return
					}

					if gRef.SessionID > 0 && game.Manager != nil && gRef.StartedAt != nil {
						game.Manager.MarkSessionStarted(gRef.SessionID, *gRef.StartedAt)
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

				if g, err := game.Manager.GetPoolGameByToken(client.gameToken); err == nil {
					g.SetPlayerDisconnected(client.playerID)
					if g.Status == game.StatusInProgress {
						go func(token, gameID, playerID string) {
							time.Sleep(500 * time.Millisecond)
							if g2, err := game.Manager.GetPoolGameByToken(token); err == nil {
								if p := g2.GetPlayerByID(playerID); p != nil && !p.Connected && p.DisconnectedAt != nil && time.Since(*p.DisconnectedAt) >= 500*time.Millisecond {
									graceSeconds := game.Manager.GetConfig().DisconnectGraceSeconds
									h.BroadcastToGame(gameID, map[string]interface{}{
										"type":            "player_disconnected",
										"player":          playerID,
										"grace_seconds":   graceSeconds,
										"disconnected_at": p.DisconnectedAt.Unix(),
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

// readPoolPump reads messages for pool games.
func (c *Client) readPoolPump() {
	defer func() {
		PoolHub.unregister <- c
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
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		c.handlePoolMessage(msg)
	}
}

// handlePoolMessage processes incoming pool game messages.
func (c *Client) handlePoolMessage(msg WSMessage) {
	g, err := game.Manager.GetPoolGameByToken(c.gameToken)
	if err != nil {
		c.sendPoolError("Game not found")
		return
	}

	switch msg.Type {
	case "take_shot":
		var data TakeShotData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			c.sendPoolError("Invalid shot data")
			return
		}
		c.handleTakeShot(g, data)

	case "place_cue_ball":
		var data PlaceCueBallData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			c.sendPoolError("Invalid placement data")
			return
		}
		c.handlePlaceCueBall(g, data)

	case "get_state":
		state := g.GetGameStateForPlayer(c.playerID)
		state["type"] = "game_state"
		d, _ := json.Marshal(state)
		c.send <- d

	case "concede":
		c.handlePoolConcede(g)

	default:
		c.sendPoolError("Unknown message type")
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

	result, err := g.TakeShot(c.playerID, params)
	if err != nil {
		c.sendPoolError(err.Error())
		return
	}

	// Broadcast shot result to both players
	PoolHub.BroadcastToGame(c.gameID, map[string]interface{}{
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

	// Send updated game state to each player
	c.broadcastPoolGameState(g)

	// Save to Redis
	g.SaveToRedis()
}

// handlePlaceCueBall processes cue ball placement.
func (c *Client) handlePlaceCueBall(g *game.PoolGameState, data PlaceCueBallData) {
	if err := g.PlaceCueBall(c.playerID, data.X, data.Y); err != nil {
		c.sendPoolError(err.Error())
		return
	}

	PoolHub.BroadcastToGame(c.gameID, map[string]interface{}{
		"type": "ball_placed",
		"x":    data.X,
		"y":    data.Y,
	})

	c.broadcastPoolGameState(g)
	g.SaveToRedis()
}

// handlePoolConcede processes a concede in a pool game.
func (c *Client) handlePoolConcede(g *game.PoolGameState) {
	if g.Status != game.StatusInProgress {
		c.sendPoolError("Game is not in progress")
		return
	}

	g.ForfeitByConcede(c.playerID)

	PoolHub.BroadcastToGame(c.gameID, map[string]interface{}{
		"type":    "player_conceded",
		"player":  c.playerID,
		"message": "Player conceded",
	})

	c.broadcastPoolGameState(g)
}

// broadcastPoolGameState sends personalized state to each player.
func (c *Client) broadcastPoolGameState(g *game.PoolGameState) {
	if g.Player1 != nil {
		state := g.GetGameStateForPlayer(g.Player1.ID)
		state["type"] = "game_update"
		PoolHub.SendToPlayer(g.Player1.ID, state)
	}
	if g.Player2 != nil {
		state := g.GetGameStateForPlayer(g.Player2.ID)
		state["type"] = "game_update"
		PoolHub.SendToPlayer(g.Player2.ID, state)
	}
}

func (c *Client) sendPoolError(message string) {
	d, _ := json.Marshal(map[string]interface{}{
		"type":    "error",
		"message": message,
	})
	c.send <- d
}
