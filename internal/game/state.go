package game

import (
	"errors"
	"fmt"
	"log"
	"sync"
	"time"
)

// GameStatus represents the current state of the game
type GameStatus string

const (
	StatusWaiting    GameStatus = "WAITING"
	StatusInProgress GameStatus = "IN_PROGRESS"
	StatusCompleted  GameStatus = "COMPLETED"
	StatusCancelled  GameStatus = "CANCELLED"
)

// Player represents a player in the game
type Player struct {
	ID             string     `json:"id"`
	PhoneNumber    string     `json:"phone_number"`
	DBPlayerID     int        `json:"db_player_id,omitempty"`
	DisplayName    string     `json:"display_name,omitempty"`
	PlayerToken    string     `json:"-"` // Secure token for authentication
	Hand           []Card     `json:"hand,omitempty"`
	Connected      bool       `json:"connected"`
	ShowedUp       bool       `json:"showed_up"` // True if player connected at least once
	DisconnectedAt *time.Time `json:"-"`         // When player disconnected (for grace period)
}

// CardCount returns the number of cards in the player's hand
func (p *Player) CardCount() int {
	return len(p.Hand)
}

// HasCard checks if the player has a specific card
func (p *Player) HasCard(card Card) bool {
	for _, c := range p.Hand {
		if c.Suit == card.Suit && c.Rank == card.Rank {
			return true
		}
	}
	return false
}

// RemoveCard removes a card from the player's hand
func (p *Player) RemoveCard(card Card) bool {
	for i, c := range p.Hand {
		if c.Suit == card.Suit && c.Rank == card.Rank {
			p.Hand = append(p.Hand[:i], p.Hand[i+1:]...)
			return true
		}
	}
	return false
}

// AddCard adds a card to the player's hand
func (p *Player) AddCard(card Card) {
	p.Hand = append(p.Hand, card)
}

// HasPlayableCard checks if the player has any card that can be played
func (p *Player) HasPlayableCard(topCard *Card, currentSuit Suit) bool {
	for _, card := range p.Hand {
		if card.CanPlayOn(topCard, currentSuit) {
			return true
		}
	}
	return false
}

// SpecialEffect represents the effect of a special card
type SpecialEffect struct {
	Type         string `json:"type"`
	SkipOpponent bool   `json:"skip_opponent"`
	DrawCount    int    `json:"draw_count,omitempty"`
	Message      string `json:"message"`
}

