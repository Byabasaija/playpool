package game

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/accounts"
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/models"
	"github.com/playmatatu/backend/internal/sms"
	"github.com/redis/go-redis/v9"
)

// GameManager manages all active games and matchmaking
type GameManager struct {
	games            map[string]*GameState // keyed by game ID
	playerToGame     map[string]string     // player ID -> game ID
	matchmakingQueue map[int][]QueueEntry  // stake amount -> queue of players
	rdb              *redis.Client         // Redis client for persistence
	db               *sqlx.DB              // SQL DB for persistent records
	config           *config.Config        // Application config
	mu               sync.RWMutex
}

// QueueEntry represents a player in the matchmaking queue
type QueueEntry struct {
	QueueToken  string
	PhoneNumber string
	StakeAmount int
	DBPlayerID  int
	DisplayName string
	JoinedAt    time.Time
}

// MatchResult represents the result of a successful match
type MatchResult struct {
	GameID             string
	GameToken          string
	Player1ID          string
	Player1Token       string
	Player1Link        string
	Player1DisplayName string
	Player2ID          string
	Player2Token       string
	Player2Link        string
	Player2DisplayName string
	StakeAmount        int
	ExpiresAt          time.Time
	SessionID          int
}

var (
	// Global game manager instance
	Manager *GameManager
)

// InitializeManager initializes the global game manager with Redis, DB and config
func InitializeManager(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) {
	Manager = NewGameManager(db, rdb, cfg)
	// Start background jobs
	go Manager.StartExpiryChecker()
	go Manager.StartDisconnectChecker()
	// Rehydrate queue from DB into Redis (if configured)
	if err := Manager.RehydrateQueueFromDB(); err != nil {
		log.Printf("[REHYDRATE] Error rehydrating queue from DB: %v", err)
	}
	// Start queue expiry checker
	go Manager.StartQueueExpiryChecker()
	go Manager.StartProcessingRecoveryChecker()
}

// NewGameManager creates a new game manager
func NewGameManager(db *sqlx.DB, rdb *redis.Client, cfg *config.Config) *GameManager {
	return &GameManager{
		games:            make(map[string]*GameState),
		playerToGame:     make(map[string]string),
		matchmakingQueue: make(map[int][]QueueEntry),
		rdb:              rdb,
		db:               db,
		config:           cfg,
	}
}

