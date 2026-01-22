package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/playmatatu/backend/internal/game"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins in development
	},
}

// Client represents a connected WebSocket client
type Client struct {
	conn      *websocket.Conn
	playerID  string
	gameID    string
	gameToken string
	send      chan []byte
}

// Hub maintains the set of active clients
type Hub struct {
	clients    map[string]*Client            // playerID -> Client
	gameRooms  map[string]map[string]*Client // gameID -> playerID -> Client
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

var GameHub *Hub

func init() {
	GameHub = NewHub()
	go GameHub.Run()
}

// NewHub creates a new Hub
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		gameRooms:  make(map[string]map[string]*Client),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// Run starts the hub's main loop
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()

			// Check if this is a reconnect (player already has a connection)
			isReconnect := false
			if oldClient, exists := h.clients[client.playerID]; exists {
				// Attempt to close the old connection cleanly (send close control frame)
				log.Printf("Player %s reconnecting - closing old connection (explicit conn close)", client.playerID)
				if err := oldClient.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "replaced by new connection"), time.Now().Add(5*time.Second)); err != nil {
					log.Printf("Error writing close control to old client %s: %v", oldClient.playerID, err)
				}
				// Ensure connection is closed
				oldClient.conn.Close()

				// Close old send channel to free the writer goroutine
				select {
				case <-oldClient.send:
					// already closed
				default:
					close(oldClient.send)
				}

				delete(h.clients, client.playerID)
				if room, roomExists := h.gameRooms[oldClient.gameID]; roomExists {
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

			log.Printf("Player %s connected to game %s", client.playerID, client.gameID)

			// Mark player as connected and showed up in game
			if g, err := game.Manager.GetGameByToken(client.gameToken); err == nil {
				g.SetPlayerConnected(client.playerID, true)
				g.MarkPlayerShowedUp(client.playerID)

				// Check if both players are now connected AND game hasn't started yet
				if g.Status == game.StatusWaiting && g.BothPlayersConnected() {
					log.Printf("✓ Both players connected - initializing game %s", g.ID)

					if err := g.Initialize(); err != nil {
						log.Printf("❌ Init failed: %v", err)
						h.SendToPlayer(client.playerID, map[string]interface{}{
							"type":    "error",
							"message": "Failed to initialize game",
						})
					} else {
						// Persist session start if we have a DB session id
						if g.SessionID > 0 && game.Manager != nil {
							if g.StartedAt != nil {
								if err := game.Manager.MarkSessionStarted(g.SessionID, *g.StartedAt); err != nil {
									log.Printf("[DB] MarkSessionStarted failed for session %d: %v", g.SessionID, err)
								}
							}
						}

						// Broadcast game start
						h.BroadcastToGame(client.gameID, map[string]interface{}{
							"type":    "game_starting",
							"message": "Both players connected! Dealing cards...",
						})

						// Send game state to both players
						p1State := g.GetGameStateForPlayer(g.Player1.ID)
						p1State["type"] = "game_state"
						p2State := g.GetGameStateForPlayer(g.Player2.ID)
						p2State["type"] = "game_state"

						h.SendToPlayer(g.Player1.ID, p1State)
						h.SendToPlayer(g.Player2.ID, p2State)
					}
				} else if g.Status == game.StatusWaiting {
					// Still waiting for opponent - send waiting message
					h.SendToPlayer(client.playerID, map[string]interface{}{
						"type":    "waiting_for_opponent",
						"message": "Waiting for opponent to join...",
					})
				} else {
					// Game is already in progress - send current state
					currentState := g.GetGameStateForPlayer(client.playerID)
					currentState["type"] = "game_state"
					h.SendToPlayer(client.playerID, currentState)
				}

				// Notify opponent of reconnection (only if this was actually a reconnect)
				if isReconnect && g.Status == game.StatusInProgress {
					h.BroadcastToGame(client.gameID, map[string]interface{}{
						"type":    "player_connected",
						"player":  client.playerID,
						"message": "Opponent connected",
					})
				}
			} else {
				log.Printf("❌ Failed to get game by token %s for player %s: %v", client.gameToken, client.playerID, err)
			}

		case client := <-h.unregister:
			h.mu.Lock()
			// Only remove if this is the current client for this player
			// (Prevents new connection from being removed when old one closes)
			if currentClient, ok := h.clients[client.playerID]; ok && currentClient == client {
				delete(h.clients, client.playerID)
				if room, exists := h.gameRooms[client.gameID]; exists {
					delete(room, client.playerID)
					if len(room) == 0 {
						delete(h.gameRooms, client.gameID)
					}
				}

				log.Printf("Player %s disconnected from game %s", client.playerID, client.gameID)

				// Mark player as disconnected with timestamp
				if g, err := game.Manager.GetGameByToken(client.gameToken); err == nil {
					g.SetPlayerDisconnected(client.playerID)

					// Only notify if game is in progress
					if g.Status == game.StatusInProgress {
						h.BroadcastToGame(client.gameID, map[string]interface{}{
							"type":    "player_disconnected",
							"player":  client.playerID,
							"message": "Opponent disconnected. Waiting 2 minutes...",
						})
					}
				}
			}

			// Always close the send channel
			select {
			case <-client.send:
				// Channel already closed
			default:
				close(client.send)
			}

			h.mu.Unlock()
		}
	}
}

