package game

import (
	"errors"
	"log"
	"math"
	"sync"
	"time"
)

// BallGroup represents a player's assigned ball group.
type BallGroup string

const (
	GroupSolids  BallGroup = "SOLIDS"
	GroupStripes BallGroup = "STRIPES"
	GroupAny     BallGroup = "ANY"   // not yet assigned
	Group8Ball   BallGroup = "8BALL" // cleared own group, now shooting 8-ball
)

// PoolPlayer represents a player in a pool game.
type PoolPlayer struct {
	ID             string     `json:"id"`
	PhoneNumber    string     `json:"phone_number"`
	DBPlayerID     int        `json:"db_player_id,omitempty"`
	DisplayName    string     `json:"display_name,omitempty"`
	PlayerToken    string     `json:"-"`
	Connected      bool       `json:"connected"`
	ShowedUp       bool       `json:"showed_up"`
	DisconnectedAt *time.Time `json:"-"`
	BallGroup      BallGroup  `json:"ball_group"`
}

// BallState represents a ball's position and status for serialization.
type BallState struct {
	ID       int     `json:"id"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Active   bool    `json:"active"`
}

// ShotParams represents the input for a shot.
type ShotParams struct {
	Angle   float64 `json:"angle"`   // radians
	Power   float64 `json:"power"`   // 0-5000
	Screw   float64 `json:"screw"`   // -0.5 to 0.5
	English float64 `json:"english"` // -1 to 1
}

// FoulInfo describes a foul that occurred during a shot.
type FoulInfo struct {
	Type    string `json:"type"`    // "scratch", "wrong_first_contact", "no_cushion", "illegal_8ball", "break_foul"
	Message string `json:"message"`
}

// ShotResult represents the outcome of a shot.
type ShotResult struct {
	Success       bool        `json:"success"`
	ShotParams    ShotParams  `json:"shot_params"`
	BallPositions []BallState `json:"ball_positions"`
	PocketedBalls []int       `json:"pocketed_balls"`
	Events        []CollisionEvent `json:"events"`
	Foul          *FoulInfo   `json:"foul,omitempty"`
	GroupAssigned bool        `json:"group_assigned"`
	Player1Group  BallGroup   `json:"player1_group"`
	Player2Group  BallGroup   `json:"player2_group"`
	TurnChange    bool        `json:"turn_change"`
	NextTurn      string      `json:"next_turn"`
	BallInHand    bool        `json:"ball_in_hand"`
	GameOver      bool        `json:"game_over"`
	Winner        string      `json:"winner,omitempty"`
	WinType       string      `json:"win_type,omitempty"`
}

// PoolGameState represents the complete state of an 8-ball pool game.
type PoolGameState struct {
	ID               string       `json:"id"`
	Token            string       `json:"token"`
	Player1          *PoolPlayer  `json:"player1"`
	Player2          *PoolPlayer  `json:"player2"`
	Balls            [NumBalls]BallState `json:"balls"`
	CurrentTurn      string       `json:"current_turn"`
	Status           GameStatus   `json:"status"`
	Winner           string       `json:"winner,omitempty"`
	WinType          string       `json:"win_type,omitempty"`
	StakeAmount      int          `json:"stake_amount"`
	ShotNumber       int          `json:"shot_number"`
	IsBreakShot      bool         `json:"is_break_shot"`
	BallInHand       bool         `json:"ball_in_hand"`
	BallInHandPlayer string       `json:"ball_in_hand_player,omitempty"`
	ExpiresAt        time.Time    `json:"expires_at"`
	CreatedAt        time.Time    `json:"created_at"`
	StartedAt        *time.Time   `json:"started_at,omitempty"`
	CompletedAt      *time.Time   `json:"completed_at,omitempty"`
	LastActivity     time.Time    `json:"last_activity"`
	SessionID        int          `json:"session_id,omitempty"`
	mu               sync.RWMutex
}

// NewPoolGame creates a new pool game state.
func NewPoolGame(id, token string,
	p1ID, p1Phone, p1Token string, p1DBID int, p1DisplayName string,
	p2ID, p2Phone, p2Token string, p2DBID int, p2DisplayName string,
	stakeAmount int) *PoolGameState {

	expiryMinutes := 3
	if Manager != nil && Manager.config != nil {
		expiryMinutes = Manager.config.GameExpiryMinutes
	}

	g := &PoolGameState{
		ID:    id,
		Token: token,
		Player1: &PoolPlayer{
			ID: p1ID, PhoneNumber: p1Phone, DBPlayerID: p1DBID,
			DisplayName: p1DisplayName, PlayerToken: p1Token,
			BallGroup: GroupAny,
		},
		Player2: &PoolPlayer{
			ID: p2ID, PhoneNumber: p2Phone, DBPlayerID: p2DBID,
			DisplayName: p2DisplayName, PlayerToken: p2Token,
			BallGroup: GroupAny,
		},
		Status:       StatusWaiting,
		StakeAmount:  stakeAmount,
		IsBreakShot:  true,
		BallInHand:   false,
		ExpiresAt:    time.Now().Add(time.Duration(expiryMinutes) * time.Minute),
		CreatedAt:    time.Now(),
		LastActivity: time.Now(),
	}

	return g
}

// Initialize sets up the game — racks the balls and picks who breaks.
func (g *PoolGameState) Initialize() error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.Status == StatusInProgress || g.StartedAt != nil {
		log.Printf("[POOL INIT] Game %s already initialized, skipping", g.ID)
		return nil
	}

	// Rack balls
	rackPositions := Standard8BallRack()
	for i := 0; i < NumBalls; i++ {
		g.Balls[i] = BallState{
			ID:     i,
			X:      rackPositions[i].X,
			Y:      rackPositions[i].Y,
			Active: true,
		}
	}

	// Player 1 breaks
	g.CurrentTurn = g.Player1.ID
	g.IsBreakShot = true
	g.ShotNumber = 0

	now := time.Now()
	g.StartedAt = &now
	g.Status = StatusInProgress
	g.LastActivity = now

	log.Printf("[POOL INIT] Game %s initialized, %s breaks", g.ID, g.CurrentTurn)
	return nil
}

// TakeShot executes a shot by a player.
func (g *PoolGameState) TakeShot(playerID string, params ShotParams) (*ShotResult, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.Status != StatusInProgress {
		return nil, errors.New("game is not in progress")
	}
	if g.CurrentTurn != playerID {
		return nil, errors.New("not your turn")
	}

	// Validate power
	if params.Power < 40 || params.Power > MaxPower {
		return nil, errors.New("invalid power")
	}

	// Clamp spin values
	if params.Screw < -0.5 {
		params.Screw = -0.5
	}
	if params.Screw > 0.5 {
		params.Screw = 0.5
	}
	if params.English < -1 {
		params.English = -1
	}
	if params.English > 1 {
		params.English = 1
	}

	// Cue ball must be active
	if !g.Balls[0].Active {
		return nil, errors.New("cue ball is not on the table")
	}

	// Build physics engine from current ball state
	table := NewStandard8BallTable()
	var balls [NumBalls]*Ball
	for i, bs := range g.Balls {
		balls[i] = &Ball{
			ID:         bs.ID,
			Position:   NewVec2(bs.X, bs.Y),
			Velocity:   Vec2{},
			Active:     bs.Active,
			Grip:       1,
			DeltaScrew: Vec2{},
		}
	}

	// Set cue ball velocity from shot params
	vx := fix(math.Cos(params.Angle) * params.Power)
	vy := fix(math.Sin(params.Angle) * params.Power)
	balls[0].Velocity = NewVec2(vx, vy)
	balls[0].Screw = params.Screw
	balls[0].English = params.English

	engine := NewPhysicsEngine(balls, table)
	events := engine.Simulate()

	// Analyze results
	g.ShotNumber++
	result := &ShotResult{
		Success:    true,
		ShotParams: params,
		Events:     events,
	}

	// Determine which balls were pocketed this shot
	pocketed := make([]int, 0)
	cueBallPocketed := false
	eightBallPocketed := false
	for _, evt := range events {
		if evt.Type == "pocket" {
			pocketed = append(pocketed, evt.BallID)
			if evt.BallID == 0 {
				cueBallPocketed = true
			}
			if evt.BallID == 8 {
				eightBallPocketed = true
			}
		}
	}
	result.PocketedBalls = pocketed

	// Determine first ball contacted by cue ball
	firstContactBallID := -1
	for _, evt := range events {
		if evt.Type == "ball" && evt.BallID == 0 {
			firstContactBallID = evt.TargetID
			break
		}
	}

	// Check cushion contact after first ball contact
	cushionAfterContact := false
	ballContactFound := false
	for _, evt := range events {
		if evt.Type == "ball" && (evt.BallID == 0 || evt.TargetID == 0) {
			ballContactFound = true
		}
		if ballContactFound && (evt.Type == "line" || evt.Type == "vertex") {
			cushionAfterContact = true
			break
		}
	}

	// Get player info
	player, opponent := g.getPlayerAndOpponent(playerID)

	// === FOUL DETECTION ===
	var foul *FoulInfo

	// Scratch (cue ball pocketed)
	if cueBallPocketed {
		foul = &FoulInfo{Type: "scratch", Message: "Cue ball pocketed"}
	}

	// No ball hit
	if foul == nil && firstContactBallID == -1 {
		foul = &FoulInfo{Type: "no_contact", Message: "Failed to hit any ball"}
	}

	// Wrong first contact
	if foul == nil && firstContactBallID > 0 && player.BallGroup != GroupAny {
		targetGroup := ballGroup(firstContactBallID)
		if player.BallGroup == Group8Ball {
			if firstContactBallID != 8 {
				foul = &FoulInfo{Type: "wrong_first_contact", Message: "Must hit the 8-ball first"}
			}
		} else if targetGroup != player.BallGroup && firstContactBallID != 8 {
			foul = &FoulInfo{Type: "wrong_first_contact", Message: "Hit opponent's ball first"}
		}
	}

	// No cushion after contact (and nothing pocketed)
	if foul == nil && firstContactBallID >= 0 && !cushionAfterContact && len(pocketed) == 0 {
		foul = &FoulInfo{Type: "no_cushion", Message: "No ball hit a cushion after contact"}
	}

	// Break-specific fouls
	if foul == nil && g.IsBreakShot {
		// Count balls that hit cushions during break
		cushionBalls := make(map[int]bool)
		for _, evt := range events {
			if (evt.Type == "line" || evt.Type == "vertex") && evt.BallID != 0 {
				cushionBalls[evt.BallID] = true
			}
		}
		if len(cushionBalls)+len(pocketed) < 2 {
			foul = &FoulInfo{Type: "break_foul", Message: "Not enough balls reached cushions on break"}
		}
	}

	result.Foul = foul

	// === GROUP ASSIGNMENT ===
	groupAssigned := false
	if player.BallGroup == GroupAny && opponent.BallGroup == GroupAny && foul == nil && !g.IsBreakShot {
		// Assign based on first legally pocketed ball (not cue, not 8-ball)
		for _, ballID := range pocketed {
			if ballID == 0 || ballID == 8 {
				continue
			}
			grp := ballGroup(ballID)
			player.BallGroup = grp
			if grp == GroupSolids {
				opponent.BallGroup = GroupStripes
			} else {
				opponent.BallGroup = GroupSolids
			}
			groupAssigned = true
			break
		}
	}

	// Also assign on break if balls are pocketed and no foul
	if player.BallGroup == GroupAny && opponent.BallGroup == GroupAny && foul == nil && g.IsBreakShot {
		for _, ballID := range pocketed {
			if ballID == 0 || ballID == 8 {
				continue
			}
			grp := ballGroup(ballID)
			player.BallGroup = grp
			if grp == GroupSolids {
				opponent.BallGroup = GroupStripes
			} else {
				opponent.BallGroup = GroupSolids
			}
			groupAssigned = true
			break
		}
	}

	result.GroupAssigned = groupAssigned
	result.Player1Group = g.Player1.BallGroup
	result.Player2Group = g.Player2.BallGroup

	// === 8-BALL GAME OVER CHECK ===
	if eightBallPocketed {
		if foul != nil || player.BallGroup != Group8Ball {
			// Pocketed 8-ball illegally — opponent wins
			result.GameOver = true
			result.Winner = opponent.ID
			result.WinType = "illegal_8ball"
			foul = &FoulInfo{Type: "illegal_8ball", Message: "8-ball pocketed illegally"}
			result.Foul = foul
		} else {
			// Legal 8-ball pocket — player wins
			result.GameOver = true
			result.Winner = playerID
			result.WinType = "pocket_8"
		}
	}

	// Scratch on the 8-ball shot (cue pocketed while shooting 8) — opponent wins
	if cueBallPocketed && player.BallGroup == Group8Ball && !eightBallPocketed {
		result.GameOver = true
		result.Winner = opponent.ID
		result.WinType = "scratch_on_8"
	}

	// === UPDATE BALL POSITIONS ===
	for i, b := range engine.Balls {
		g.Balls[i] = BallState{
			ID:     b.ID,
			X:      b.Position.X,
			Y:      b.Position.Y,
			Active: b.Active,
		}
	}

	// If cue ball was pocketed, restore it (inactive) — it will be placed by opponent
	if cueBallPocketed {
		g.Balls[0].Active = false
	}

	// Build final ball positions for result
	result.BallPositions = make([]BallState, NumBalls)
	copy(result.BallPositions, g.Balls[:])

	// === CHECK IF PLAYER CLEARED THEIR GROUP ===
	g.updateBallGroupStatus(player)
	g.updateBallGroupStatus(opponent)

	result.Player1Group = g.Player1.BallGroup
	result.Player2Group = g.Player2.BallGroup

	// === TURN MANAGEMENT ===
	g.IsBreakShot = false

	if result.GameOver {
		g.Status = StatusCompleted
		g.Winner = result.Winner
		g.WinType = result.WinType
		now := time.Now()
		g.CompletedAt = &now
		result.NextTurn = ""
		result.BallInHand = false

		if Manager != nil {
			Manager.SaveFinalGameState(g)
		}
	} else if foul != nil {
		// Foul: opponent gets ball-in-hand
		g.switchTurn()
		g.BallInHand = true
		g.BallInHandPlayer = g.CurrentTurn
		// Restore cue ball as active for placement
		g.Balls[0].Active = true
		result.TurnChange = true
		result.NextTurn = g.CurrentTurn
		result.BallInHand = true
	} else {
		// Check if player pocketed any of their own balls
		pottedOwn := false
		for _, ballID := range pocketed {
			if ballID == 0 || ballID == 8 {
				continue
			}
			if player.BallGroup == GroupAny || ballGroup(ballID) == player.BallGroup {
				pottedOwn = true
				break
			}
		}

		if pottedOwn {
			// Turn continues
			result.TurnChange = false
			result.NextTurn = playerID
		} else {
			// Turn switches
			g.switchTurn()
			result.TurnChange = true
			result.NextTurn = g.CurrentTurn
		}
		g.BallInHand = false
		g.BallInHandPlayer = ""
		result.BallInHand = false
	}

	g.LastActivity = time.Now()

	// Record move
	if Manager != nil {
		dbPlayerID := g.getDBPlayerID(playerID)
		if dbPlayerID > 0 {
			Manager.RecordPoolShot(g.SessionID, dbPlayerID, params)
		}
	}

	log.Printf("[POOL] Shot #%d by %s, pocketed=%v, foul=%v, gameOver=%v, nextTurn=%s",
		g.ShotNumber, playerID, pocketed, foul != nil, result.GameOver, result.NextTurn)

	return result, nil
}

// PlaceCueBall places the cue ball for ball-in-hand.
func (g *PoolGameState) PlaceCueBall(playerID string, x, y float64) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.CurrentTurn != playerID {
		return errors.New("not your turn")
	}
	if !g.BallInHand {
		return errors.New("not ball-in-hand")
	}

	// Validate position is within table bounds
	maxX := 50 * N // half table width at cushion
	maxY := 25 * N
	if x < -maxX || x > maxX || y < -maxY || y > maxY {
		return errors.New("position out of bounds")
	}

	// Check no overlap with other balls
	for _, b := range g.Balls {
		if !b.Active || b.ID == 0 {
			continue
		}
		dx := x - b.X
		dy := y - b.Y
		dist := math.Sqrt(dx*dx + dy*dy)
		if dist < 2*BallRadius {
			return errors.New("overlapping with another ball")
		}
	}

	g.Balls[0] = BallState{ID: 0, X: x, Y: y, Active: true}
	g.BallInHand = false
	g.BallInHandPlayer = ""

	log.Printf("[POOL] Cue ball placed at (%.0f, %.0f) by %s", x, y, playerID)
	return nil
}

// GetGameStateForPlayer returns the game state visible to a specific player.
func (g *PoolGameState) GetGameStateForPlayer(playerID string) map[string]interface{} {
	g.mu.RLock()
	defer g.mu.RUnlock()

	var myID, oppID string
	var myName, oppName string
	var myConnected, oppConnected bool
	var myGroup, oppGroup BallGroup

	if g.Player1.ID == playerID {
		myID, oppID = g.Player1.ID, g.Player2.ID
		myName, oppName = g.Player1.DisplayName, g.Player2.DisplayName
		myConnected, oppConnected = g.Player1.Connected, g.Player2.Connected
		myGroup, oppGroup = g.Player1.BallGroup, g.Player2.BallGroup
	} else {
		myID, oppID = g.Player2.ID, g.Player1.ID
		myName, oppName = g.Player2.DisplayName, g.Player1.DisplayName
		myConnected, oppConnected = g.Player2.Connected, g.Player1.Connected
		myGroup, oppGroup = g.Player2.BallGroup, g.Player1.BallGroup
	}

	balls := make([]BallState, NumBalls)
	copy(balls, g.Balls[:])

	return map[string]interface{}{
		"game_id":               g.ID,
		"token":                 g.Token,
		"status":                g.Status,
		"my_id":                 myID,
		"opponent_id":           oppID,
		"my_display_name":       myName,
		"opponent_display_name": oppName,
		"my_connected":          myConnected,
		"opponent_connected":    oppConnected,
		"my_group":              myGroup,
		"opponent_group":        oppGroup,
		"balls":                 balls,
		"current_turn":          g.CurrentTurn,
		"my_turn":               g.CurrentTurn == playerID,
		"is_break_shot":         g.IsBreakShot,
		"ball_in_hand":          g.BallInHand,
		"ball_in_hand_player":   g.BallInHandPlayer,
		"shot_number":           g.ShotNumber,
		"stake_amount":          g.StakeAmount,
		"winner":                g.Winner,
		"win_type":              g.WinType,
	}
}

// === Connection management (replicates existing patterns) ===

func (g *PoolGameState) SetPlayerConnected(playerID string, connected bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.Player1.ID == playerID {
		g.Player1.Connected = connected
		if connected {
			g.Player1.DisconnectedAt = nil
		}
	} else if g.Player2.ID == playerID {
		g.Player2.Connected = connected
		if connected {
			g.Player2.DisconnectedAt = nil
		}
	}
}

func (g *PoolGameState) BothPlayersConnected() bool {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.Player1.Connected && g.Player2.Connected
}

func (g *PoolGameState) BothPlayersShowedUp() bool {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.Player1.ShowedUp && g.Player2.ShowedUp
}

func (g *PoolGameState) MarkPlayerShowedUp(playerID string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.Player1.ID == playerID {
		g.Player1.ShowedUp = true
	} else if g.Player2.ID == playerID {
		g.Player2.ShowedUp = true
	}
}

func (g *PoolGameState) SetPlayerDisconnected(playerID string) {
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

func (g *PoolGameState) GetOpponentID(playerID string) string {
	g.mu.RLock()
	defer g.mu.RUnlock()
	if g.Player1.ID == playerID {
		return g.Player2.ID
	}
	return g.Player1.ID
}

func (g *PoolGameState) GetPlayerByID(playerID string) *PoolPlayer {
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

func (g *PoolGameState) GetCurrentPlayer() *PoolPlayer {
	g.mu.RLock()
	defer g.mu.RUnlock()
	if g.CurrentTurn == g.Player1.ID {
		return g.Player1
	}
	return g.Player2
}

func (g *PoolGameState) GetOpponent() *PoolPlayer {
	g.mu.RLock()
	defer g.mu.RUnlock()
	if g.CurrentTurn == g.Player1.ID {
		return g.Player2
	}
	return g.Player1
}

// ForfeitByDisconnect forfeits the game due to disconnect.
func (g *PoolGameState) ForfeitByDisconnect(disconnectedPlayerID string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if disconnectedPlayerID == g.Player1.ID {
		g.Winner = g.Player2.ID
	} else {
		g.Winner = g.Player1.ID
	}
	g.Status = StatusCompleted
	g.WinType = "forfeit"
	now := time.Now()
	g.CompletedAt = &now

	if Manager != nil {
		dbID := g.getDBPlayerIDLocked(disconnectedPlayerID)
		if dbID > 0 {
			Manager.RecordMove(g.SessionID, dbID, "FORFEIT")
		}
		Manager.SaveFinalGameState(g)
	}
}

// ForfeitByConcede forfeits the game because a player conceded.
func (g *PoolGameState) ForfeitByConcede(concedingPlayerID string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if concedingPlayerID == g.Player1.ID {
		g.Winner = g.Player2.ID
	} else {
		g.Winner = g.Player1.ID
	}
	g.Status = StatusCompleted
	g.WinType = "concede"
	now := time.Now()
	g.CompletedAt = &now

	if Manager != nil {
		dbID := g.getDBPlayerIDLocked(concedingPlayerID)
		if dbID > 0 {
			Manager.RecordMove(g.SessionID, dbID, "CONCEDE")
		}
		Manager.SaveFinalGameState(g)
	}
}

// SaveToRedis saves the game state via the manager.
func (g *PoolGameState) SaveToRedis() {
	if Manager != nil && Manager.rdb != nil {
		Manager.savePoolGameToRedis(g)
	}
}

// === Internal helpers ===

func (g *PoolGameState) switchTurn() {
	if g.CurrentTurn == g.Player1.ID {
		g.CurrentTurn = g.Player2.ID
	} else {
		g.CurrentTurn = g.Player1.ID
	}
	g.LastActivity = time.Now()
}

func (g *PoolGameState) getPlayerAndOpponent(playerID string) (*PoolPlayer, *PoolPlayer) {
	if g.Player1.ID == playerID {
		return g.Player1, g.Player2
	}
	return g.Player2, g.Player1
}

func (g *PoolGameState) getDBPlayerID(playerID string) int {
	if g.Player1.ID == playerID {
		return g.Player1.DBPlayerID
	}
	if g.Player2.ID == playerID {
		return g.Player2.DBPlayerID
	}
	return 0
}

// getDBPlayerIDLocked is for use when lock is already held.
func (g *PoolGameState) getDBPlayerIDLocked(playerID string) int {
	if g.Player1.ID == playerID {
		return g.Player1.DBPlayerID
	}
	if g.Player2.ID == playerID {
		return g.Player2.DBPlayerID
	}
	return 0
}

// ballGroup returns the group for a ball ID.
func ballGroup(id int) BallGroup {
	if id >= 1 && id <= 7 {
		return GroupSolids
	}
	if id >= 9 && id <= 15 {
		return GroupStripes
	}
	return "" // 0 = cue, 8 = eight
}

// updateBallGroupStatus checks if a player has cleared all balls in their group
// and promotes them to shooting the 8-ball.
func (g *PoolGameState) updateBallGroupStatus(player *PoolPlayer) {
	if player.BallGroup != GroupSolids && player.BallGroup != GroupStripes {
		return
	}

	allCleared := true
	for _, b := range g.Balls {
		if !b.Active && b.ID != 0 && b.ID != 8 {
			continue // pocketed, skip
		}
		if b.Active && ballGroup(b.ID) == player.BallGroup {
			allCleared = false
			break
		}
	}

	if allCleared {
		player.BallGroup = Group8Ball
	}
}