// generateToken generates a secure random token
func generateToken(length int) string {
	bytes := make([]byte, length)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// generateGameID generates a unique game ID
func generateGameID() string {
	return "game_" + generateToken(8)
}

// JoinQueue adds a player to the matchmaking queue
// now accepts dbPlayerID and displayName to carry persistent identity
func (gm *GameManager) JoinQueue(playerID, phoneNumber string, stakeAmount int, dbPlayerID int, displayName string) (*MatchResult, error) {
	gm.mu.Lock()
	defer gm.mu.Unlock()

	// Check if player is already in a game
	if _, exists := gm.playerToGame[playerID]; exists {
		return nil, errors.New("player already in a game")
	}

	// Check if player is already in queue
	for _, entries := range gm.matchmakingQueue {
		for _, entry := range entries {
			if entry.QueueToken == playerID {
				return nil, errors.New("player already in queue")
			}
		}
	}

	// Try to match with existing player in queue
	if queue, exists := gm.matchmakingQueue[stakeAmount]; exists && len(queue) > 0 {
		// Find an opponent (not the same phone number)
		for i, opponent := range queue {
			if opponent.PhoneNumber != phoneNumber {
				// Match found! Remove opponent from queue
				gm.matchmakingQueue[stakeAmount] = append(queue[:i], queue[i+1:]...)

				// Create the game
				gameID := generateGameID()
				gameToken := generateToken(16)

				// Generate secure player tokens for authentication
				player1Token := generateToken(16)
				player2Token := generateToken(16)

				game := NewGame(
					gameID,
					gameToken,
					opponent.QueueToken,
					opponent.PhoneNumber,
					player1Token,
					opponent.DBPlayerID,
					opponent.DisplayName,
					playerID,
					phoneNumber,
					player2Token,
					dbPlayerID,
					displayName,
					stakeAmount,
				)

				// DO NOT initialize yet - wait for both players to connect
				// Game stays in StatusWaiting until both players join via WebSocket

				// Store the game
				gm.games[gameID] = game
				gm.playerToGame[opponent.QueueToken] = gameID
				gm.playerToGame[playerID] = gameID

				// Log the mapping for debugging
				log.Printf("[MATCHMAKING] Game created: %s", gameID)
				log.Printf("[MATCHMAKING] Player1: %s → Game: %s", opponent.QueueToken, gameID)
				log.Printf("[MATCHMAKING] Player2: %s → Game: %s", playerID, gameID)

				// Save to Redis
				gm.saveGameToRedis(game)

				// Persist a game_sessions row if we have DB player ids
				var sessionID int
				if gm.db != nil && opponent.DBPlayerID > 0 && dbPlayerID > 0 {
					err := gm.db.QueryRowx(`INSERT INTO game_sessions (game_token, player1_id, player2_id, stake_amount, status, created_at, expiry_time) VALUES ($1, $2, $3, $4, $5, NOW(), $6) RETURNING id`,
						gameToken, opponent.DBPlayerID, dbPlayerID, stakeAmount, string(StatusWaiting), game.ExpiresAt).Scan(&sessionID)
					if err != nil {
						log.Printf("[DB] Failed to create game_session: %v", err)
					} else {
						// Update both queue rows with matched status and session id (match by queue_token)
						if _, err := gm.db.Exec(`UPDATE matchmaking_queue SET status='matched', matched_at=NOW(), session_id=$1 WHERE queue_token=$2`, sessionID, opponent.QueueToken); err != nil {
							log.Printf("[DB] Failed to update opponent queue (%s): %v", opponent.QueueToken, err)
						}
						if _, err := gm.db.Exec(`UPDATE matchmaking_queue SET status='matched', matched_at=NOW(), session_id=$1 WHERE queue_token=$2`, sessionID, playerID); err != nil {
							log.Printf("[DB] Failed to update my queue (%s): %v", playerID, err)
						}
						// Attach session id to in-memory game and persist
						if sessionID > 0 {
							if g, ok := gm.games[gameID]; ok {
								g.SessionID = sessionID
								go g.SaveToRedis()
							}
						}
						// Save game to redis (already set)
						gm.saveGameToRedis(game)
					}
				}

				// Generate game links for both players
				baseURL := gm.config.FrontendURL
				player1Link := baseURL + "/g/" + gameToken + "?pt=" + player1Token
				player2Link := baseURL + "/g/" + gameToken + "?pt=" + player2Token

				return &MatchResult{
					GameID:             gameID,
					GameToken:          gameToken,
					Player1ID:          opponent.QueueToken,
					Player1Token:       player1Token,
					Player1Link:        player1Link,
					Player1DisplayName: opponent.DisplayName,
					Player2ID:          playerID,
					Player2Token:       player2Token,
					Player2Link:        player2Link,
					Player2DisplayName: displayName,
					StakeAmount:        stakeAmount,
					ExpiresAt:          game.ExpiresAt,
					SessionID:          sessionID,
				}, nil
			}
		}
	}

	// No match found, add to queue
	entry := QueueEntry{
		QueueToken:  playerID,
		PhoneNumber: phoneNumber,
		StakeAmount: stakeAmount,
		DBPlayerID:  dbPlayerID,
		DisplayName: displayName,
		JoinedAt:    time.Now(),
	}

	if _, exists := gm.matchmakingQueue[stakeAmount]; !exists {
		gm.matchmakingQueue[stakeAmount] = []QueueEntry{}
	}
	gm.matchmakingQueue[stakeAmount] = append(gm.matchmakingQueue[stakeAmount], entry)

	return nil, nil // No match yet, player added to queue
}

// LeaveQueue removes a player from the matchmaking queue (by queue token)
func (gm *GameManager) LeaveQueue(queueToken string) bool {
	gm.mu.Lock()
	defer gm.mu.Unlock()

	for stake, queue := range gm.matchmakingQueue {
		for i, entry := range queue {
			if entry.QueueToken == queueToken {
				gm.matchmakingQueue[stake] = append(queue[:i], queue[i+1:]...)
				return true
			}
		}
	}
	return false
}

// CreateGameFromMatch creates an in-memory game from a DB-matched pair (called by matchmaker worker)
func (gm *GameManager) CreateGameFromMatch(player1, player2 QueuedPlayer, gameToken string, stake float64, cfg *config.Config) {
	gm.mu.Lock()
	defer gm.mu.Unlock()

	// Generate game ID and player tokens
	gameID := generateGameID()
	player1Token := generateToken(16)
	player2Token := generateToken(16)

	// Create the game
	game := NewGame(
		gameID,
		gameToken,
		player1.QueueToken,
		player1.PhoneNumber,
		player1Token,
		player1.PlayerID,
		player1.DisplayName,
		player2.QueueToken,
		player2.PhoneNumber,
		player2Token,
		player2.PlayerID,
		player2.DisplayName,
		int(stake),
	)

	// Store the game
	gm.games[gameID] = game
	gm.playerToGame[player1.QueueToken] = gameID
	gm.playerToGame[player2.QueueToken] = gameID

	log.Printf("[MATCHMAKER] Game created in memory: %s (token=%s)", gameID, gameToken)
	log.Printf("[MATCHMAKER] Player1: %s (db_id=%d) → Game: %s", player1.QueueToken, player1.PlayerID, gameID)
	log.Printf("[MATCHMAKER] Player2: %s (db_id=%d) → Game: %s", player2.QueueToken, player2.PlayerID, gameID)

	// Save to Redis for persistence
	gm.saveGameToRedis(game)
}

// GetGame retrieves a game by ID
func (gm *GameManager) GetGame(gameID string) (*GameState, error) {
	gm.mu.RLock()
	// Check in memory first
	game, exists := gm.games[gameID]
	if exists {
		gm.mu.RUnlock()
		return game, nil
	}
	gm.mu.RUnlock()

	// Not found in memory - need to find token to check Redis
	// Look through all games in Redis to find one with this ID
	// This is less efficient but handles the reconnect case
	gm.mu.RLock()
	for _, memGame := range gm.games {
		if memGame.ID == gameID {
			gm.mu.RUnlock()
			return memGame, nil
		}
	}
	gm.mu.RUnlock()

	// Game not found in memory at all
	return nil, errors.New("game not found")
}

// GetGameByToken retrieves a game by its token
func (gm *GameManager) GetGameByToken(token string) (*GameState, error) {
	gm.mu.RLock()
	// Check in memory first
	for _, game := range gm.games {
		if game.Token == token {
			gm.mu.RUnlock()
			log.Printf("[DEBUG] Found game %s in memory", token)
			return game, nil
		}
	}
	gm.mu.RUnlock()

	log.Printf("[DEBUG] Game %s not found in memory, checking Redis", token)
	// Not found in memory, try Redis
	game, err := gm.loadGameFromRedis(token)
	if err != nil {
		log.Printf("[DEBUG] Game %s not found in Redis: %v", token, err)
		return nil, errors.New("game not found")
	}

	log.Printf("[DEBUG] Loaded game %s from Redis", token)
	// Load into memory and return
	gm.mu.Lock()
	gm.games[game.ID] = game
	gm.playerToGame[game.Player1.ID] = game.ID
	gm.playerToGame[game.Player2.ID] = game.ID
	gm.mu.Unlock()

	return game, nil
}

// GetGameForPlayer retrieves the active game for a player
func (gm *GameManager) GetGameForPlayer(playerID string) (*GameState, error) {
	gm.mu.RLock()
	defer gm.mu.RUnlock()

	gameID, exists := gm.playerToGame[playerID]
	if !exists {
		return nil, errors.New("player not in a game")
	}

	game, exists := gm.games[gameID]
	if !exists {
		return nil, errors.New("game not found")
	}

	return game, nil
}

// EndGame removes a completed game from the manager
func (gm *GameManager) EndGame(gameID string) error {
	gm.mu.Lock()
	defer gm.mu.Unlock()

	game, exists := gm.games[gameID]
	if !exists {
		return errors.New("game not found")
	}

	// Remove player mappings
	delete(gm.playerToGame, game.Player1.ID)
	delete(gm.playerToGame, game.Player2.ID)

	// Remove game
	delete(gm.games, gameID)

	return nil
}

// GetQueueStatus returns the number of players waiting at each stake level
func (gm *GameManager) GetQueueStatus() map[int]int {
	gm.mu.RLock()
	defer gm.mu.RUnlock()

	status := make(map[int]int)
	for stake, queue := range gm.matchmakingQueue {
		status[stake] = len(queue)
	}
	return status
}

// GetActiveGameCount returns the number of active games
func (gm *GameManager) GetActiveGameCount() int {
	gm.mu.RLock()
	defer gm.mu.RUnlock()
	return len(gm.games)
}

// IsPlayerInQueue checks if a player (by queue token) is in the matchmaking queue
func (gm *GameManager) IsPlayerInQueue(queueToken string) bool {
	gm.mu.RLock()
	defer gm.mu.RUnlock()

	for _, queue := range gm.matchmakingQueue {
		for _, entry := range queue {
			if entry.QueueToken == queueToken {
				return true
			}
		}
	}
	return false
}

// GetPlayerQueuePosition returns the player's position in queue (1-indexed) or 0 if not in queue
func (gm *GameManager) GetPlayerQueuePosition(queueToken string, stakeAmount int) int {
	gm.mu.RLock()
	defer gm.mu.RUnlock()

	if queue, exists := gm.matchmakingQueue[stakeAmount]; exists {
		for i, entry := range queue {
			if entry.QueueToken == queueToken {
				return i + 1
			}
		}
	}
	return 0
}

// CleanupExpiredEntries removes entries older than the specified duration
func (gm *GameManager) CleanupExpiredEntries(maxAge time.Duration) int {
	gm.mu.Lock()
	defer gm.mu.Unlock()

	removed := 0
	cutoff := time.Now().Add(-maxAge)

	for stake, queue := range gm.matchmakingQueue {
		newQueue := []QueueEntry{}
		for _, entry := range queue {
			if entry.JoinedAt.After(cutoff) {
				newQueue = append(newQueue, entry)
			} else {
				removed++
			}
		}
		gm.matchmakingQueue[stake] = newQueue
	}

	return removed
}

// CreateTestGame creates a game for testing (bypasses matchmaking)
func (gm *GameManager) CreateTestGame(player1Phone, player2Phone string, stakeAmount int) (*GameState, error) {
	gm.mu.Lock()
	defer gm.mu.Unlock()

	gameID := generateGameID()
	gameToken := generateToken(16)
	player1ID := "p1_" + generateToken(4)
	player2ID := "p2_" + generateToken(4)

	// Generate test player tokens
	player1Token := generateToken(16)
	player2Token := generateToken(16)

	game := NewGame(
		gameID,
		gameToken,
		player1ID,
		player1Phone,
		player1Token,
		0,             // player1 DB id (test)
		"TestPlayer1", // player1 display name
		player2ID,
		player2Phone,
		player2Token,
		0,             // player2 DB id (test)
		"TestPlayer2", // player2 display name
		stakeAmount,
	)

	if err := game.Initialize(); err != nil {
		return nil, err
	}

	gm.games[gameID] = game
	gm.playerToGame[player1ID] = gameID
	gm.playerToGame[player2ID] = gameID

	return game, nil
}

// CreateTestDrawGame creates a game that will end in a draw (for testing draw functionality)
func (gm *GameManager) CreateTestDrawGame(player1Phone, player2Phone string, stakeAmount int) (*GameState, error) {
	gm.mu.Lock()
	defer gm.mu.Unlock()

	gameID := generateGameID()
	gameToken := generateToken(16)
	player1ID := "p1_" + generateToken(4)
	player2ID := "p2_" + generateToken(4)

	// Generate test player tokens
	player1Token := generateToken(16)
	player2Token := generateToken(16)

	game := NewGame(
		gameID,
		gameToken,
		player1ID,
		player1Phone,
		player1Token,
		0,             // player1 DB id (test)
		"TestPlayer1", // player1 display name
		player2ID,
		player2Phone,
		player2Token,
		0,             // player2 DB id (test)
		"TestPlayer2", // player2 display name
		stakeAmount,
	)

	// Don't call Initialize() - we'll set up the game state manually
	// Set the target suit to Hearts
	game.TargetSuit = Hearts
	game.TargetCard = Card{Suit: Hearts, Rank: King} // The target card (not the 7)

	// Create hands with equal point values
	// Player 1: 7♥ (chop card), 5♠, 5♦, 7♣ = 5 + 5 + 7 = 17 points after playing 7♥
	// Player 2: 8♣, 9♦ = 8 + 9 = 17 points
	// Both players have 17 points when 7♥ is played → DRAW!
	game.Player1.Hand = []Card{
		{Suit: Hearts, Rank: Seven},  // Chop card - will trigger draw
		{Suit: Spades, Rank: Five},   // 5 points
		{Suit: Diamonds, Rank: Five}, // 5 points
		{Suit: Clubs, Rank: Seven},   // 7 points (total 17 when 7♥ is played)
	}

	game.Player2.Hand = []Card{
		{Suit: Clubs, Rank: Eight},   // 8 points
		{Suit: Diamonds, Rank: Nine}, // 9 points (total 17)
	}

	// Set up the deck with remaining cards (excluding the ones in hands)
	game.Deck = NewDeck()
	// Remove cards that are in player hands
	cardsInHands := append(game.Player1.Hand, game.Player2.Hand...)
	newCards := []Card{}
	for _, card := range game.Deck.Cards {
		found := false
		for _, handCard := range cardsInHands {
			if card.Suit == handCard.Suit && card.Rank == handCard.Rank {
				found = true
				break
			}
		}
		if !found {
			newCards = append(newCards, card)
		}
	}
	game.Deck.Cards = newCards

	// Set the first card in discard pile to a Heart so Player 1 can play 7♥ immediately
	game.DiscardPile = []Card{{Suit: Hearts, Rank: Three}}
	game.CurrentSuit = Hearts

	// Player 1 starts (they have the chop card)
	game.CurrentTurn = player1ID

	// Mark game as in progress
	game.Status = StatusInProgress
	now := time.Now()
	game.StartedAt = &now

	gm.games[gameID] = game
	gm.playerToGame[player1ID] = gameID
	gm.playerToGame[player2ID] = gameID

	return game, nil
}

// parseCardsFromData reconstructs cards from JSON data
func parseCardsFromData(data []interface{}) []Card {
	var cards []Card
	for _, cardData := range data {
		if cardMap, ok := cardData.(map[string]interface{}); ok {
			var card Card
			if suit, ok := cardMap["suit"].(string); ok {
				card.Suit = Suit(suit)
			}
			if rank, ok := cardMap["rank"].(string); ok {
				card.Rank = Rank(rank)
			}
			cards = append(cards, card)
		}
	}
	return cards
}

// saveGameToRedis persists game state to Redis
func (gm *GameManager) saveGameToRedis(game *GameState) error {
	if gm.rdb == nil {
		return nil // No Redis client, skip
	}

	ctx := context.Background()
	key := "game:" + game.Token + ":state"

	// Create serializable game data
	gameData := map[string]interface{}{
		"id":            game.ID,
		"token":         game.Token,
		"player1":       game.Player1,
		"player2":       game.Player2,
		"deck_cards":    game.Deck.GetCards(),
		"discard_pile":  game.DiscardPile,
		"current_turn":  game.CurrentTurn,
		"current_suit":  game.CurrentSuit,
		"draw_stack":    game.DrawStack,
		"status":        game.Status,
		"winner":        game.Winner,
		"stake_amount":  game.StakeAmount,
		"created_at":    game.CreatedAt,
		"started_at":    game.StartedAt,
		"completed_at":  game.CompletedAt,
		"last_activity": game.LastActivity,
		"session_id":    game.SessionID,
	}

	data, err := json.Marshal(gameData)
	if err != nil {
		return err
	}

	// Save with 1 hour expiration
	return gm.rdb.SetEx(ctx, key, data, time.Hour).Err()
}

// loadGameFromRedis restores game state from Redis
func (gm *GameManager) loadGameFromRedis(token string) (*GameState, error) {
	if gm.rdb == nil {
		return nil, errors.New("no redis client")
	}

	ctx := context.Background()
	key := "game:" + token + ":state"

	data, err := gm.rdb.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, errors.New("game not found in redis")
	}
	if err != nil {
		return nil, err
	}

	var gameData map[string]interface{}
	if err := json.Unmarshal([]byte(data), &gameData); err != nil {
		return nil, err
	}

	// Reconstruct game state with safe type assertions
	game := &GameState{
		LastActivity: time.Now(), // Update last activity
	}

	// Safe string parsing
	if id, ok := gameData["id"].(string); ok {
		game.ID = id
	}
	if token, ok := gameData["token"].(string); ok {
		game.Token = token
	}
	if currentTurn, ok := gameData["current_turn"].(string); ok {
		game.CurrentTurn = currentTurn
	}
	if currentSuit, ok := gameData["current_suit"].(string); ok {
		game.CurrentSuit = Suit(currentSuit)
	}
	if status, ok := gameData["status"].(string); ok {
		game.Status = GameStatus(status)
	}
	if winner, ok := gameData["winner"].(string); ok {
		game.Winner = winner
	}

	// Safe numeric parsing
	if drawStack, ok := gameData["draw_stack"].(float64); ok {
		game.DrawStack = int(drawStack)
	}
	if stakeAmount, ok := gameData["stake_amount"].(float64); ok {
		game.StakeAmount = int(stakeAmount)
	}

	// Parse timestamps
	if createdAt, ok := gameData["created_at"].(string); ok {
		if t, err := time.Parse(time.RFC3339, createdAt); err == nil {
			game.CreatedAt = t
		}
	}
	if startedAt, ok := gameData["started_at"]; ok && startedAt != nil {
		if startedAtStr, ok := startedAt.(string); ok {
			if t, err := time.Parse(time.RFC3339, startedAtStr); err == nil {
				game.StartedAt = &t
			}
		}
	}

	// Parse players
	if p1Data, ok := gameData["player1"].(map[string]interface{}); ok {
		game.Player1 = parsePlayerFromData(p1Data)
	}
	if p2Data, ok := gameData["player2"].(map[string]interface{}); ok {
		game.Player2 = parsePlayerFromData(p2Data)
	}

	// Parse deck
	if deckData, ok := gameData["deck_cards"].([]interface{}); ok {
		game.Deck = NewDeck()
		game.Deck.SetCards(parseCardsFromData(deckData))
	}

	// Parse discard pile
	if discardData, ok := gameData["discard_pile"].([]interface{}); ok {
		game.DiscardPile = parseCardsFromData(discardData)
	}

	return game, nil
}

