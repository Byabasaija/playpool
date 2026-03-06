package ws

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/playpool/backend/internal/game"
)

// Pool-specific message data types
type TakeShotData struct {
	Angle   float64 `json:"angle"`
	Power   float64 `json:"power"`
	Screw   float64 `json:"screw"`
	English float64 `json:"english"`
	// Balls is the shooter's physics state at the moment of firing.
	// The server relays it unchanged in shot_relay so the opponent can seed
	// their PhysicsEngine from the exact same starting state, preventing divergence.
	Balls []game.BallState `json:"balls"`
}

type PlaceCueBallData struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// ShotCompleteData is sent by the shooting client after its physics animation finishes.
type ShotCompleteData struct {
	PocketedBalls       []int `json:"pocketed_balls"`
	FirstContactBallID  int   `json:"first_contact_ball_id"`
	CushionAfterContact bool  `json:"cushion_after_contact"`
	BreakCushionCount   int   `json:"break_cushion_count"`
}

// CueAimData carries the shooter's current aim angle and normalised power (0–1)
// for real-time opponent ghost-cue rendering. The server only relays it.
type CueAimData struct {
	Angle float64 `json:"angle"`
	Power float64 `json:"power"`
}

// SyncResponseData is sent by the connected opponent to relay their live physics
// state to a reconnecting player. The server simply forwards it without storing
// ball positions — the server never owns X/Y state in the deterministic model.
type SyncResponseData struct {
	Target string           `json:"target"`
	Balls  []game.BallState `json:"balls"`
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

			if oldClient, exists := h.clients[client.playerID]; exists {
				log.Printf("[WS] Player %s reconnecting - closing old connection", client.playerID)
				if err := oldClient.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "replaced by new connection"), time.Now().Add(5*time.Second)); err != nil {
					log.Printf("Error writing close control to old client %s: %v", oldClient.playerID, err)
				}
				oldClient.conn.Close()
				oldClient.disconnect()
				delete(h.clients, client.playerID)
				if room, exists := h.gameRooms[oldClient.gameID]; exists {
					delete(room, client.playerID)
				}
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
						"breaker": gRef.CurrentTurn,
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
				// Reconnect: game already in progress.
				// Send game logic state (no ball positions) — the server never stores
				// X/Y positions; the client physics engine owns those.
				state := g.GetGameStateForPlayer(client.playerID)
				delete(state, "balls")
				state["type"] = "game_state"
				h.SendToPlayer(client.playerID, state)

				// Ask the connected opponent to relay their live physics state.
				// The opponent responds with sync_response which the server
				// forwards directly to the reconnecting player.
				oppID := g.GetOpponentID(client.playerID)
				if oppID != "" {
					h.SendToPlayer(oppID, map[string]interface{}{
						"type":   "sync_request",
						"target": client.playerID,
					})
				} else {
					log.Printf("[WS] Reconnect: opponent not connected for player %s — physics state unavailable", client.playerID)
				}
			}

			// Broadcast player_connected whenever the game is in progress.
			// This covers both replacing a live connection (isReconnect) and
			// reconnecting after the old socket was already cleaned up (reload).
			if g.Status == game.StatusInProgress {
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
						// If this player disconnected mid-shot, auto-resolve it so the
						// game doesn't freeze. Treat it as a turn timeout: opponent gets
						// ball-in-hand. The grace-period forfeit below still applies.
						if resolved, nextTurn, shotNum := g.ResolveStuckShot(client.playerID); resolved {
							g.SaveToRedis()
							h.BroadcastToGame(client.gameID, map[string]interface{}{
								"type":           "shot_result",
								"player":         client.playerID,
								"shot_number":    shotNum,
								"pocketed_balls": []int{},
								"foul":           map[string]interface{}{"type": "disconnect", "message": "Shooter disconnected"},
								"turn_change":    true,
								"next_turn":      nextTurn,
								"ball_in_hand":   true,
								"game_over":      false,
							})
							// Send no-balls game_update so clients apply the new turn/ball-in-hand
							for _, pid := range []string{g.Player1.ID, g.Player2.ID} {
								state := g.GetGameStateForPlayer(pid)
								delete(state, "balls")
								state["type"] = "game_update"
								h.SendToPlayer(pid, state)
							}
						}

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

				client.disconnect()
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

	case "shot_complete":
		var data ShotCompleteData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			c.sendError("Invalid shot complete data")
			return
		}
		c.handleShotComplete(g, data)

	case "cue_ball_move":
		// Shooter is dragging the cue ball during ball-in-hand — relay their
		// current position to the opponent in real-time so they see the ghost
		// ball moving. No game logic runs; this is a pure pass-through relay.
		var data PlaceCueBallData // reuses {X, Y float64} — same shape
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			c.sendError("Invalid cue_ball_move data")
			return
		}
		GameHub.SendToPlayer(c.opponentID, map[string]interface{}{
			"type": "cue_ball_move",
			"x":    data.X,
			"y":    data.Y,
		})

	case "cue_aim":
		// Shooter is aiming — relay their current angle and normalised power to the
		// opponent so they can render a ghost cue. No game logic runs; pure relay.
		var data CueAimData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			c.sendError("Invalid cue_aim data")
			return
		}
		GameHub.SendToPlayer(c.opponentID, map[string]interface{}{
			"type":      "cue_aim",
			"aim_angle": data.Angle,
			"aim_power": data.Power,
		})

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

	case "turn_timeout":
		log.Printf("[WS] turn_timeout message from player %s", c.playerID)
		c.handleTurnTimeout(g)

	case "sync_response":
		// The connected opponent is relaying their live physics state to a
		// reconnecting player. Forward it directly without server-side storage.
		var data SyncResponseData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			c.sendError("Invalid sync response data")
			return
		}
		if data.Target == "" {
			c.sendError("sync_response missing target")
			return
		}
		GameHub.SendToPlayer(data.Target, map[string]interface{}{
			"type":  "sync_response",
			"balls": data.Balls,
		})
		log.Printf("[WS] sync_response forwarded from player %s to player %s (%d balls)", c.playerID, data.Target, len(data.Balls))

	default:
		c.sendError("Unknown message type")
	}
}