// BroadcastToGame sends a message to all players in a game
func (h *Hub) BroadcastToGame(gameID string, message interface{}) {
	data, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling message: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	if room, exists := h.gameRooms[gameID]; exists {
		for _, client := range room {
			select {
			case client.send <- data:
			default:
				// Client's buffer is full
				log.Printf("Client send buffer full for player %s in game %s, dropping message", client.playerID, gameID)
			}
		}
	}
}

// SendToPlayer sends a message to a specific player
func (h *Hub) SendToPlayer(playerID string, message interface{}) {
	data, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling message: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	if client, exists := h.clients[playerID]; exists {
		select {
		case client.send <- data:
		default:
		}
	}
}

// Message types
type WSMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type PlayCardData struct {
	Card         string `json:"card"`
	DeclaredSuit string `json:"declared_suit,omitempty"`
}

// HandleWebSocket handles WebSocket connections
func HandleWebSocket(c *gin.Context) {
	gameToken := c.Query("token")
	playerToken := c.Query("pt")

	if gameToken == "" || playerToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token and pt (player token) required"})
		return
	}

	log.Printf("[WS] New connection attempt - gameToken: %s, playerToken: %s", gameToken, playerToken)

	// Get the game
	g, err := game.Manager.GetGameByToken(gameToken)
	if err != nil {
		log.Printf("[WS] Game not found for token %s: %v", gameToken, err)
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}

	log.Printf("[WS] Found game %s for token %s", g.ID, gameToken)

	// Verify player token matches one of the players in the game
	var playerID string
	if g.Player1.PlayerToken == playerToken {
		playerID = g.Player1.ID
		log.Printf("[WS] Player authenticated as Player1: %s", playerID)
	} else if g.Player2.PlayerToken == playerToken {
		playerID = g.Player2.ID
		log.Printf("[WS] Player authenticated as Player2: %s", playerID)
	} else {
		log.Printf("[WS] Invalid player token %s for game %s", playerToken, gameToken)
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid player token"})
		return
	}

	// Upgrade to WebSocket
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := &Client{
		conn:      conn,
		playerID:  playerID,
		gameID:    g.ID,
		gameToken: gameToken,
		send:      make(chan []byte, 256),
	}

	// Register client - this will handle sending appropriate initial messages
	GameHub.register <- client

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump()
}

// readPump reads messages from the WebSocket connection
func (c *Client) readPump() {
	defer func() {
		GameHub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(65536) // 64KB - enough for game messages
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
			log.Printf("Invalid message format from player %s: %v", c.playerID, err)
			continue
		}

		c.handleMessage(msg)
	}
}

// writePump writes messages to the WebSocket connection
func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				if err := c.conn.WriteMessage(websocket.CloseMessage, []byte{}); err != nil {
					log.Printf("Error writing close message for player %s: %v", c.playerID, err)
				}
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("WebSocket write error for player %s: %v", c.playerID, err)
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("WebSocket ping error for player %s: %v", c.playerID, err)
				return
			}
		}
	}
}

// handleMessage processes incoming WebSocket messages
func (c *Client) handleMessage(msg WSMessage) {
	g, err := game.Manager.GetGameByToken(c.gameToken)
	if err != nil {
		c.sendError("Game not found")
		return
	}

	switch msg.Type {
	case "play_card":
		var data PlayCardData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			c.sendError("Invalid card data")
			return
		}
		c.handlePlayCard(g, data)

	case "draw_card":
		c.handleDrawCard(g)

	case "pass_turn":
		c.handlePassTurn(g)

	case "get_state":
		gameState := g.GetGameStateForPlayer(c.playerID)
		gameState["type"] = "game_state"
		data, _ := json.Marshal(gameState)
		c.send <- data

	default:
		c.sendError("Unknown message type")
	}
}