// parsePlayerFromData reconstructs a Player from JSON data
func parsePlayerFromData(data map[string]interface{}) *Player {
	player := &Player{
		Connected: false, // Reset connection status
	}

	if id, ok := data["id"].(string); ok {
		player.ID = id
	}
	if phoneNumber, ok := data["phone_number"].(string); ok {
		player.PhoneNumber = phoneNumber
	}
	if displayName, ok := data["display_name"].(string); ok {
		player.DisplayName = displayName
	}
	if dbID, ok := data["db_player_id"].(float64); ok {
		player.DBPlayerID = int(dbID)
	}

	if handData, ok := data["hand"].([]interface{}); ok {
		player.Hand = parseCardsFromData(handData)
	}

	return player
}

// StartExpiryChecker runs a background job to check for expired games
func (gm *GameManager) StartExpiryChecker() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		gm.checkExpiredGames()
	}
}

// checkExpiredGames checks all WAITING games for expiry
func (gm *GameManager) checkExpiredGames() {
	// Collect candidates under read lock
	gm.mu.RLock()
	now := time.Now()
	var expiredGames []*GameState
	for _, game := range gm.games {
		if game.Status == StatusWaiting && now.After(game.ExpiresAt) {
			expiredGames = append(expiredGames, game)
		}
	}
	gm.mu.RUnlock()

	for _, g := range expiredGames {
		// Re-check under lock to avoid races
		g.mu.RLock()
		isWaiting := g.Status == StatusWaiting
		g.mu.RUnlock()
		if !isWaiting {
			continue
		}

		log.Printf("[EXPIRY] Game %s expired; processing cancellation", g.ID)

		// Attempt DB refund if persisted
		if gm.db != nil && g.SessionID > 0 {
			p1ID := 0
			p2ID := 0
			if g.Player1 != nil {
				p1ID = g.Player1.DBPlayerID
			}
			if g.Player2 != nil {
				p2ID = g.Player2.DBPlayerID
			}
			if p1ID > 0 && p2ID > 0 {
				tx, err := gm.db.Beginx()
				if err != nil {
					log.Printf("[DB] Failed to begin tx for expiry refund session %d: %v", g.SessionID, err)
				} else {
					// Idempotency: skip if SESSION_CANCEL already exists
					var cnt int
					if err := tx.Get(&cnt, `SELECT COUNT(*) FROM escrow_ledger WHERE session_id=$1 AND entry_type='SESSION_CANCEL'`, g.SessionID); err != nil {
						log.Printf("[DB] Failed to check existing session cancel ledger for session %d: %v", g.SessionID, err)
						tx.Rollback()
					} else if cnt > 0 {
						log.Printf("[DB] Session cancel already processed for session %d", g.SessionID)
						tx.Rollback()
					} else {
						// Resolve accounts
						escrowAcc, err1 := accounts.GetOrCreateAccount(gm.db, accounts.AccountEscrow, nil)
						p1Acc, err2 := accounts.GetOrCreateAccount(gm.db, accounts.AccountPlayerWinnings, &p1ID)
						p2Acc, err3 := accounts.GetOrCreateAccount(gm.db, accounts.AccountPlayerWinnings, &p2ID)
						if err1 != nil || err2 != nil || err3 != nil {
							log.Printf("[DB] Failed to resolve accounts for expiry refund session %d: %v %v %v", g.SessionID, err1, err2, err3)
							tx.Rollback()
						} else {
							amount := float64(g.StakeAmount)
							// Refund to player 1
							if err := accounts.Transfer(tx, escrowAcc.ID, p1Acc.ID, amount, "SESSION", sql.NullInt64{Int64: int64(g.SessionID), Valid: true}, "SESSION_CANCEL"); err != nil {
								log.Printf("[DB] Failed to transfer expiry refund to player %d for session %d: %v", p1ID, g.SessionID, err)
								tx.Rollback()
							} else {
								if _, err := tx.Exec(`INSERT INTO escrow_ledger (session_id, entry_type, player_id, amount, balance_after, description, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`, g.SessionID, "SESSION_CANCEL", p1ID, amount, 0.0, "Session expired - refund to player"); err != nil {
									log.Printf("[DB] Failed to insert escrow_ledger for session cancel (p1) session %d: %v", g.SessionID, err)
									tx.Rollback()
									goto cancel_end
								}
								if _, err := tx.Exec(`INSERT INTO transactions (player_id, transaction_type, amount, status, created_at) VALUES ($1,'REFUND',$2,'COMPLETED',NOW())`, p1ID, amount); err != nil {
									log.Printf("[DB] Failed to insert transaction for expiry refund p1 session %d: %v", g.SessionID, err)
								}
							}

							// Refund to player 2
							if err := accounts.Transfer(tx, escrowAcc.ID, p2Acc.ID, amount, "SESSION", sql.NullInt64{Int64: int64(g.SessionID), Valid: true}, "SESSION_CANCEL"); err != nil {
								log.Printf("[DB] Failed to transfer expiry refund to player %d for session %d: %v", p2ID, g.SessionID, err)
								tx.Rollback()
							} else {
								if _, err := tx.Exec(`INSERT INTO escrow_ledger (session_id, entry_type, player_id, amount, balance_after, description, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`, g.SessionID, "SESSION_CANCEL", p2ID, amount, 0.0, "Session expired - refund to player"); err != nil {
									log.Printf("[DB] Failed to insert escrow_ledger for session cancel (p2) session %d: %v", g.SessionID, err)
									tx.Rollback()
									goto cancel_end
								}
								if _, err := tx.Exec(`INSERT INTO transactions (player_id, transaction_type, amount, status, created_at) VALUES ($1,'REFUND',$2,'COMPLETED',NOW())`, p2ID, amount); err != nil {
									log.Printf("[DB] Failed to insert transaction for expiry refund p2 session %d: %v", g.SessionID, err)
								}
							}

							// Commit
							if err := tx.Commit(); err != nil {
								log.Printf("[DB] Failed to commit expiry refund tx for session %d: %v", g.SessionID, err)
								tx.Rollback()
							} else {
								log.Printf("[DB] Expiry refund processed for session %d", g.SessionID)
							}
						}
					}
				cancel_end: // label
				}
			} else {
				log.Printf("[DB] Cannot process expiry refund - missing DB player ids for game %s session %d", g.ID, g.SessionID)
			}
		} else {
			log.Printf("[EXPIRY] Skipping DB refund - no DB session for game %s", g.ID)
		}

		// After attempting DB refund, mark game cancelled in memory and DB and notify clients
		now2 := time.Now()
		gm.mu.Lock()
		g.Status = StatusCancelled
		g.CompletedAt = &now2
		delete(gm.playerToGame, g.Player1.ID)
		delete(gm.playerToGame, g.Player2.ID)
		gm.mu.Unlock()

		if gm.db != nil && g.SessionID > 0 {
			if _, err := gm.db.Exec(`UPDATE game_sessions SET status=$1, completed_at=NOW() WHERE id=$2`, string(StatusCancelled), g.SessionID); err != nil {
				log.Printf("[DB] Failed to update game_sessions for session %d to cancelled: %v", g.SessionID, err)
			}
		}

		// Publish session_cancelled event to notify clients (if Redis configured)
		if gm.rdb != nil {
			p1State := g.GetGameStateForPlayer(g.Player1.ID)
			p2State := g.GetGameStateForPlayer(g.Player2.ID)
			payload := map[string]interface{}{"type": "session_cancelled", "game_token": g.Token, "game_id": g.ID, "message": "Game cancelled due to expiry; stakes returned to players.", "player1_state": p1State, "player2_state": p2State}
			if b, err := json.Marshal(payload); err != nil {
				log.Printf("[DB] Failed to marshal session_cancelled event for session %d: %v", g.SessionID, err)
			} else {
				if n, err := gm.rdb.Publish(context.Background(), "game_events", b).Result(); err != nil {
					log.Printf("[DB] publish session_cancelled failed: %v", err)
				} else {
					log.Printf("[DB] published session_cancelled: session=%d subscribers=%d", g.SessionID, n)
				}
			}
		}
	}
}

// StartDisconnectChecker runs a background job to check for forfeit due to disconnect
func (gm *GameManager) StartDisconnectChecker() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		gm.checkDisconnectForfeits()
	}
}

// checkDisconnectForfeits checks for players who disconnected >2 minutes ago
func (gm *GameManager) checkDisconnectForfeits() {
	gm.mu.RLock()
	gamesToCheck := make([]*GameState, 0)
	for _, game := range gm.games {
		if game.Status == StatusInProgress {
			gamesToCheck = append(gamesToCheck, game)
		}
	}
	gm.mu.RUnlock()

	now := time.Now()
	graceMinutes := 2 * time.Minute

	for _, game := range gamesToCheck {
		game.mu.RLock()
		p1Disconnected := !game.Player1.Connected && game.Player1.DisconnectedAt != nil
		p2Disconnected := !game.Player2.Connected && game.Player2.DisconnectedAt != nil

		var forfeitPlayerID string
		if p1Disconnected && now.Sub(*game.Player1.DisconnectedAt) > graceMinutes {
			forfeitPlayerID = game.Player1.ID
		} else if p2Disconnected && now.Sub(*game.Player2.DisconnectedAt) > graceMinutes {
			forfeitPlayerID = game.Player2.ID
		}
		game.mu.RUnlock()

		if forfeitPlayerID != "" {
			game.ForfeitByDisconnect(forfeitPlayerID)
			// log.Printf("[DISCONNECT FORFEIT] Player %s forfeited game %s", forfeitPlayerID, game.ID)
		}
	}
}