// handleTakeShot validates the shot and relays it to the opponent.
// The server no longer runs physics — it waits for shot_complete from the shooting client.
func (c *Client) handleTakeShot(g *game.PoolGameState, data TakeShotData) {
	params := game.ShotParams{
		Angle:   data.Angle,
		Power:   data.Power,
		Screw:   data.Screw,
		English: data.English,
	}

	if err := g.ValidateCanShoot(c.playerID, params); err != nil {
		c.sendError(err.Error())
		return
	}

	g.SetShotInProgress(c.playerID, params)

	// Relay shot params AND the shooter's ball snapshot to the opponent.
	// The opponent seeds their PhysicsEngine from this snapshot instead of their
	// own local state, guaranteeing both clients run from identical starting positions.
	GameHub.SendToPlayer(c.opponentID, map[string]interface{}{
		"type":        "shot_relay",
		"player":      c.playerID,
		"shot_params": params,
		"balls":       data.Balls,
	})
}

// handleShotComplete processes the shot_complete message from the shooting client.
func (c *Client) handleShotComplete(g *game.PoolGameState, data ShotCompleteData) {
	clientData := game.ClientShotData{
		PocketedBalls:       data.PocketedBalls,
		FirstContactBallID:  data.FirstContactBallID,
		CushionAfterContact: data.CushionAfterContact,
		BreakCushionCount:   data.BreakCushionCount,
	}

	result, err := g.ApplyShotResult(c.playerID, clientData)
	if err != nil {
		c.sendError(err.Error())
		return
	}
	log.Printf("[WS] shot_complete result: %+v, g.BallInHand=%v, g.BallInHandPlayer=%s", result, g.BallInHand, g.BallInHandPlayer)

	// Broadcast shot result to both players.
	// shot_number matches the game_update that follows — clients use it to
	// skip ball positions on that specific update (ordering-safe skip).
	GameHub.BroadcastToGame(c.gameID, map[string]interface{}{
		"type":           "shot_result",
		"player":         c.playerID,
		"shot_number":    g.ShotNumber,
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

// handleTurnTimeout processes a shot clock expiry — switches turn and gives opponent ball-in-hand.
func (c *Client) handleTurnTimeout(g *game.PoolGameState) {
	if err := g.TurnTimeout(c.playerID); err != nil {
		log.Printf("[WS] TurnTimeout error for player %s: %v", c.playerID, err)
		c.sendError(err.Error())
		return
	}

	g.SaveToRedis()
	c.broadcastGameState(g)
}

// broadcastGameState sends personalized game logic state to each player.
// Ball positions are intentionally omitted — clients own their positions via
// deterministic physics. Full ball positions are only sent in game_state
// messages (on connect / reconnect) so the client can seed its physics engine.
func (c *Client) broadcastGameState(g *game.PoolGameState) {
	if g.Player1 != nil {
		state := g.GetGameStateForPlayer(g.Player1.ID)
		delete(state, "balls")
		state["type"] = "game_update"
		GameHub.SendToPlayer(g.Player1.ID, state)
	}
	if g.Player2 != nil {
		state := g.GetGameStateForPlayer(g.Player2.ID)
		delete(state, "balls")
		state["type"] = "game_update"
		GameHub.SendToPlayer(g.Player2.ID, state)
	}
}
