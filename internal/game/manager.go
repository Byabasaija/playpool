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
	"github.com/playmatatu/backend/internal/config"
	"github.com/playmatatu/backend/internal/models"
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
	PlayerID    string
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
			if entry.PlayerID == playerID {
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
					opponent.PlayerID,
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
				gm.playerToGame[opponent.PlayerID] = gameID
				gm.playerToGame[playerID] = gameID

				// Log the mapping for debugging
				log.Printf("[MATCHMAKING] Game created: %s", gameID)
				log.Printf("[MATCHMAKING] Player1: %s → Game: %s", opponent.PlayerID, gameID)
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
						game.SessionID = sessionID
						log.Printf("[DB] Created game_session %d for game %s", sessionID, gameID)
					}
				}

				// Generate game links for both players
				baseURL := gm.config.FrontendURL
				player1Link := baseURL + "/g/" + gameToken + "?pt=" + player1Token
				player2Link := baseURL + "/g/" + gameToken + "?pt=" + player2Token

				return &MatchResult{
					GameID:             gameID,
					GameToken:          gameToken,
					Player1ID:          opponent.PlayerID,
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
		PlayerID:    playerID,
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

// LeaveQueue removes a player from the matchmaking queue
func (gm *GameManager) LeaveQueue(playerID string) bool {
	gm.mu.Lock()
	defer gm.mu.Unlock()

	for stake, queue := range gm.matchmakingQueue {
		for i, entry := range queue {
			if entry.PlayerID == playerID {
				gm.matchmakingQueue[stake] = append(queue[:i], queue[i+1:]...)
				return true
			}
		}
	}
	return false
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

// IsPlayerInQueue checks if a player is in the matchmaking queue
func (gm *GameManager) IsPlayerInQueue(playerID string) bool {
	gm.mu.RLock()
	defer gm.mu.RUnlock()

	for _, queue := range gm.matchmakingQueue {
		for _, entry := range queue {
			if entry.PlayerID == playerID {
				return true
			}
		}
	}
	return false
}

// GetPlayerQueuePosition returns the player's position in queue (1-indexed) or 0 if not in queue
func (gm *GameManager) GetPlayerQueuePosition(playerID string, stakeAmount int) int {
	gm.mu.RLock()
	defer gm.mu.RUnlock()

	if queue, exists := gm.matchmakingQueue[stakeAmount]; exists {
		for i, entry := range queue {
			if entry.PlayerID == playerID {
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
	gm.mu.Lock()
	defer gm.mu.Unlock()

	now := time.Now()
	for gameID, game := range gm.games {
		if game.Status == StatusWaiting && now.After(game.ExpiresAt) {
			// Game expired - apply no-show penalties
			log.Printf("[EXPIRY] Game %s expired", gameID)
			p1ShowedUp := game.Player1.ShowedUp
			p2ShowedUp := game.Player2.ShowedUp

			if p1ShowedUp && !p2ShowedUp {
				// Player 1 showed up, Player 2 no-show
				// TODO: Full refund to P1, P2 pays 5% fee
				// log.Printf("[DUMMY REFUND] Full refund to %s, 95%% refund to %s (no-show fee)", game.Player1.PhoneNumber, game.Player2.PhoneNumber)
			} else if !p1ShowedUp && p2ShowedUp {
				// Player 2 showed up, Player 1 no-show
				// log.Printf("[DUMMY REFUND] Full refund to %s, 95%% refund to %s (no-show fee)", game.Player2.PhoneNumber, game.Player1.PhoneNumber)
			} else {
				// Both no-show or both showed but didn't start
				// log.Printf("[DUMMY REFUND] Full refund to both %s and %s", game.Player1.PhoneNumber, game.Player2.PhoneNumber)
			}

			game.Status = StatusCancelled
			now := time.Now()
			game.CompletedAt = &now

			// Clean up
			delete(gm.playerToGame, game.Player1.ID)
			delete(gm.playerToGame, game.Player2.ID)
			// Keep game in memory for a bit for stats/logging
			// TODO: Move to database archive
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
			// TODO: Trigger payout to winner
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
	rows, err := gm.db.Queryx(`SELECT id, stake_amount FROM matchmaking_queue WHERE status='queued' AND expires_at > NOW() ORDER BY created_at`)
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

// ExpireQueuedEntries moves expired queued rows to status='expired' and removes them from Redis lists
func (gm *GameManager) ExpireQueuedEntries() (int, error) {
	if gm.db == nil || gm.rdb == nil {
		return 0, nil
	}

	ctx := context.Background()
	// Atomically update expired rows and return their ids and stake_amounts
	rows, err := gm.db.Queryx(`UPDATE matchmaking_queue SET status='expired' WHERE expires_at < NOW() AND status='queued' RETURNING id, stake_amount`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	removed := 0
	for rows.Next() {
		var id int
		var stakeAmount float64
		if err := rows.Scan(&id, &stakeAmount); err != nil {
			log.Printf("[QUEUE EXPIRY] Scan error: %v", err)
			continue
		}
		key := fmt.Sprintf("queue:stake:%d", int(stakeAmount))
		if err := gm.rdb.LRem(ctx, key, 0, id).Err(); err != nil {
			log.Printf("[QUEUE EXPIRY] Failed to LREM id %d from %s: %v", id, key, err)
		}
		removed++
	}

	if removed > 0 {
		log.Printf("[QUEUE EXPIRY] Expired %d queued entries", removed)
	}
	return removed, nil
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

		if winnerDBID == 0 {
			log.Printf("[DB] SaveFinalGameState: could not resolve winner DB id for winner=%s (session=%d)", g.Winner, g.SessionID)
		}

		if winnerDBID > 0 {
			_, err = gm.db.Exec(`UPDATE game_sessions SET status=$1, winner_id=$2, completed_at=NOW() WHERE id=$3`, string(g.Status), winnerDBID, g.SessionID)
		} else {
			_, err = gm.db.Exec(`UPDATE game_sessions SET status=$1, completed_at=NOW() WHERE id=$2`, string(g.Status), g.SessionID)
		}
		if err != nil {
			log.Printf("[DB] Failed to update game_sessions %d: %v", g.SessionID, err)
		}

		// After updating game_sessions, add payout transaction placeholder and update player aggregates
		if winnerDBID > 0 {
			prize := int(float64(g.StakeAmount*2) * 0.9) // 10% commission
			_, err = gm.db.Exec(`INSERT INTO transactions (player_id, transaction_type, amount, status, created_at) VALUES ($1,'PAYOUT',$2,'PENDING',NOW())`, winnerDBID, prize)
			if err != nil {
				log.Printf("[DB] Failed to insert payout transaction for session %d: %v", g.SessionID, err)
			}

			_, err = gm.db.Exec(`UPDATE players SET total_games_won = total_games_won + 1, total_winnings = total_winnings + $2 WHERE id = $1`, winnerDBID, prize)
			if err != nil {
				log.Printf("[DB] Failed to update winner aggregates for player %d: %v", winnerDBID, err)
			}
		}

		// Increment games_played for both players if we have DB ids
		if g.Player1 != nil && g.Player2 != nil && g.Player1.DBPlayerID > 0 && g.Player2.DBPlayerID > 0 {
			_, err = gm.db.Exec(`UPDATE players SET total_games_played = total_games_played + 1 WHERE id IN ($1, $2)`, g.Player1.DBPlayerID, g.Player2.DBPlayerID)
			if err != nil {
				log.Printf("[DB] Failed to update games_played for session %d: %v", g.SessionID, err)
			}
		}
	} else {
		_, err = gm.db.Exec(`UPDATE game_sessions SET status=$1 WHERE id=$2`, string(g.Status), g.SessionID)
		if err != nil {
			log.Printf("[DB] Failed to update game_sessions status for %d: %v", g.SessionID, err)
		}
	}
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
		// No Redis or DB available - nothing to do
		return nil, nil
	}

	ctx := context.Background()
	key := fmt.Sprintf("queue:stake:%d", stakeAmount)
	// Try to pop an opponent from Redis. If none, push our own queue id and return.
	for attempts := 0; attempts < 5; attempts++ {
		oppID, err := gm.claimJobFromRedis(stakeAmount)
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
			}
			return nil, nil
		}

		// Try to claim the opponent row in the DB atomically by changing status to 'matching'
		var oppQueue struct {
			ID            int           `db:"id"`
			PlayerID      sql.NullInt64 `db:"player_id"`
			PhoneNumber   string        `db:"phone_number"`
			TransactionID sql.NullInt64 `db:"transaction_id"`
		}

		err = gm.db.Get(&oppQueue, `UPDATE matchmaking_queue SET status='matching' WHERE id=$1 AND status='queued' RETURNING id, player_id, phone_number, transaction_id`, oppID)
		if err != nil {
			// Race - someone else claimed it or it was removed - cleanup processing entry then try next
			if err == sql.ErrNoRows {
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

		// ephemeral player IDs
		opponentEphemeral := "player_" + oppQueue.PhoneNumber[len(oppQueue.PhoneNumber)-4:] + "_" + generateToken(4)
		myEphemeral := "player_" + myPhone[len(myPhone)-4:] + "_" + generateToken(4)

		// Create GameState (Player1 is opponent to preserve previous ordering)
		game := NewGame(
			gameID,
			gameToken,
			opponentEphemeral,
			oppQueue.PhoneNumber,
			player1Token,
			0, // DB ID optional (we can set if available)
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
		if gm.db != nil && oppQueue.PlayerID.Valid && myDBPlayerID > 0 {
			err := gm.db.QueryRowx(`INSERT INTO game_sessions (game_token, player1_id, player2_id, stake_amount, status, created_at, expiry_time) VALUES ($1, $2, $3, $4, $5, NOW(), $6) RETURNING id`,
				gameToken, int(oppQueue.PlayerID.Int64), myDBPlayerID, stakeAmount, string(StatusWaiting), game.ExpiresAt).Scan(&sessionID)
			if err != nil {
				log.Printf("[DB] Failed to create game_session for queue pairing: %v", err)
			} else {
				// Update both queue rows with matched status and session id
				if _, err := gm.db.Exec(`UPDATE matchmaking_queue SET status='matched', matched_at=NOW(), session_id=$1 WHERE id=$2`, sessionID, oppID); err != nil {
					log.Printf("[DB] Failed to update opponent queue %d: %v", oppID, err)
				}
				if _, err := gm.db.Exec(`UPDATE matchmaking_queue SET status='matched', matched_at=NOW(), session_id=$1 WHERE id=$2`, sessionID, myQueueID); err != nil {
					log.Printf("[DB] Failed to update my queue %d: %v", myQueueID, err)
				}
				// Save game state to Redis
				go game.SaveToRedis()
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