// RehydrateQueueFromDB loads queued rows from the DB and pushes their ids into Redis per stake key.
func (gm *GameManager) RehydrateQueueFromDB() error {
	if gm.rdb == nil || gm.db == nil {
		return nil
	}

	ctx := context.Background()
	// Load queued rows grouped by stake
	rows, err := gm.db.Queryx(`SELECT id, stake_amount FROM matchmaking_queue WHERE status='queued' AND is_private = FALSE AND expires_at > NOW() ORDER BY created_at`)
	if err != nil {
		log.Printf("[REHYDRATE] Failed to fetch queued rows from DB: %v", err)
		return err
	}
	defer rows.Close()

	grouped := make(map[int][]int)
	for rows.Next() {
		var id int
		var stakeAmount float64
		if err := rows.Scan(&id, &stakeAmount); err != nil {
			log.Printf("[REHYDRATE] Row scan error: %v", err)
			continue
		}
		s := int(stakeAmount)
		grouped[s] = append(grouped[s], id)
	}

	for stake, ids := range grouped {
		key := fmt.Sprintf("queue:stake:%d", stake)
		llen, err := gm.rdb.LLen(ctx, key).Result()
		if err != nil {
			log.Printf("[REHYDRATE] Failed to check Redis key %s: %v", key, err)
			continue
		}
		if llen > 0 {
			// already populated - skip to avoid duplicates
			continue
		}
		// Push ids to Redis (RPUSH to preserve FIFO order)
		for _, id := range ids {
			if err := gm.rdb.RPush(ctx, key, id).Err(); err != nil {
				log.Printf("[REHYDRATE] Failed to push id %d to Redis key %s: %v", id, key, err)
			}
		}
		log.Printf("[REHYDRATE] Loaded %d queued items into Redis key %s", len(ids), key)
	}

	return nil
}

// StartQueueExpiryChecker runs a background job to expire queued entries
func (gm *GameManager) StartQueueExpiryChecker() {
	if gm.db == nil || gm.rdb == nil {
		return
	}
	ticker := time.NewTicker(1 * time.Minute)
	go func() {
		for range ticker.C {
			if _, err := gm.ExpireQueuedEntries(); err != nil {
				log.Printf("[QUEUE EXPIRY] Error during expiry job: %v", err)
			}
		}
	}()
}

