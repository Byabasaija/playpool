package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// disconnectOnce closes the send channel exactly once, causing writePump to
// exit and close the WebSocket connection. The client will then reconnect and
// receive a fresh game_state, recovering from any missed messages.

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins in development
	},
}

// Client represents a connected WebSocket client
type Client struct {
	conn       *websocket.Conn
	playerID   string
	opponentID string
	gameID     string
	gameToken  string
	send       chan []byte
	closeOnce  sync.Once
}

// disconnect closes the send channel exactly once, which causes writePump to
// exit, the WebSocket connection to close, and the client to reconnect + resync.
func (c *Client) disconnect() {
	c.closeOnce.Do(func() {
		close(c.send)
	})
}

// Hub maintains the set of active clients
type Hub struct {
	clients    map[string]*Client            // playerID -> Client
	gameRooms  map[string]map[string]*Client // gameID -> playerID -> Client
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
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
				// Buffer full — close the connection so the client reconnects and
				// receives a fresh game_state instead of silently seeing stale data.
				log.Printf("[WS] Buffer full for player %s in game %s — closing to force resync", client.playerID, gameID)
				go client.disconnect()
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
			// sent
		default:
			// Buffer full — close to force reconnect + resync instead of silent drop.
			log.Printf("[WS] Buffer full for player %s — closing to force resync", playerID)
			go client.disconnect()
		}
	} else {
		log.Printf("[WS] SendToPlayer no client for player %s", playerID)
	}
}

// Message types
type WSMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
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
				// Channel closed — connection is being replaced or cleaned up.
				// Best-effort close frame; ignore errors (conn may already be closed).
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
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

// sendError sends an error message to the client
func (c *Client) sendError(message string) {
	data, _ := json.Marshal(map[string]interface{}{
		"type":    "error",
		"message": message,
	})
	c.send <- data
}