// handlePlayCard processes a play card action
func (c *Client) handlePlayCard(g *game.GameState, data PlayCardData) {
	log.Printf("[WS] Play attempt from %s: %v", c.playerID, data)
	// Parse card from string (e.g., "7H" -> 7 of Hearts)
	card, err := parseCard(data.Card)
	if err != nil {
		c.sendError("Invalid card format")
		return
	}

	var declaredSuit game.Suit
	if data.DeclaredSuit != "" {
		declaredSuit = game.Suit(data.DeclaredSuit)
	}

	result, err := g.PlayCard(c.playerID, card, declaredSuit)
	log.Printf("[WS] Play result for %s: err=%v, result=%+v", c.playerID, err, result)
	if err != nil {
		c.sendError(err.Error())
		return
	}

	// Broadcast the play to all players
	GameHub.BroadcastToGame(c.gameID, map[string]interface{}{
		"type":            "card_played",
		"player":          c.playerID,
		"card":            data.Card,
		"current_suit":    result.CurrentSuit,
		"next_turn":       result.NextTurn,
		"effect":          result.Effect,
		"game_over":       result.GameOver,
		"winner":          result.Winner,
		"win_type":        result.WinType,
		"player_points":   result.PlayerPoints,
		"opponent_points": result.OpponentPoints,
	})

	// Send updated game state to each player
	c.broadcastGameState(g)
}

// handleDrawCard processes a draw card action
func (c *Client) handleDrawCard(g *game.GameState) {
	result, err := g.DrawCard(c.playerID)
	if err != nil {
		c.sendError(err.Error())
		return
	}

	// Send drawn cards only to the player who drew
	GameHub.SendToPlayer(c.playerID, map[string]interface{}{
		"type":           "cards_drawn",
		"cards":          result.CardsDrawn,
		"count":          result.Count,
		"can_play_drawn": result.CanPlayDrawn,
		"next_turn":      result.NextTurn,
	})

	// Broadcast to opponent that cards were drawn
	opponent := g.GetOpponent()
	if opponent != nil {
		GameHub.SendToPlayer(opponent.ID, map[string]interface{}{
			"type":      "opponent_drew",
			"count":     result.Count,
			"next_turn": result.NextTurn,
		})
	}

	c.broadcastGameState(g)
}

// handlePassTurn processes a pass turn action
func (c *Client) handlePassTurn(g *game.GameState) {
	log.Printf("[WS] PassTurn request from %s", c.playerID)
	if err := g.PassTurn(c.playerID); err != nil {
		log.Printf("[WS] PassTurn failed for %s: %v", c.playerID, err)
		c.sendError(err.Error())
		return
	}

	log.Printf("[WS] PassTurn success for %s, broadcast turn_passed", c.playerID)
	GameHub.BroadcastToGame(c.gameID, map[string]interface{}{
		"type":      "turn_passed",
		"player":    c.playerID,
		"next_turn": g.CurrentTurn,
	})

	c.broadcastGameState(g)
}

// broadcastGameState sends updated game state to all players
func (c *Client) broadcastGameState(g *game.GameState) {
	// Send personalized state to each player
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

// sendError sends an error message to the client
func (c *Client) sendError(message string) {
	data, _ := json.Marshal(map[string]interface{}{
		"type":    "error",
		"message": message,
	})
	c.send <- data
}

// parseCard parses a card string like "7H" into a Card
func parseCard(cardStr string) (game.Card, error) {
	if len(cardStr) < 2 {
		return game.Card{}, game.ErrInvalidCard
	}

	// Get suit (last character)
	suitChar := cardStr[len(cardStr)-1]
	var suit game.Suit
	switch suitChar {
	case 'H', 'h':
		suit = game.Hearts
	case 'D', 'd':
		suit = game.Diamonds
	case 'C', 'c':
		suit = game.Clubs
	case 'S', 's':
		suit = game.Spades
	default:
		return game.Card{}, game.ErrInvalidCard
	}

	// Get rank (everything except last character)
	rankStr := cardStr[:len(cardStr)-1]
	var rank game.Rank
	switch rankStr {
	case "A", "1":
		rank = game.Ace
	case "2":
		rank = game.Two
	case "3":
		rank = game.Three
	case "4":
		rank = game.Four
	case "5":
		rank = game.Five
	case "6":
		rank = game.Six
	case "7":
		rank = game.Seven
	case "8":
		rank = game.Eight
	case "9":
		rank = game.Nine
	case "10", "0":
		rank = game.Ten
	case "J":
		rank = game.Jack
	case "Q":
		rank = game.Queen
	case "K":
		rank = game.King
	default:
		return game.Card{}, game.ErrInvalidCard
	}

	return game.Card{Suit: suit, Rank: rank}, nil
}