// ExpireQueuedEntries moves expired queued rows to status='expired', removes from Redis, and sends SMS notifications
func (gm *GameManager) ExpireQueuedEntries() (int, error) {
	if gm.db == nil || gm.rdb == nil {
		return 0, nil
	}

	ctx := context.Background()
	// Atomically update expired rows and return their details for SMS notification
	rows, err := gm.db.Queryx(`UPDATE matchmaking_queue SET status='expired' WHERE expires_at < NOW() AND status='queued' RETURNING id, phone_number, stake_amount`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type expiredEntry struct {
		ID          int
		PhoneNumber string
		StakeAmount float64
	}
	var expired []expiredEntry

	for rows.Next() {
		var e expiredEntry
		if err := rows.Scan(&e.ID, &e.PhoneNumber, &e.StakeAmount); err != nil {
			log.Printf("[QUEUE EXPIRY] Scan error: %v", err)
			continue
		}

		// Remove from Redis
		key := fmt.Sprintf("queue:stake:%d", int(e.StakeAmount))
		if err := gm.rdb.LRem(ctx, key, 0, e.ID).Err(); err != nil {
			log.Printf("[QUEUE EXPIRY] Failed to LREM id %d from %s: %v", e.ID, key, err)
		}

		expired = append(expired, e)
	}

	if len(expired) > 0 {
		log.Printf("[QUEUE EXPIRY] Expired %d queued entries", len(expired))

		// Send SMS notifications with requeue link (best-effort, async)
		for _, e := range expired {
			go func(phone string, stake float64) {
				if sms.Default == nil {
					return
				}
				requeueLink := fmt.Sprintf("%s/requeue?phone=%s", gm.config.FrontendURL, phone)
				msg := fmt.Sprintf("PlayMatatu: No match found for your %.0f UGX stake. Click to try again: %s", stake, requeueLink)
				if _, err := sms.SendSMS(ctx, phone, msg); err != nil {
					log.Printf("[QUEUE EXPIRY] Failed to send expiry SMS to %s: %v", phone, err)
				} else {
					log.Printf("[QUEUE EXPIRY] Expiry SMS sent to %s with requeue link", phone)
				}
			}(e.PhoneNumber, e.StakeAmount)
		}
	}
	return len(expired), nil
}

// RecordMove records a single move in game_moves (synchronous). It's best-effort and logs errors.
func (gm *GameManager) RecordMove(sessionID int, playerID int, moveType, cardPlayed, suitDeclared string) {
	if gm == nil || gm.db == nil || sessionID == 0 || playerID == 0 {
		return
	}

	// Determine next move number
	var maxMove int
	if err := gm.db.Get(&maxMove, `SELECT COALESCE(MAX(move_number), 0) FROM game_moves WHERE session_id = $1`, sessionID); err != nil {
		log.Printf("[DB] Failed to get max move number for session %d: %v", sessionID, err)
		return
	}
	moveNumber := maxMove + 1

	_, err := gm.db.Exec(`INSERT INTO game_moves (session_id, player_id, move_number, move_type, card_played, suit_declared, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
		sessionID, playerID, moveNumber, moveType, cardPlayed, suitDeclared)
	if err != nil {
		log.Printf("[DB] Failed to record move for session %d: %v", sessionID, err)
	}
}

// SaveFinalGameState persists the final game state JSON and updates the session row
func (gm *GameManager) SaveFinalGameState(g *GameState) {
	if gm == nil || gm.db == nil || g == nil || g.SessionID == 0 {
		return
	}

	log.Printf("[DB] SaveFinalGameState called for session=%d status=%s winner=%s", g.SessionID, g.Status, g.Winner)

	data, err := json.Marshal(g)
	if err != nil {
		log.Printf("[DB] Failed to marshal final game state for session %d: %v", g.SessionID, err)
		return
	}

	_, err = gm.db.Exec(`INSERT INTO game_states (session_id, game_state, created_at) VALUES ($1, $2::jsonb, NOW())`, g.SessionID, string(data))
	if err != nil {
		log.Printf("[DB] Failed to insert game_states for session %d: %v", g.SessionID, err)
		// continue to attempt update
	}

	// Update session status and winner if available
	if g.Status == StatusCompleted {
		// Resolve winner DB id: prefer direct access to the player objects to avoid nil/lock races
		var winnerDBID int
		if g.Winner != "" {
			if g.Player1 != nil && g.Player1.ID == g.Winner {
				winnerDBID = g.Player1.DBPlayerID
			} else if g.Player2 != nil && g.Player2.ID == g.Winner {
				winnerDBID = g.Player2.DBPlayerID
			} else if p := g.GetPlayerByID(g.Winner); p != nil {
				winnerDBID = p.DBPlayerID
			}
		}
		log.Printf("[DB] Resolved winnerDBID=%d for winnerToken=%s (session=%d)", winnerDBID, g.Winner, g.SessionID)

		if winnerDBID == 0 {
			log.Printf("[DB] SaveFinalGameState: could not resolve winner DB id for winner=%s (session=%d)", g.Winner, g.SessionID)
		}

		// Handle winner payout (non-draw): transfer winnings with tax deduction
		if winnerDBID > 0 && g.WinType != "draw" {
			if err := gm.ProcessWinnerPayout(g.SessionID, winnerDBID, g.StakeAmount); err != nil {
				log.Printf("[PAYOUT ERROR] Failed to process winner payout for session %d: %v", g.SessionID, err)
			} else {
				// Update winner's stats: increment games_won and add to total_winnings
				pot := float64(g.StakeAmount * 2)
				taxRate := float64(gm.config.PayoutTaxPercent) / 100.0
				winningsNet := pot - (pot * taxRate)

				_, err := gm.db.Exec(`UPDATE players SET total_games_won = total_games_won + 1, total_winnings = total_winnings + $1 WHERE id = $2`, winningsNet, winnerDBID)
				if err != nil {
					log.Printf("[DB] Failed to update winner stats for session %d: %v", g.SessionID, err)
				}
			}
		}

		// Handle draw: refund stakes back to both players (no tax)
		if g.Status == StatusCompleted && g.WinType == "draw" {
			// Only attempt DB refund if we have a session persisted
			if gm.db != nil && g.SessionID > 0 {
				p1ID := 0
				p2ID := 0
				if g.Player1 != nil {
					p1ID = g.Player1.DBPlayerID
				}
				if g.Player2 != nil {
					p2ID = g.Player2.DBPlayerID
				}
				if p1ID > 0 && p2ID > 0 {
					tx, err := gm.db.Beginx()
					if err != nil {
						log.Printf("[DB] Failed to begin tx for draw refund session %d: %v", g.SessionID, err)
					} else {
						// Idempotency: skip if a DRAW_REFUND already exists for this session
						var cnt int
						if err := tx.Get(&cnt, `SELECT COUNT(*) FROM escrow_ledger WHERE session_id=$1 AND entry_type='DRAW_REFUND'`, g.SessionID); err != nil {
							log.Printf("[DB] Failed to check existing draw refunds for session %d: %v", g.SessionID, err)
							tx.Rollback()
						} else if cnt > 0 {
							log.Printf("[DB] Draw refund already processed for session %d", g.SessionID)
							tx.Rollback()
						} else {
							// Resolve accounts
							escrowAcc, err1 := accounts.GetOrCreateAccount(gm.db, accounts.AccountEscrow, nil)
							p1Acc, err2 := accounts.GetOrCreateAccount(gm.db, accounts.AccountPlayerWinnings, &p1ID)
							p2Acc, err3 := accounts.GetOrCreateAccount(gm.db, accounts.AccountPlayerWinnings, &p2ID)
							if err1 != nil || err2 != nil || err3 != nil {
								log.Printf("[DB] Failed to resolve accounts for draw refund session %d: %v %v %v", g.SessionID, err1, err2, err3)
								tx.Rollback()
							} else {
								amount := float64(g.StakeAmount)
								// Transfer to player1
								if err := accounts.Transfer(tx, escrowAcc.ID, p1Acc.ID, amount, "SESSION", sql.NullInt64{Int64: int64(g.SessionID), Valid: true}, "DRAW_REFUND"); err != nil {
									log.Printf("[DB] Failed to transfer draw refund to player %d for session %d: %v", p1ID, g.SessionID, err)
									tx.Rollback()
								} else {
									if _, err := tx.Exec(`INSERT INTO escrow_ledger (session_id, entry_type, player_id, amount, balance_after, description, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`, g.SessionID, "DRAW_REFUND", p1ID, amount, 0.0, "Draw refund to player"); err != nil {
										log.Printf("[DB] Failed to insert escrow_ledger for draw refund (p1) session %d: %v", g.SessionID, err)
										tx.Rollback()
										goto draw_refund_end
									}
									if _, err := tx.Exec(`INSERT INTO transactions (player_id, transaction_type, amount, status, created_at) VALUES ($1,'REFUND',$2,'COMPLETED',NOW())`, p1ID, amount); err != nil {
										log.Printf("[DB] Failed to insert transaction for draw refund p1 session %d: %v", g.SessionID, err)
									}
								}

								// Transfer to player2
								if err := accounts.Transfer(tx, escrowAcc.ID, p2Acc.ID, amount, "SESSION", sql.NullInt64{Int64: int64(g.SessionID), Valid: true}, "DRAW_REFUND"); err != nil {
									log.Printf("[DB] Failed to transfer draw refund to player %d for session %d: %v", p2ID, g.SessionID, err)
									tx.Rollback()
								} else {
									if _, err := tx.Exec(`INSERT INTO escrow_ledger (session_id, entry_type, player_id, amount, balance_after, description, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`, g.SessionID, "DRAW_REFUND", p2ID, amount, 0.0, "Draw refund to player"); err != nil {
										log.Printf("[DB] Failed to insert escrow_ledger for draw refund (p2) session %d: %v", g.SessionID, err)
										tx.Rollback()
										goto draw_refund_end
									}
									if _, err := tx.Exec(`INSERT INTO transactions (player_id, transaction_type, amount, status, created_at) VALUES ($1,'REFUND',$2,'COMPLETED',NOW())`, p2ID, amount); err != nil {
										log.Printf("[DB] Failed to insert transaction for draw refund p2 session %d: %v", g.SessionID, err)
									}
								}

								// Commit
								if err := tx.Commit(); err != nil {
									log.Printf("[DB] Failed to commit draw refund tx for session %d: %v", g.SessionID, err)
									tx.Rollback()
								} else {
									log.Printf("[DB] Draw refund processed for session %d", g.SessionID)
								}
							}
						}
					draw_refund_end: // label for goto
					}
				} else {
					log.Printf("[DB] Cannot process draw refund - missing DB player ids for game %s session %d", g.ID, g.SessionID)
				}
			} else {
				log.Printf("[DB] Skipping draw refund - no DB session for game %s", g.ID)
			}

			// Publish game draw event to notify clients (if Redis configured)
			if gm.rdb != nil {
				p1State := g.GetGameStateForPlayer(g.Player1.ID)
				p2State := g.GetGameStateForPlayer(g.Player2.ID)
				payload := map[string]interface{}{"type": "game_draw", "game_token": g.Token, "game_id": g.ID, "message": "Game ended in a draw; stakes returned to players.", "player1_state": p1State, "player2_state": p2State}
				if b, err := json.Marshal(payload); err != nil {
					log.Printf("[DB] Failed to marshal game_draw event for session %d: %v", g.SessionID, err)
				} else {
					if n, err := gm.rdb.Publish(context.Background(), "game_events", b).Result(); err != nil {
						log.Printf("[DB] publish game_draw failed: %v", err)
					} else {
						log.Printf("[DB] published game_draw: session=%d subscribers=%d", g.SessionID, n)
					}
				}
			}
		}

		// Increment games_drawn counter for both players on draw
		if g.WinType == "draw" && g.Player1 != nil && g.Player2 != nil && g.Player1.DBPlayerID > 0 && g.Player2.DBPlayerID > 0 {
			_, err = gm.db.Exec(`UPDATE players SET total_games_drawn = total_games_drawn + 1 WHERE id IN ($1, $2)`, g.Player1.DBPlayerID, g.Player2.DBPlayerID)
			if err != nil {
				log.Printf("[DB] Failed to update games_drawn for session %d: %v", g.SessionID, err)
			}
		}

		// Increment games_played for both players if we have DB ids
		if g.Player1 != nil && g.Player2 != nil && g.Player1.DBPlayerID > 0 && g.Player2.DBPlayerID > 0 {
			_, err = gm.db.Exec(`UPDATE players SET total_games_played = total_games_played + 1 WHERE id IN ($1, $2)`, g.Player1.DBPlayerID, g.Player2.DBPlayerID)
			if err != nil {
				log.Printf("[DB] Failed to update games_played for session %d: %v", g.SessionID, err)
			}
		}

		// Ensure the game_sessions row reflects the final state (set winner, started_at if missing and completed_at)
		var winnerParam interface{}
		if winnerDBID > 0 {
			winnerParam = winnerDBID
		} else {
			winnerParam = nil
		}
		var startedAtParam interface{}
		if g.StartedAt != nil {
			startedAtParam = *g.StartedAt
		} else {
			startedAtParam = nil
		}
		if _, err := gm.db.Exec(`UPDATE game_sessions SET status=$1, winner_id=$2, started_at = COALESCE(started_at, $3), completed_at = NOW() WHERE id = $4`, string(StatusCompleted), winnerParam, startedAtParam, g.SessionID); err != nil {
			log.Printf("[DB] Failed to update game_sessions for session %d to completed: %v", g.SessionID, err)
		}
	} else {
		_, err = gm.db.Exec(`UPDATE game_sessions SET status=$1 WHERE id=$2`, string(g.Status), g.SessionID)
		if err != nil {
			log.Printf("[DB] Failed to update game_sessions status for %d: %v", g.SessionID, err)
		}
	}
}

// MarkSessionStarted updates the session row to IN_PROGRESS and sets started_at if it wasn't set.
func (gm *GameManager) MarkSessionStarted(sessionID int, startedAt time.Time) error {
	if gm == nil || gm.db == nil || sessionID == 0 {
		return nil
	}
	_, err := gm.db.Exec(`UPDATE game_sessions SET status=$1, started_at = COALESCE(started_at, $2) WHERE id=$3`, string(StatusInProgress), startedAt, sessionID)
	if err != nil {
		log.Printf("[DB] Failed to mark session %d as IN_PROGRESS: %v", sessionID, err)
	}
	return err
}

// UpdateDisplayName updates queue entries and in-memory game player display names for the given phone.
// It returns a slice of game IDs that were updated.
func (gm *GameManager) UpdateDisplayName(phone, name string) []string {
	gm.mu.Lock()
	defer gm.mu.Unlock()

	// Update queue entries
	for stake, queue := range gm.matchmakingQueue {
		for i := range queue {
			if queue[i].PhoneNumber == phone {
				gm.matchmakingQueue[stake][i].DisplayName = name
			}
		}
	}

	var updated []string
	for gid, g := range gm.games {
		g.mu.Lock()
		changed := false
		if g.Player1 != nil && g.Player1.PhoneNumber == phone {
			g.Player1.DisplayName = name
			changed = true
		}
		if g.Player2 != nil && g.Player2.PhoneNumber == phone {
			g.Player2.DisplayName = name
			changed = true
		}
		g.mu.Unlock()
		if changed {
			updated = append(updated, gid)
		}
	}

	return updated
}

// TryMatchFromRedis attempts to find an opponent for the provided queue row by popping an id
// from the Redis list for the given stake. If an opponent is found and successfully claimed
// in the DB, it creates a game session, updates both queue rows, persists the game and
// returns a MatchResult. If no opponent is available the function pushes this queue id
// into Redis and returns (nil, nil).
func (gm *GameManager) TryMatchFromRedis(stakeAmount int, myQueueID int, myPhone string, myDBPlayerID int, myDisplayName string) (*MatchResult, error) {
	if gm.rdb == nil || gm.db == nil {
		log.Printf("[MATCH] TryMatchFromRedis skipped: rdb==nil? %v db==nil? %v", gm.rdb == nil, gm.db == nil)
		// No Redis or DB available - nothing to do
		return nil, nil
	}

	ctx := context.Background()
	key := fmt.Sprintf("queue:stake:%d", stakeAmount)
	// DEBUG: log current list contents to help diagnose matching issues
	if llen, err := gm.rdb.LLen(ctx, key).Result(); err == nil {
		if llen > 0 {
			if items, err := gm.rdb.LRange(ctx, key, 0, -1).Result(); err == nil {
				log.Printf("[MATCH DEBUG] Redis list %s len=%d items=%v", key, llen, items)
			}
		} else {
			log.Printf("[MATCH DEBUG] Redis list %s is empty (len=0)", key)
		}
	} else {
		log.Printf("[MATCH DEBUG] Failed to LLen %s: %v", key, err)
	}
	// Try to pop an opponent from Redis. If none, push our own queue id and return.
	for attempts := 0; attempts < 5; attempts++ {
		oppID, err := gm.claimJobFromRedis(stakeAmount)
		log.Printf("[MATCH] claimJobFromRedis returned id=%d for stake=%d (attempt=%d)", oppID, stakeAmount, attempts)
		if err != nil {
			log.Printf("[MATCH] Redis claim error on stake %d: %v", stakeAmount, err)
			// push own id as a best-effort
			if err := gm.rdb.LPush(ctx, key, myQueueID).Err(); err != nil {
				log.Printf("[MATCH] Failed to push own queue id %d to Redis key %s: %v", myQueueID, key, err)
			}
			return nil, nil
		}

		if oppID == 0 {
			// No opponent - claim script returned no id; push own id and return
			if err := gm.rdb.LPush(ctx, key, myQueueID).Err(); err != nil {
				log.Printf("[MATCH] Failed to push own queue id %d to Redis key %s: %v", myQueueID, key, err)
			} else {
				log.Printf("[MATCH] Pushed my queue id %d into Redis for stake %d", myQueueID, stakeAmount)
				// Quick, single retry to handle simultaneous arrivals: if list length >=2, attempt one more claim
				if llen, err := gm.rdb.LLen(ctx, key).Result(); err == nil && llen >= 2 {
					log.Printf("[MATCH] Detected potential race: list %s len=%d; attempting quick claim retry", key, llen)
					time.Sleep(50 * time.Millisecond)
					retryID, err := gm.claimJobFromRedis(stakeAmount)
					log.Printf("[MATCH] Quick retry claim returned id=%d err=%v", retryID, err)
					if err == nil && retryID != 0 {
						oppID = retryID
						// fall through to DB claim handling below
					} else {
						return nil, nil
					}
				}
			}
			if oppID == 0 {
				return nil, nil
			}
		}

		// Try to claim the opponent row in the DB atomically by changing status to 'matching'
		var oppQueue struct {
			ID            int            `db:"id"`
			PlayerID      sql.NullInt64  `db:"player_id"`
			PhoneNumber   string         `db:"phone_number"`
			TransactionID sql.NullInt64  `db:"transaction_id"`
			QueueToken    sql.NullString `db:"queue_token"`
		}

		err = gm.db.Get(&oppQueue, `UPDATE matchmaking_queue SET status='matching' WHERE id=$1 AND status='queued' RETURNING id, player_id, phone_number, transaction_id, queue_token`, oppID)
		if err != nil {
			// Race - someone else claimed it or it was removed - cleanup processing entry then try next
			if err == sql.ErrNoRows {
				log.Printf("[MATCH] DB claim returned no rows for id %d (possibly raced), will cleanup and retry", oppID)
				// cleanup processing entry (remove from processing list and zset)
				processingKey := fmt.Sprintf("processing:stake:%d", stakeAmount)
				processingTsKey := fmt.Sprintf("processing_ts:stake:%d", stakeAmount)
				if err := gm.rdb.LRem(ctx, processingKey, 0, oppID).Err(); err != nil {
					log.Printf("[MATCH] Cleanup LREM failed for id %d: %v", oppID, err)
				}
				if err := gm.rdb.ZRem(ctx, processingTsKey, oppID).Err(); err != nil {
					log.Printf("[MATCH] Cleanup ZREM failed for id %d: %v", oppID, err)
				}
				continue
			}
			log.Printf("[MATCH] DB claim error for queue id %d: %v", oppID, err)
			// cleanup and push own id
			processingKey := fmt.Sprintf("processing:stake:%d", stakeAmount)
			processingTsKey := fmt.Sprintf("processing_ts:stake:%d", stakeAmount)
			if err := gm.rdb.LRem(ctx, processingKey, 0, oppID).Err(); err != nil {
				log.Printf("[MATCH] Cleanup LREM failed for id %d: %v", oppID, err)
			}
			if err := gm.rdb.ZRem(ctx, processingTsKey, oppID).Err(); err != nil {
				log.Printf("[MATCH] Cleanup ZREM failed for id %d: %v", oppID, err)
			}
			if err := gm.rdb.LPush(ctx, key, myQueueID).Err(); err != nil {
				log.Printf("[MATCH] Failed to push own queue id %d to Redis key %s: %v", myQueueID, key, err)
			}
			return nil, nil
		}

		log.Printf("[MATCH] DB claim successful for oppID=%d phone=%s", oppQueue.ID, oppQueue.PhoneNumber)

		// Avoid self-match if popped our own row unexpectedly
		if oppQueue.PhoneNumber == myPhone {
			// cleanup processing entry and continue
			processingKey := fmt.Sprintf("processing:stake:%d", stakeAmount)
			processingTsKey := fmt.Sprintf("processing_ts:stake:%d", stakeAmount)
			if err := gm.rdb.LRem(ctx, processingKey, 0, oppID).Err(); err != nil {
				log.Printf("[MATCH] Cleanup LREM failed for id %d: %v", oppID, err)
			}
			if err := gm.rdb.ZRem(ctx, processingTsKey, oppID).Err(); err != nil {
				log.Printf("[MATCH] Cleanup ZREM failed for id %d: %v", oppID, err)
			}
			continue
		}

		// Build player identities for the in-memory game
		// Retrieve opponent display name from players table if possible
		var oppPlayer models.Player
		if oppQueue.PlayerID.Valid {
			if err := gm.db.Get(&oppPlayer, `SELECT id, phone_number, display_name FROM players WHERE id=$1`, int(oppQueue.PlayerID.Int64)); err != nil {
				log.Printf("[MATCH] Failed to get opponent player %d: %v", oppQueue.PlayerID.Int64, err)
			}
		}

		// Create game id and tokens
		gameID := generateGameID()
		gameToken := generateToken(16)
		player1Token := generateToken(16)
		player2Token := generateToken(16)

		// ephemeral player IDs (default generated values)
		opponentEphemeral := "player_" + oppQueue.PhoneNumber[len(oppQueue.PhoneNumber)-4:] + "_" + generateToken(4)
		myEphemeral := "player_" + myPhone[len(myPhone)-4:] + "_" + generateToken(4)

		// Use queue_token values if present as the ephemeral player IDs; otherwise keep the generated tokens
		if oppQueue.QueueToken.Valid && oppQueue.QueueToken.String != "" {
			opponentEphemeral = oppQueue.QueueToken.String
		}

		// Fetch my queue token from DB
		var myQueueTok struct {
			QueueToken sql.NullString `db:"queue_token"`
		}
		if err := gm.db.Get(&myQueueTok, `SELECT queue_token FROM matchmaking_queue WHERE id=$1`, myQueueID); err == nil && myQueueTok.QueueToken.Valid && myQueueTok.QueueToken.String != "" {
			myEphemeral = myQueueTok.QueueToken.String
		}

		// Create GameState (Player1 is opponent to preserve previous ordering)
		oppDBID := 0
		if oppQueue.PlayerID.Valid {
			oppDBID = int(oppQueue.PlayerID.Int64)
		}
		game := NewGame(
			gameID,
			gameToken,
			opponentEphemeral,
			oppQueue.PhoneNumber,
			player1Token,
			oppDBID, // DB ID for opponent
			oppPlayer.DisplayName,
			myEphemeral,
			myPhone,
			player2Token,
			myDBPlayerID,
			myDisplayName,
			stakeAmount,
		)

		// Save to memory and Redis, and create session row if possible
		gm.mu.Lock()
		gm.games[gameID] = game
		gm.playerToGame[opponentEphemeral] = gameID
		gm.playerToGame[myEphemeral] = gameID
		gm.mu.Unlock()

		// Persist a game_sessions row if we have DB player ids
		var sessionID int
		if gm.db != nil && (!oppQueue.PlayerID.Valid || myDBPlayerID <= 0) {
			log.Printf("[DB] Skipping DB session creation for in-memory match (oppPlayerID.Valid=%v, myDBPlayerID=%d) — game will remain in-memory", oppQueue.PlayerID.Valid, myDBPlayerID)
		}
		if gm.db != nil && oppQueue.PlayerID.Valid && myDBPlayerID > 0 {
			tx, err := gm.db.Beginx()
			if err != nil {
				log.Printf("[DB] Failed to begin tx for match initialization: %v", err)
				// attempt to set queues back to queued and continue
				if _, err2 := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id IN ($1,$2)`, oppID, myQueueID); err2 != nil {
					log.Printf("[DB] Failed to reset queue rows after tx begin failure: %v", err2)
				}
			} else {
				// Insert session row within tx
				if err := tx.QueryRowx(`INSERT INTO game_sessions (game_token, player1_id, player2_id, stake_amount, status, created_at, expiry_time) VALUES ($1, $2, $3, $4, $5, NOW(), $6) RETURNING id`,
					gameToken, int(oppQueue.PlayerID.Int64), myDBPlayerID, stakeAmount, string(StatusWaiting), game.ExpiresAt).Scan(&sessionID); err != nil {
					log.Printf("[DB] Failed to create game_session for queue pairing: %v", err)
					tx.Rollback()
					// revert queue status
					if _, err2 := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id IN ($1,$2)`, oppID, myQueueID); err2 != nil {
						log.Printf("[DB] Failed to reset queue rows after session insert failure: %v", err2)
					}
				} else {
					// Reserve opponent stake
					if err := gm.reserveStakeForSession(tx, int(oppQueue.PlayerID.Int64), oppID, sessionID, stakeAmount); err != nil {
						log.Printf("[DB] Failed to reserve opponent stake: %v", err)
						tx.Rollback()
						if _, err2 := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id IN ($1,$2)`, oppID, myQueueID); err2 != nil {
							log.Printf("[DB] Failed to reset queue rows after opponent reserve failure: %v", err2)
						}
						// continue the match loop to try next opponent
						continue
					}

					// Reserve my stake
					if err := gm.reserveStakeForSession(tx, myDBPlayerID, myQueueID, sessionID, stakeAmount); err != nil {
						log.Printf("[DB] Failed to reserve my stake: %v", err)
						tx.Rollback()
						if _, err2 := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id IN ($1,$2)`, oppID, myQueueID); err2 != nil {
							log.Printf("[DB] Failed to reset queue rows after my reserve failure: %v", err2)
						}
						continue
					}

					// All good - update both queue rows and commit
					if _, err := tx.Exec(`UPDATE matchmaking_queue SET status='matched', matched_at=NOW(), session_id=$1 WHERE id=$2`, sessionID, oppID); err != nil {
						log.Printf("[DB] Failed to update opponent queue %d: %v", oppID, err)
						tx.Rollback()
						if _, err2 := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id=$1`, myQueueID); err2 != nil {
							log.Printf("[DB] Failed to reset my queue row after update failure: %v", err2)
						}
					} else {
						if _, err := tx.Exec(`UPDATE matchmaking_queue SET status='matched', matched_at=NOW(), session_id=$1 WHERE id=$2`, sessionID, myQueueID); err != nil {
							log.Printf("[DB] Failed to update my queue %d: %v", myQueueID, err)
							tx.Rollback()
							if _, err2 := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id=$1`, oppID); err2 != nil {
								log.Printf("[DB] Failed to reset opponent queue row after update failure: %v", err2)
							}
						} else {
							if err := tx.Commit(); err != nil {
								log.Printf("[DB] Failed to commit match initialization tx for session %d: %v", sessionID, err)
								// attempt to reset queue rows
								if _, err2 := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id IN ($1,$2)`, oppID, myQueueID); err2 != nil {
									log.Printf("[DB] Failed to reset queue rows after commit failure: %v", err2)
								}
							} else {
								// Remove in-memory queue entries for both players (they are now matched)
								gm.RemoveQueueEntriesByPhone(stakeAmount, oppQueue.PhoneNumber)
								gm.RemoveQueueEntriesByPhone(stakeAmount, myPhone)
								// Set the in-memory game session id and persist the updated state
								gm.mu.Lock()
								if g, ok := gm.games[gameID]; ok {
									g.SessionID = sessionID
									log.Printf("[DB] Session %d attached to in-memory game %s", sessionID, gameID)
									go g.SaveToRedis()
								}
								gm.mu.Unlock()

								// Send match SMS notifications if we have a persisted session
								if sessionID > 0 && sms.Default != nil {
									oppName := oppPlayer.DisplayName
									if oppName == "" {
										oppName = oppQueue.PhoneNumber
									}
									myName := myDisplayName
									if myName == "" {
										myName = myPhone
									}

									baseURL := gm.config.FrontendURL
									player1Link := baseURL + "/g/" + gameToken + "?pt=" + player1Token
									player2Link := baseURL + "/g/" + gameToken + "?pt=" + player2Token

									go func(oppPhone, joinerPhone, link1, link2, oppName, joinerName string, stake int) {
										ctx := context.Background()
										msgOpp := fmt.Sprintf("Matched on PlayMatatu vs %s! Stake %d UGX. Join: %s", joinerName, stake, link1)
										if msgID, err := sms.SendSMS(ctx, oppPhone, msgOpp); err != nil {
											log.Printf("[SMS] Failed to send match SMS to %s: %v", oppPhone, err)
										} else {
											log.Printf("[SMS] Match SMS sent to %s msg_id=%s", oppPhone, msgID)
										}
										msgMe := fmt.Sprintf("Matched on PlayMatatu vs %s! Stake %d UGX. Join: %s", oppName, stake, link2)
										if msgID, err := sms.SendSMS(ctx, joinerPhone, msgMe); err != nil {
											log.Printf("[SMS] Failed to send match SMS to %s: %v", joinerPhone, err)
										} else {
											log.Printf("[SMS] Match SMS sent to %s msg_id=%s", joinerPhone, msgID)
										}
									}(oppQueue.PhoneNumber, myPhone, player1Link, player2Link, oppName, myName, stakeAmount)
								}
							}
						}
					}
				}

				// Build match result
				baseURL := gm.config.FrontendURL
				player1Link := baseURL + "/g/" + gameToken + "?pt=" + player1Token
				player2Link := baseURL + "/g/" + gameToken + "?pt=" + player2Token

				return &MatchResult{
					GameID:             gameID,
					GameToken:          gameToken,
					Player1ID:          opponentEphemeral,
					Player1Token:       player1Token,
					Player1Link:        player1Link,
					Player1DisplayName: oppPlayer.DisplayName,
					Player2ID:          myEphemeral,
					Player2Token:       player2Token,
					Player2Link:        player2Link,
					Player2DisplayName: myDisplayName,
					StakeAmount:        stakeAmount,
					ExpiresAt:          game.ExpiresAt,
					SessionID:          sessionID,
				}, nil
			}
		}
	}

	// Nothing matched after attempts — push own id and return
	if err := gm.rdb.LPush(ctx, key, myQueueID).Err(); err != nil {
		log.Printf("[MATCH] Final push of own queue id %d to Redis key %s failed: %v", myQueueID, key, err)
	}
	return nil, nil
}

