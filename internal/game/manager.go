package game

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/playmatatu/backend/internal/config"
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