// GameState represents the complete state of a Matatu game
type GameState struct {
	ID           string     `json:"id"`
	Token        string     `json:"token"`
	Player1      *Player    `json:"player1"`
	Player2      *Player    `json:"player2"`
	Deck         *Deck      `json:"-"`
	DiscardPile  []Card     `json:"discard_pile"`
	CurrentTurn  string     `json:"current_turn"` // Player ID
	CurrentSuit  Suit       `json:"current_suit"`
	TargetSuit   Suit       `json:"target_suit"` // The "Chop" suit (determined at start)
	TargetCard   Card       `json:"target_card"` // The actual card drawn to determine the chop suit
	DrawStack    int        `json:"draw_stack"`  // For stacking 2s
	Status       GameStatus `json:"status"`
	Winner       string     `json:"winner,omitempty"`
	WinType      string     `json:"win_type,omitempty"` // "classic" or "chop"
	StakeAmount  int        `json:"stake_amount"`
	ExpiresAt    time.Time  `json:"expires_at"` // When game expires if not started (10 min)
	CreatedAt    time.Time  `json:"created_at"`
	StartedAt    *time.Time `json:"started_at,omitempty"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
	LastActivity time.Time  `json:"last_activity"`
	SessionID    int        `json:"session_id,omitempty"`
	mu           sync.RWMutex
}

// NewGame creates a new game state
func NewGame(id, token string,
	player1ID, player1Phone, player1Token string, player1DBID int, player1DisplayName string,
	player2ID, player2Phone, player2Token string, player2DBID int, player2DisplayName string,
	stakeAmount int) *GameState {
	game := &GameState{
		ID:    id,
		Token: token,
		Player1: &Player{
			ID:          player1ID,
			PhoneNumber: player1Phone,
			DBPlayerID:  player1DBID,
			DisplayName: player1DisplayName,
			PlayerToken: player1Token,
			Hand:        []Card{},
			Connected:   false,
			ShowedUp:    false,
		},
		Player2: &Player{
			ID:          player2ID,
			PhoneNumber: player2Phone,
			DBPlayerID:  player2DBID,
			DisplayName: player2DisplayName,
			PlayerToken: player2Token,
			Hand:        []Card{},
			Connected:   false,
			ShowedUp:    false,
		},
		Deck:         NewDeck(),
		DiscardPile:  []Card{},
		DrawStack:    0,
		Status:       StatusWaiting,
		StakeAmount:  stakeAmount,
		ExpiresAt:    time.Now().Add(10 * time.Minute), // 10 minutes to join
		CreatedAt:    time.Now(),
		LastActivity: time.Now(),
	}

	return game
}

// Initialize sets up the game - deals cards and determines target suit
func (g *GameState) Initialize() error {
	g.mu.Lock()
	defer g.mu.Unlock()

	// Deal 7 cards to each player (classic Ugandan Matatu)
	for i := 0; i < 7; i++ {
		card1, err := g.Deck.Draw()
		if err != nil {
			return err
		}
		g.Player1.AddCard(card1)

		card2, err := g.Deck.Draw()
		if err != nil {
			return err
		}
		g.Player2.AddCard(card2)
	}

	// Determine the Target Suit (for \"Chop\" mechanism)
	// Draw cards until we get a non-Seven
	var targetCard Card
	var err error
	for {
		targetCard, err = g.Deck.Draw()
		if err != nil {
			return err
		}

		// If it's a Seven, shuffle it back and draw again
		if targetCard.Rank == Seven {
			g.Deck.AddCards([]Card{targetCard})
			g.Deck.Shuffle()
			continue
		}

		// Non-seven found - this suit becomes the Target Suit
		g.TargetSuit = targetCard.Suit
		g.TargetCard = targetCard // Store the full card
		// Put this card back in the deck (it's not in play)
		g.Deck.AddCards([]Card{targetCard})
		g.Deck.Shuffle()
		break
	}

	// Discard pile starts empty - first player will play any card from their hand
	g.DiscardPile = []Card{}
	g.CurrentSuit = "" // No current suit until first card is played

	// Randomly choose who starts
	if time.Now().UnixNano()%2 == 0 {
		g.CurrentTurn = g.Player1.ID
	} else {
		g.CurrentTurn = g.Player2.ID
	}

	now := time.Now()
	g.StartedAt = &now
	g.Status = StatusInProgress
	g.LastActivity = now

	// Save initial state to Redis
	go g.SaveToRedis()

	return nil
}

// GetTopCard returns the top card of the discard pile
func (g *GameState) GetTopCard() *Card {
	g.mu.RLock()
	defer g.mu.RUnlock()

	if len(g.DiscardPile) == 0 {
		return nil
	}
	return &g.DiscardPile[len(g.DiscardPile)-1]
}

// GetCurrentPlayer returns the player whose turn it is
func (g *GameState) GetCurrentPlayer() *Player {
	g.mu.RLock()
	defer g.mu.RUnlock()

	if g.CurrentTurn == g.Player1.ID {
		return g.Player1
	}
	return g.Player2
}

// GetOpponent returns the opponent of the current player
func (g *GameState) GetOpponent() *Player {
	g.mu.RLock()
	defer g.mu.RUnlock()

	if g.CurrentTurn == g.Player1.ID {
		return g.Player2
	}
	return g.Player1
}

// GetPlayerByID returns the player with the given ID
func (g *GameState) GetPlayerByID(playerID string) *Player {
	g.mu.RLock()
	defer g.mu.RUnlock()

	if g.Player1.ID == playerID {
		return g.Player1
	}
	if g.Player2.ID == playerID {
		return g.Player2
	}
	return nil
}

// SwitchTurn switches the current turn to the other player
func (g *GameState) SwitchTurn() {
	if g.CurrentTurn == g.Player1.ID {
		g.CurrentTurn = g.Player2.ID
	} else {
		g.CurrentTurn = g.Player1.ID
	}
	g.LastActivity = time.Now()
}

// PlayCardResult represents the result of playing a card
type PlayCardResult struct {
	Success        bool           `json:"success"`
	GameOver       bool           `json:"game_over"`
	Winner         string         `json:"winner,omitempty"`
	WinType        string         `json:"win_type,omitempty"`
	PlayerPoints   int            `json:"player_points,omitempty"`
	OpponentPoints int            `json:"opponent_points,omitempty"`
	Effect         *SpecialEffect `json:"effect,omitempty"`
	Message        string         `json:"message,omitempty"`
	CardPlayed     Card           `json:"card_played"`
	NewTopCard     Card           `json:"new_top_card"`
	CurrentSuit    Suit           `json:"current_suit"`
	NextTurn       string         `json:"next_turn"`
}

// CanPlayCard checks if a player can play a specific card
func (g *GameState) CanPlayCard(playerID string, card Card) (bool, string) {
	g.mu.RLock()
	defer g.mu.RUnlock()

	if g.Status != StatusInProgress {
		return false, "Game is not in progress"
	}

	if g.CurrentTurn != playerID {
		return false, "Not your turn"
	}

	player := g.GetPlayerByID(playerID)
	if player == nil {
		return false, "Player not found"
	}

	if !player.HasCard(card) {
		return false, "You don't have that card"
	}

	// If there's a draw stack (from 2s), player must play a 2 or draw
	if g.DrawStack > 0 && card.Rank != Two {
		return false, "Must play a 2 or draw cards"
	}

	topCard := g.GetTopCard()
	if topCard != nil && !card.CanPlayOn(topCard, g.CurrentSuit) {
		return false, "Card doesn't match suit or rank"
	}

	return true, "Valid move"
}

// PlayCard executes a card play
func (g *GameState) PlayCard(playerID string, card Card, declaredSuit Suit) (*PlayCardResult, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	log.Printf("[GAME] PlayCard start - player=%s card=%s", playerID, card.String())

	// Validate the play
	if g.Status != StatusInProgress {
		log.Printf("[GAME] PlayCard aborted - status not in progress: %v", g.Status)
		return nil, errors.New("game is not in progress")
	}

	if g.CurrentTurn != playerID {
		log.Printf("[GAME] PlayCard aborted - not player's turn. currentTurn=%s", g.CurrentTurn)
		return nil, errors.New("not your turn")
	}

	var player, opponent *Player
	if g.Player1.ID == playerID {
		player = g.Player1
		opponent = g.Player2
	} else {
		player = g.Player2
		opponent = g.Player1
	}

	if !player.HasCard(card) {
		log.Printf("[GAME] PlayCard aborted - player doesn't have card: %s", card.String())
		return nil, errors.New("you don't have that card")
	}

	// If there's a draw stack, player must play a 2 or draw
	if g.DrawStack > 0 && card.Rank != Two {
		log.Printf("[GAME] PlayCard aborted - draw stack active and card is not a Two. drawStack=%d", g.DrawStack)
		return nil, errors.New("must play a 2 or draw cards")
	}

	// Check if card can be played
	var topCard *Card
	if len(g.DiscardPile) > 0 {
		last := g.DiscardPile[len(g.DiscardPile)-1]
		topCard = &last
	} else {
		topCard = nil
	}

	// Special-case: if this is an Ace and it's the player's LAST card, allow it to be played
	// (but still enforce draw-stack rule above)
	isLastAce := (card.Rank == Ace && player.CardCount() == 1)
	if !isLastAce {
		if !card.CanPlayOn(topCard, g.CurrentSuit) {
			log.Printf("[GAME] PlayCard aborted - card cannot be played on topCard=%v currentSuit=%v", topCard, g.CurrentSuit)
			return nil, errors.New("card doesn't match suit or rank")
		}
	}

	// Remove card from player's hand
	player.RemoveCard(card)
	log.Printf("[GAME] PlayCard - removed card from player hand. remaining hand size=%d", player.CardCount())

	// Add to discard pile
	g.DiscardPile = append(g.DiscardPile, card)
	log.Printf("[GAME] PlayCard - appended to discard pile. discard size=%d", len(g.DiscardPile))

	// Persist move
	var declared string
	if card.Rank == Ace {
		declared = string(declaredSuit)
	}
	if Manager != nil {
		Manager.RecordMove(g.SessionID, player.DBPlayerID, "PLAY_CARD", card.String(), declared)
	}

	// Update current suit
	// Ace is wild suit - player declares new suit
	if card.Rank == Ace {
		// If this was the player's last card, declared suit is optional (it's a winning play)
		if declaredSuit == "" && player.CardCount() > 0 {
			log.Printf("[GAME] PlayCard aborted - Ace played but no declared suit provided")
			return nil, errors.New("must declare suit for Ace")
		}
		if declaredSuit != "" {
			g.CurrentSuit = declaredSuit
		} else {
			// No declared suit (last-Ace); set to card's suit for consistency
			g.CurrentSuit = card.Suit
		}
	} else {
		g.CurrentSuit = card.Suit
	}
	log.Printf("[GAME] PlayCard - new currentSuit=%v", g.CurrentSuit)

	result := &PlayCardResult{
		Success:     true,
		CardPlayed:  card,
		NewTopCard:  card,
		CurrentSuit: g.CurrentSuit,
	}

	// Check if this is the "Chop" card (7 of Target Suit)
	if card.Rank == Seven && card.Suit == g.TargetSuit {
		log.Printf("[GAME] PlayCard - Chop triggered")
		// Game ends immediately - calculate points
		g.Status = StatusCompleted
		now := time.Now()
		g.CompletedAt = &now

		// Calculate points for both players
		playerPoints := g.calculateHandPoints(player.Hand)
		opponentPoints := g.calculateHandPoints(opponent.Hand)

		// Winner is player with LOWEST points
		if playerPoints < opponentPoints {
			g.Winner = playerID
		} else if opponentPoints < playerPoints {
			g.Winner = opponent.ID
		} else {
			// Tie - player who chopped wins
			g.Winner = playerID
		}
		g.WinType = "chop"

		result.GameOver = true
		result.Winner = g.Winner
		result.WinType = "chop"
		result.PlayerPoints = playerPoints
		result.OpponentPoints = opponentPoints
		result.Effect = &SpecialEffect{
			Type:    "chop",
			Message: "Game Chopped! Counting points...",
		}
		result.NextTurn = ""
		log.Printf("[GAME] PlayCard - chop ended game, winner=%s", g.Winner)

		// Persist final game state
		if Manager != nil {
			Manager.SaveFinalGameState(g)
		}
		return result, nil
	}

	// Check for classic win (no cards left)
	if player.CardCount() == 0 {
		log.Printf("[GAME] PlayCard - classic win by player=%s", playerID)
		g.Status = StatusCompleted
		g.Winner = playerID
		g.WinType = "classic"
		now := time.Now()
		g.CompletedAt = &now

		result.GameOver = true
		result.Winner = playerID
		result.WinType = "classic"
		result.NextTurn = ""
		log.Printf("[GAME] PlayCard - classic win processed")

		// Persist final game state
		if Manager != nil {
			Manager.SaveFinalGameState(g)
		}
		return result, nil
	}

	// Handle special cards
	effect := g.handleSpecialCard(card, opponent)
	result.Effect = effect
	log.Printf("[GAME] PlayCard - special effect: %v", effect)

	// Switch turn unless effect says otherwise
	if effect == nil || !effect.SkipOpponent {
		g.SwitchTurn()
	}
	result.NextTurn = g.CurrentTurn
	log.Printf("[GAME] PlayCard - next turn=%s", g.CurrentTurn)

	// Save state to Redis
	go g.SaveToRedis()
	log.Printf("[GAME] PlayCard - SaveToRedis triggered")

	return result, nil
}

// calculateHandPoints calculates the point value of a hand
func (g *GameState) calculateHandPoints(hand []Card) int {
	total := 0
	for _, card := range hand {
		total += card.PointValue()
	}
	return total
}

// handleSpecialCard handles the effects of special cards
// Classic Ugandan Matatu: 2 (draw stack), Ace (wild suit), Jack (skip), Eight (skip)
func (g *GameState) handleSpecialCard(card Card, opponent *Player) *SpecialEffect {
	switch card.Rank {
	case Two:
		// Non-cumulative draw stack: always set to 2 (do not add)
		g.DrawStack = 2
		return &SpecialEffect{
			Type:         "draw_stack",
			SkipOpponent: false, // Opponent can counter with a 2
			DrawCount:    g.DrawStack,
			Message:      fmt.Sprintf("Opponent must draw %d cards or play a 2!", g.DrawStack),
		}

	case Ace:
		// Ace is wild suit - already handled in PlayCard by setting CurrentSuit
		return &SpecialEffect{
			Type:    "wild_suit",
			Message: "Suit changed to " + string(g.CurrentSuit),
		}
	case Jack:
		// Jack skips opponent's turn
		return &SpecialEffect{
			Type:         "skip",
			SkipOpponent: true,
			Message:      "Jack played! You get another turn!",
		}

	case Eight:
		// Eight skips opponent's turn
		return &SpecialEffect{
			Type:         "skip",
			SkipOpponent: true,
			Message:      "Eight played! You get another turn!",
		}
	}

	return nil
}

// DrawCardResult represents the result of drawing cards
type DrawCardResult struct {
	Success      bool   `json:"success"`
	CardsDrawn   []Card `json:"cards_drawn"`
	Count        int    `json:"count"`
	Message      string `json:"message"`
	NextTurn     string `json:"next_turn"`
	CanPlayDrawn bool   `json:"can_play_drawn"`
}

// DrawCard handles a player drawing cards
// Classic Ugandan Matatu: Keep drawing until you find a playable card
func (g *GameState) DrawCard(playerID string) (*DrawCardResult, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.Status != StatusInProgress {
		return nil, errors.New("game is not in progress")
	}

	if g.CurrentTurn != playerID {
		return nil, errors.New("not your turn")
	}

	var player *Player
	if g.Player1.ID == playerID {
		player = g.Player1
	} else {
		player = g.Player2
	}

	// If there's a draw stack from 2s, draw those cards and lose turn
	if g.DrawStack > 0 {
		drawCount := g.DrawStack
		g.DrawStack = 0

		// Reshuffle if needed
		if g.Deck.Remaining() < drawCount {
			g.reshuffleDiscardPile()
		}

		// Draw penalty cards
		cardsDrawn := []Card{}
		for i := 0; i < drawCount; i++ {
			if g.Deck.Remaining() == 0 {
				break
			}
			card, err := g.Deck.Draw()
			if err != nil {
				break
			}
			player.AddCard(card)
			cardsDrawn = append(cardsDrawn, card)

			// Persist each drawn card as a move
			if Manager != nil {
				Manager.RecordMove(g.SessionID, player.DBPlayerID, "DRAW_CARD", card.String(), "")
			}
		}

		// Switch turn - player loses their turn after drawing penalty
		prev := g.CurrentTurn
		g.SwitchTurn()

		// Save state to Redis
		go g.SaveToRedis()

		// Debug log
		log.Printf("[GAME] DrawCard penalty - player=%s drew=%d prevTurn=%s nextTurn=%s", playerID, len(cardsDrawn), prev, g.CurrentTurn)

		return &DrawCardResult{
			Success:      true,
			CardsDrawn:   cardsDrawn,
			Count:        len(cardsDrawn),
			Message:      "Drew penalty cards",
			NextTurn:     g.CurrentTurn,
			CanPlayDrawn: false,
		}, nil
	}

	// Draw ONE card only - player decides what to do next
	// Reshuffle if needed
	if g.Deck.Remaining() == 0 {
		g.reshuffleDiscardPile()
	}

	// If still no cards, game is "cut" - end with scoring
	if g.Deck.Remaining() == 0 {
		// No more cards - game will be cut
		return &DrawCardResult{
			Success:      false,
			CardsDrawn:   []Card{},
			Count:        0,
			Message:      "No cards left to draw",
			NextTurn:     g.CurrentTurn,
			CanPlayDrawn: false,
		}, nil
	}

	card, err := g.Deck.Draw()
	if err != nil {
		return nil, err
	}
	player.AddCard(card)

	// Persist the single drawn card
	if Manager != nil {
		Manager.RecordMove(g.SessionID, player.DBPlayerID, "DRAW_CARD", card.String(), "")
	}

	result := &DrawCardResult{
		Success:      true,
		CardsDrawn:   []Card{card},
		Count:        1,
		Message:      "Drew 1 card",
		CanPlayDrawn: true,          // Player can choose to play or pass
		NextTurn:     g.CurrentTurn, // Turn stays with player until they pass
	}

	// Save state to Redis
	go g.SaveToRedis()

	// Debug log
	log.Printf("[GAME] DrawCard - player=%s drew=%s currentTurn=%s handSize=%d", playerID, card.String(), g.CurrentTurn, player.CardCount())

	return result, nil
}

// PassTurn allows a player to pass after drawing a playable card
func (g *GameState) PassTurn(playerID string) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	log.Printf("[GAME] PassTurn attempt - player=%s currentTurn=%s", playerID, g.CurrentTurn)

	if g.CurrentTurn != playerID {
		log.Printf("[GAME] PassTurn aborted - not player's turn (current=%s)", g.CurrentTurn)
		return errors.New("not your turn")
	}

	// Resolve player like other handlers to avoid nil/zero ambiguity
	var player *Player
	if g.Player1.ID == playerID {
		player = g.Player1
	} else {
		player = g.Player2
	}

	g.SwitchTurn()

	log.Printf("[GAME] PassTurn - player=%s switched to %s", playerID, g.CurrentTurn)

	// Persist pass move using resolved player DB id
	if Manager != nil && player != nil && player.DBPlayerID > 0 {
		Manager.RecordMove(g.SessionID, player.DBPlayerID, "PASS", "", "")
	}

	// Save state to Redis
	go g.SaveToRedis()

	return nil
}

// reshuffleDiscardPile shuffles the discard pile back into the deck
func (g *GameState) reshuffleDiscardPile() {
	if len(g.DiscardPile) <= 1 {
		return
	}

	// Keep the top card
	topCard := g.DiscardPile[len(g.DiscardPile)-1]
	cardsToShuffle := g.DiscardPile[:len(g.DiscardPile)-1]

	g.Deck.AddCards(cardsToShuffle)
	g.Deck.Shuffle()

	g.DiscardPile = []Card{topCard}
}

// GetGameStateForPlayer returns a sanitized game state for a specific player
// (hides opponent's cards)
func (g *GameState) GetGameStateForPlayer(playerID string) map[string]interface{} {
	g.mu.RLock()
	defer g.mu.RUnlock()

	var myHand []Card
	var opponentCardCount int
	var myID, opponentID string
	var myDisplayName, opponentDisplayName string
	var myConnected, opponentConnected bool

	if g.Player1.ID == playerID {
		myHand = g.Player1.Hand
		opponentCardCount = g.Player2.CardCount()
		myID = g.Player1.ID
		opponentID = g.Player2.ID
		myDisplayName = g.Player1.DisplayName
		opponentDisplayName = g.Player2.DisplayName
		myConnected = g.Player1.Connected
		opponentConnected = g.Player2.Connected
	} else {
		myHand = g.Player2.Hand
		opponentCardCount = g.Player1.CardCount()
		myID = g.Player2.ID
		opponentID = g.Player1.ID
		myDisplayName = g.Player2.DisplayName
		opponentDisplayName = g.Player1.DisplayName
		myConnected = g.Player2.Connected
		opponentConnected = g.Player1.Connected
	}

	// Get last 4 cards from discard pile for visual stacking
	var discardPileCards []Card
	if len(g.DiscardPile) > 0 {
		startIndex := len(g.DiscardPile) - 4
		if startIndex < 0 {
			startIndex = 0
		}
		discardPileCards = g.DiscardPile[startIndex:]
	}

	// Conditionally set current_suit to nil if empty
	var currentSuit interface{} = g.CurrentSuit
	if g.CurrentSuit == "" {
		currentSuit = nil
	}

	return map[string]interface{}{
		"game_id":               g.ID,
		"token":                 g.Token,
		"status":                g.Status,
		"my_id":                 myID,
		"my_display_name":       myDisplayName,
		"my_hand":               myHand,
		"opponent_id":           opponentID,
		"opponent_display_name": opponentDisplayName,
		"opponent_card_count":   opponentCardCount,
		"top_card":              g.GetTopCard(),
		"discard_pile_cards":    discardPileCards,
		"current_suit":          currentSuit,
		"target_suit":           g.TargetSuit,
		"target_card":           g.TargetCard,
		"current_turn":          g.CurrentTurn,
		"my_turn":               g.CurrentTurn == playerID,
		"my_connected":          myConnected,
		"opponent_connected":    opponentConnected,
		"draw_stack":            g.DrawStack,
		"deck_count":            g.Deck.Remaining(),
		"stake_amount":          g.StakeAmount,
		"winner":                g.Winner,
		"win_type":              g.WinType,
	}
}

// SetPlayerConnected sets the connection status for a player
func (g *GameState) SetPlayerConnected(playerID string, connected bool) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.Player1.ID == playerID {
		g.Player1.Connected = connected
	} else if g.Player2.ID == playerID {
		g.Player2.Connected = connected
	}
}

// BothPlayersConnected returns true if both players are connected
func (g *GameState) BothPlayersConnected() bool {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.Player1.Connected && g.Player2.Connected
}

// BothPlayersShowedUp returns true if both players connected at least once
func (g *GameState) BothPlayersShowedUp() bool {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.Player1.ShowedUp && g.Player2.ShowedUp
}

// MarkPlayerShowedUp marks a player as having shown up
func (g *GameState) MarkPlayerShowedUp(playerID string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.Player1.ID == playerID {
		g.Player1.ShowedUp = true
	} else if g.Player2.ID == playerID {
		g.Player2.ShowedUp = true
	}
}

// SetPlayerDisconnected sets player as disconnected with timestamp
func (g *GameState) SetPlayerDisconnected(playerID string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	now := time.Now()
	if g.Player1.ID == playerID {
		g.Player1.Connected = false
		g.Player1.DisconnectedAt = &now
	} else if g.Player2.ID == playerID {
		g.Player2.Connected = false
		g.Player2.DisconnectedAt = &now
	}
}

// ClearPlayerDisconnectTime clears disconnection timestamp (on reconnect)
func (g *GameState) ClearPlayerDisconnectTime(playerID string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.Player1.ID == playerID {
		g.Player1.DisconnectedAt = nil
	} else if g.Player2.ID == playerID {
		g.Player2.DisconnectedAt = nil
	}
}

// ForfeitByDisconnect forfeits the game due to disconnect grace period expiry
func (g *GameState) ForfeitByDisconnect(disconnectedPlayerID string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	// Determine winner (the opponent)
	if disconnectedPlayerID == g.Player1.ID {
		g.Winner = g.Player2.ID
	} else {
		g.Winner = g.Player1.ID
	}

	g.Status = StatusCompleted
	now := time.Now()
	g.CompletedAt = &now

	// Record forfeit move for auditing
	if Manager != nil {
		var disconnectedDB int
		if p := g.GetPlayerByID(disconnectedPlayerID); p != nil {
			disconnectedDB = p.DBPlayerID
		}
		if disconnectedDB > 0 {
			Manager.RecordMove(g.SessionID, disconnectedDB, "FORFEIT", "", "")
		}
		// Persist final state
		Manager.SaveFinalGameState(g)
	}

	// TODO: Trigger payout to winner
	// For now, just log
	// log.Printf("[DUMMY PAYOUT] Would pay winner %s", g.Winner)
}

// SaveToRedis saves the game state to Redis via the manager
func (g *GameState) SaveToRedis() {
	if Manager != nil && Manager.rdb != nil {
		Manager.saveGameToRedis(g)
	}
}