// claimJobFromRedis atomically pops an id from the main queue and moves it to processing with a timestamp
func (gm *GameManager) claimJobFromRedis(stake int) (int, error) {
	ctx := context.Background()
	key := fmt.Sprintf("queue:stake:%d", stake)
	processingKey := fmt.Sprintf("processing:stake:%d", stake)
	processingTsKey := fmt.Sprintf("processing_ts:stake:%d", stake)
	// current timestamp in seconds
	ts := time.Now().Unix()
	script := `local id = redis.call('RPOP', KEYS[1]); if not id then return nil end; redis.call('LPUSH', KEYS[2], id); redis.call('ZADD', KEYS[3], ARGV[1], id); return id`
	res, err := gm.rdb.Eval(ctx, script, []string{key, processingKey, processingTsKey}, ts).Result()
	if err == redis.Nil {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	idStr, ok := res.(string)
	if !ok {
		return 0, fmt.Errorf("unexpected claim result type: %T", res)
	}
	id, err := strconv.Atoi(idStr)
	if err != nil {
		return 0, err
	}
	return id, nil
}

// RequeueStuckProcessing checks for items in processing that have exceeded visibility timeout and requeues them
func (gm *GameManager) RequeueStuckProcessing() (int, error) {
	if gm.rdb == nil || gm.db == nil {
		return 0, nil
	}

	ctx := context.Background()
	// Find stake buckets that have matching rows (we only need to check those)
	rows, err := gm.db.Queryx(`SELECT DISTINCT stake_amount FROM matchmaking_queue WHERE status='matching'`)
	if err != nil {
		return 0, err
	}
	requeued := 0
	for rows.Next() {
		var stakeAmt float64
		if err := rows.Scan(&stakeAmt); err != nil {
			continue
		}
		stake := int(stakeAmt)
		processingTsKey := fmt.Sprintf("processing_ts:stake:%d", stake)
		processingKey := fmt.Sprintf("processing:stake:%d", stake)
		queueKey := fmt.Sprintf("queue:stake:%d", stake)

		threshold := time.Now().Add(-time.Duration(gm.config.QueueProcessingVisibility) * time.Second).Unix()
		ids, err := gm.rdb.ZRangeByScore(ctx, processingTsKey, &redis.ZRangeBy{Min: "-inf", Max: fmt.Sprintf("%d", threshold)}).Result()
		if err != nil {
			log.Printf("[RECOVER] Failed to ZRANGEBYSCORE on %s: %v", processingTsKey, err)
			continue
		}

		for _, idStr := range ids {
			id, err := strconv.Atoi(idStr)
			if err != nil {
				continue
			}

			// Try to mark DB row back to queued if still matching
			if _, err := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id=$1 AND status='matching'`, id); err != nil {
				log.Printf("[RECOVER] Failed to update queue row %d back to queued: %v", id, err)
			}

			// Remove from processing list and zset, push back to main queue
			if err := gm.rdb.LRem(ctx, processingKey, 0, id).Err(); err != nil {
				log.Printf("[RECOVER] Failed to LREM id %d from %s: %v", id, processingKey, err)
			}
			if err := gm.rdb.ZRem(ctx, processingTsKey, id).Err(); err != nil {
				log.Printf("[RECOVER] Failed to ZREM id %d from %s: %v", id, processingTsKey, err)
			}
			if err := gm.rdb.RPush(ctx, queueKey, id).Err(); err != nil {
				log.Printf("[RECOVER] Failed to RPush id %d back onto %s: %v", id, queueKey, err)
			}
			requeued++
		}
	}
	return requeued, nil
}

// StartProcessingRecoveryChecker runs a background job to requeue stuck processing items
func (gm *GameManager) StartProcessingRecoveryChecker() {
	if gm.db == nil || gm.rdb == nil {
		return
	}
	interval := time.Duration(gm.config.QueueProcessingVisibility/2) * time.Second
	if interval < time.Second*5 {
		interval = 5 * time.Second
	}
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			if n, err := gm.RequeueStuckProcessing(); err != nil {
				log.Printf("[RECOVER] Error requeueing stuck processing items: %v", err)
			} else if n > 0 {
				log.Printf("[RECOVER] Requeued %d stuck items", n)
			}
		}
	}()
}

// reserveStakeForSession debits a player's PLAYER_WINNINGS and credits ESCROW inside the provided tx.
func (gm *GameManager) reserveStakeForSession(tx *sqlx.Tx, playerDBID, queueID, sessionID, stakeAmount int) error {
	// Get account rows (ensure they exist)
	escrowAcc, err := accounts.GetOrCreateAccount(gm.db, accounts.AccountEscrow, nil)
	if err != nil {
		return err
	}
	playerWinningsAcc, err := accounts.GetOrCreateAccount(gm.db, accounts.AccountPlayerWinnings, &playerDBID)
	if err != nil {
		return err
	}
	// Perform transfer within tx
	if err := accounts.Transfer(tx, playerWinningsAcc.ID, escrowAcc.ID, float64(stakeAmount), "SESSION", sql.NullInt64{Int64: int64(sessionID), Valid: true}, "Stake moved to escrow on match init"); err != nil {
		return err
	}
	// Insert STAKE_IN escrow ledger row referencing queue and session

	if _, err := tx.Exec(`INSERT INTO escrow_ledger (session_id, entry_type, player_id, amount, balance_after, description, created_at, queue_id) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)`, sessionID, "STAKE_IN", playerDBID, float64(stakeAmount), 0.0, "Stake moved to escrow on match init", queueID); err != nil {
		return err
	}
	return nil
}

// AddQueueEntry adds an entry to the in-memory matchmaking queue for the given stake
func (gm *GameManager) AddQueueEntry(stakeAmount int, entry QueueEntry) {
	gm.mu.Lock()
	defer gm.mu.Unlock()
	if _, exists := gm.matchmakingQueue[stakeAmount]; !exists {
		gm.matchmakingQueue[stakeAmount] = []QueueEntry{}
	}
	gm.matchmakingQueue[stakeAmount] = append(gm.matchmakingQueue[stakeAmount], entry)
}

// RemoveQueueEntriesByPhone removes any queue entries for a given phone under a stake amount
func (gm *GameManager) RemoveQueueEntriesByPhone(stakeAmount int, phone string) int {
	gm.mu.Lock()
	defer gm.mu.Unlock()
	removed := 0
	queue, exists := gm.matchmakingQueue[stakeAmount]
	if !exists || len(queue) == 0 {
		return removed
	}
	newQueue := []QueueEntry{}
	for _, e := range queue {
		if e.PhoneNumber == phone {
			removed++
			continue
		}
		newQueue = append(newQueue, e)
	}
	gm.matchmakingQueue[stakeAmount] = newQueue
	return removed
}

// JoinPrivateMatch attempts to atomically claim a queued private entry identified by matchCode
// and pairs it with the provided myQueueID (the joiner's queued row). It creates a game session
// and reserves both stakes inside a DB transaction, returning a MatchResult on success.
func (gm *GameManager) JoinPrivateMatch(matchCode string, myQueueID int, myPhone string, myDBPlayerID int, myDisplayName string, stakeAmount int) (*MatchResult, error) {
	if gm.db == nil {
		return nil, fmt.Errorf("db not available")
	}

	// Begin a DB transaction to claim the private entry and create the session atomically
	tx, err := gm.db.Beginx()
	if err != nil {
		return nil, fmt.Errorf("failed to begin tx: %v", err)
	}
	defer func() {
		if err != nil {
			tx.Rollback()
		}
	}()

	var oppQueue struct {
		ID            int            `db:"id"`
		PlayerID      sql.NullInt64  `db:"player_id"`
		PhoneNumber   string         `db:"phone_number"`
		TransactionID sql.NullInt64  `db:"transaction_id"`
		QueueToken    sql.NullString `db:"queue_token"`
		StakeAmount   float64        `db:"stake_amount"`
	}

	// Claim the private queued row by changing status to 'matching'
	if err = tx.Get(&oppQueue, `UPDATE matchmaking_queue SET status='matching' WHERE match_code=$1 AND status='queued' AND is_private=TRUE AND expires_at > NOW() RETURNING id, player_id, phone_number, transaction_id, queue_token, stake_amount`, matchCode); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("match code not found or expired")
		}
		return nil, fmt.Errorf("db claim error: %v", err)
	}

	// Prevent self-join
	if oppQueue.PhoneNumber == myPhone {
		return nil, fmt.Errorf("cannot join your own match")
	}

	// Ensure stake parity
	if int(oppQueue.StakeAmount) != stakeAmount {
		return nil, fmt.Errorf("stake mismatch: code requires %d", int(oppQueue.StakeAmount))
	}

	// Load opponent player info
	var oppPlayer models.Player
	oppDBID := 0
	if oppQueue.PlayerID.Valid {
		oppDBID = int(oppQueue.PlayerID.Int64)
		if err := tx.Get(&oppPlayer, `SELECT id, phone_number, display_name FROM players WHERE id=$1`, oppDBID); err != nil {
			log.Printf("[MATCH] Failed to load opponent player %d: %v", oppDBID, err)
		}
	} else {
		// If opponent has no DB identity, abort to avoid inconsistent financial operations
		return nil, fmt.Errorf("opponent identity not available")
	}

	// Prepare in-memory game similar to TryMatchFromRedis
	gameID := generateGameID()
	gameToken := generateToken(16)
	player1Token := generateToken(16)
	player2Token := generateToken(16)

	opponentEphemeral := "player_" + oppQueue.PhoneNumber[len(oppQueue.PhoneNumber)-4:] + "_" + generateToken(4)
	myEphemeral := "player_" + myPhone[len(myPhone)-4:] + "_" + generateToken(4)

	if oppQueue.QueueToken.Valid && oppQueue.QueueToken.String != "" {
		opponentEphemeral = oppQueue.QueueToken.String
	}

	var myQueueTok struct {
		QueueToken sql.NullString `db:"queue_token"`
	}
	if err2 := gm.db.Get(&myQueueTok, `SELECT queue_token FROM matchmaking_queue WHERE id=$1`, myQueueID); err2 == nil && myQueueTok.QueueToken.Valid && myQueueTok.QueueToken.String != "" {
		myEphemeral = myQueueTok.QueueToken.String
	}

	// Create GameState (opponent is player1 to preserve existing ordering)
	game := NewGame(
		gameID,
		gameToken,
		opponentEphemeral,
		oppQueue.PhoneNumber,
		player1Token,
		oppDBID,
		oppPlayer.DisplayName,
		myEphemeral,
		myPhone,
		player2Token,
		myDBPlayerID,
		myDisplayName,
		stakeAmount,
	)

	// Save to memory
	gm.mu.Lock()
	gm.games[gameID] = game
	gm.playerToGame[opponentEphemeral] = gameID
	gm.playerToGame[myEphemeral] = gameID
	gm.mu.Unlock()

	// Persist session row and reserve stakes inside the transaction
	var sessionID int
	if err = tx.QueryRowx(`INSERT INTO game_sessions (game_token, player1_id, player2_id, stake_amount, status, created_at, expiry_time) VALUES ($1, $2, $3, $4, $5, NOW(), $6) RETURNING id`, gameToken, oppDBID, myDBPlayerID, stakeAmount, string(StatusWaiting), game.ExpiresAt).Scan(&sessionID); err != nil {
		log.Printf("[DB] Failed to create game_session for private match: %v", err)
		tx.Rollback()
		// Attempt to reset opponent row to queued
		if _, err2 := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id=$1`, oppQueue.ID); err2 != nil {
			log.Printf("[DB] Failed to reset opponent queue %d after session insert failure: %v", oppQueue.ID, err2)
		}
		return nil, fmt.Errorf("failed to create session")
	}

	// Reserve opponent stake
	if err = gm.reserveStakeForSession(tx, oppDBID, oppQueue.ID, sessionID, stakeAmount); err != nil {
		log.Printf("[DB] Failed to reserve opponent stake for private match: %v", err)
		tx.Rollback()
		if _, err2 := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id=$1`, oppQueue.ID); err2 != nil {
			log.Printf("[DB] Failed to reset opponent queue %d after reserve failure: %v", oppQueue.ID, err2)
		}
		return nil, fmt.Errorf("failed to reserve opponent stake")
	}

	// Reserve my stake
	if err = gm.reserveStakeForSession(tx, myDBPlayerID, myQueueID, sessionID, stakeAmount); err != nil {
		log.Printf("[DB] Failed to reserve my stake for private match: %v", err)
		tx.Rollback()
		if _, err2 := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id=$1`, oppQueue.ID); err2 != nil {
			log.Printf("[DB] Failed to reset opponent queue %d after my reserve failure: %v", oppQueue.ID, err2)
		}
		return nil, fmt.Errorf("failed to reserve my stake")
	}

	// All good - update both queue rows and commit
	if _, err = tx.Exec(`UPDATE matchmaking_queue SET status='matched', matched_at=NOW(), session_id=$1 WHERE id=$2`, sessionID, oppQueue.ID); err != nil {
		log.Printf("[DB] Failed to update opponent queue %d: %v", oppQueue.ID, err)
		tx.Rollback()
		if _, err2 := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id=$1`, myQueueID); err2 != nil {
			log.Printf("[DB] Failed to reset my queue row after update failure: %v", err2)
		}
		return nil, fmt.Errorf("failed to update opponent queue")
	}
	if _, err = tx.Exec(`UPDATE matchmaking_queue SET status='matched', matched_at=NOW(), session_id=$1 WHERE id=$2`, sessionID, myQueueID); err != nil {
		log.Printf("[DB] Failed to update my queue %d: %v", myQueueID, err)
		tx.Rollback()
		if _, err2 := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id=$1`, oppQueue.ID); err2 != nil {
			log.Printf("[DB] Failed to reset opponent queue row after update failure: %v", err2)
		}
		return nil, fmt.Errorf("failed to update my queue")
	}

	if err = tx.Commit(); err != nil {
		log.Printf("[DB] Failed to commit private match initialization: %v", err)
		if _, err2 := gm.db.Exec(`UPDATE matchmaking_queue SET status='queued' WHERE id IN ($1,$2)`, oppQueue.ID, myQueueID); err2 != nil {
			log.Printf("[DB] Failed to reset queue rows after commit failure: %v", err2)
		}
		return nil, fmt.Errorf("failed to commit match initialization")
	}

	// Remove in-memory queue entries for both players (they are now matched)
	gm.RemoveQueueEntriesByPhone(stakeAmount, oppQueue.PhoneNumber)
	gm.RemoveQueueEntriesByPhone(stakeAmount, myPhone)

	// Attach session id to in-memory game and persist
	gm.mu.Lock()
	if g, ok := gm.games[gameID]; ok {
		g.SessionID = sessionID
		log.Printf("[DB] Session %d attached to in-memory game %s (private match)", sessionID, gameID)
		go g.SaveToRedis()
	}
	gm.mu.Unlock()

	// Send match SMS notifications for private matches (best-effort)
	if sessionID > 0 && sms.Default != nil {
		oppName := oppPlayer.DisplayName
		if oppName == "" {
			oppName = oppQueue.PhoneNumber
		}
		myName := myDisplayName
		if myName == "" {
			myName = myPhone
		}

		baseURL := gm.config.FrontendURL
		player1Link := baseURL + "/g/" + gameToken + "?pt=" + player1Token
		player2Link := baseURL + "/g/" + gameToken + "?pt=" + player2Token

		go func(oppPhone, joinerPhone, link1, link2, oppName, joinerName string, stake int) {
			ctx := context.Background()
			msgOpp := fmt.Sprintf("Private match found with %s! Stake %d UGX. Join: %s", joinerName, stake, link1)
			if msgID, err := sms.SendSMS(ctx, oppPhone, msgOpp); err != nil {
				log.Printf("[SMS] Failed to send private match SMS to %s: %v", oppPhone, err)
			} else {
				log.Printf("[SMS] Private match SMS sent to %s msg_id=%s", oppPhone, msgID)
			}
			msgMe := fmt.Sprintf("Private match found with %s! Stake %d UGX. Join: %s", oppName, stake, link2)
			if msgID, err := sms.SendSMS(ctx, joinerPhone, msgMe); err != nil {
				log.Printf("[SMS] Failed to send private match SMS to %s: %v", joinerPhone, err)
			} else {
				log.Printf("[SMS] Private match SMS sent to %s msg_id=%s", joinerPhone, msgID)
			}
		}(oppQueue.PhoneNumber, myPhone, player1Link, player2Link, oppName, myName, stakeAmount)
	}

	// Build match result
	baseURL := gm.config.FrontendURL
	player1Link := baseURL + "/g/" + gameToken + "?pt=" + player1Token
	player2Link := baseURL + "/g/" + gameToken + "?pt=" + player2Token

	return &MatchResult{
		GameID:             gameID,
		GameToken:          gameToken,
		Player1ID:          opponentEphemeral,
		Player1Token:       player1Token,
		Player1Link:        player1Link,
		Player1DisplayName: oppPlayer.DisplayName,
		Player2ID:          myEphemeral,
		Player2Token:       player2Token,
		Player2Link:        player2Link,
		Player2DisplayName: myDisplayName,
		StakeAmount:        stakeAmount,
		ExpiresAt:          game.ExpiresAt,
		SessionID:          sessionID,
	}, nil
}

// ProcessWinnerPayout handles the escrow → winnings payout with tax deduction
func (gm *GameManager) ProcessWinnerPayout(sessionID, winnerPlayerID, stakeAmount int) error {
	if gm.db == nil {
		return fmt.Errorf("db not available")
	}

	pot := float64(stakeAmount * 2) // Full pot (both players' stakes)
	taxRate := float64(gm.config.PayoutTaxPercent) / 100.0
	taxAmount := pot * taxRate
	winningsNet := pot - taxAmount

	tx, err := gm.db.Beginx()
	if err != nil {
		return fmt.Errorf("failed to begin tx: %w", err)
	}
	defer tx.Rollback()

	// Idempotency check: skip if payout already processed
	var cnt int
	if err := tx.Get(&cnt, `SELECT COUNT(*) FROM escrow_ledger WHERE session_id=$1 AND entry_type='PAYOUT'`, sessionID); err != nil {
		return fmt.Errorf("failed to check existing payouts: %w", err)
	}
	if cnt > 0 {
		log.Printf("[PAYOUT] Payout already processed for session %d", sessionID)
		return nil // Already paid, not an error
	}

	// Get accounts
	escrowAcc, err := accounts.GetOrCreateAccount(gm.db, accounts.AccountEscrow, nil)
	if err != nil {
		return fmt.Errorf("failed to get escrow account: %w", err)
	}

	taxAcc, err := accounts.GetOrCreateAccount(gm.db, accounts.AccountTax, nil)
	if err != nil {
		return fmt.Errorf("failed to get tax account: %w", err)
	}

	winningsAcc, err := accounts.GetOrCreateAccount(gm.db, accounts.AccountPlayerWinnings, &winnerPlayerID)
	if err != nil {
		return fmt.Errorf("failed to get player winnings account: %w", err)
	}

	// Transfer: ESCROW → TAX (15%)
	if err := accounts.Transfer(tx, escrowAcc.ID, taxAcc.ID, taxAmount, "SESSION", sql.NullInt64{Int64: int64(sessionID), Valid: true}, "Payout tax"); err != nil {
		return fmt.Errorf("failed to transfer tax: %w", err)
	}

	// Transfer: ESCROW → PLAYER_WINNINGS (85% after tax)
	if err := accounts.Transfer(tx, escrowAcc.ID, winningsAcc.ID, winningsNet, "SESSION", sql.NullInt64{Int64: int64(sessionID), Valid: true}, "Winner payout (after tax)"); err != nil {
		return fmt.Errorf("failed to transfer winnings: %w", err)
	}

	// Record in escrow ledger
	if _, err := tx.Exec(`INSERT INTO escrow_ledger (session_id, entry_type, player_id, amount, balance_after, description, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
		sessionID, "PAYOUT", winnerPlayerID, winningsNet, 0.0, "Winner payout"); err != nil {
		return fmt.Errorf("failed to insert escrow ledger entry: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit tx: %w", err)
	}

	log.Printf("[PAYOUT] Successfully paid %.2f UGX (%.2f%% of %.2f pot) to player %d for session %d", winningsNet, (1.0-taxRate)*100, pot, winnerPlayerID, sessionID)

	// Winnings are now accumulated in player account for manual withdrawal
	return nil
}
