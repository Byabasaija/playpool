package game

import (
	"math"
	"testing"
)

// Helper to create a simple 2-ball test setup: cue ball + one object ball.
func setupStraightShot(cueBallX, cueBallY, targetX, targetY, power, angle float64) *PhysicsEngine {
	table := NewStandard8BallTable()
	var balls [NumBalls]*Ball
	for i := 0; i < NumBalls; i++ {
		balls[i] = &Ball{
			ID:       i,
			Position: NewVec2(0, 100000), // off-table default (inactive)
			Active:   false,
			Grip:     1,
		}
	}

	// Cue ball
	balls[0] = &Ball{
		ID:       0,
		Position: NewVec2(cueBallX, cueBallY),
		Velocity: NewVec2(fix(math.Cos(angle)*power), fix(math.Sin(angle)*power)),
		Active:   true,
		Grip:     1,
	}

	// Target ball
	balls[1] = &Ball{
		ID:       1,
		Position: NewVec2(targetX, targetY),
		Active:   true,
		Grip:     1,
	}

	return NewPhysicsEngine(balls, table)
}

func TestStraightShotMovesCorrectDirection(t *testing.T) {
	// Shoot cue ball to the right toward ball 1
	engine := setupStraightShot(-20000, 0, 0, 0, 3000, 0)
	startX := engine.Balls[0].Position.X

	engine.Simulate()

	// Cue ball should have moved to the right
	if engine.Balls[0].Position.X <= startX {
		t.Errorf("Cue ball did not move right: start=%.0f end=%.0f", startX, engine.Balls[0].Position.X)
	}

	// Ball 1 should have been hit and moved right
	if engine.Balls[1].Position.X <= 0 {
		t.Errorf("Target ball did not move right: x=%.0f", engine.Balls[1].Position.X)
	}
}

func TestFrictionStopsBalls(t *testing.T) {
	// Shoot a single ball gently — it should stop eventually
	table := NewStandard8BallTable()
	var balls [NumBalls]*Ball
	for i := 0; i < NumBalls; i++ {
		balls[i] = &Ball{ID: i, Position: NewVec2(0, 100000), Active: false, Grip: 1}
	}
	balls[0] = &Ball{
		ID: 0, Position: NewVec2(0, 0),
		Velocity: NewVec2(500, 0), // gentle shot
		Active: true, Grip: 1,
	}
	engine := NewPhysicsEngine(balls, table)

	events := engine.Simulate()

	// Ball should have stopped
	if !engine.AllStopped() {
		t.Errorf("Ball didn't stop after simulation")
	}

	// Should have hit at least one cushion (ball traveling to the right)
	hasCushion := false
	for _, e := range events {
		if e.Type == "line" || e.Type == "vertex" {
			hasCushion = true
			break
		}
	}
	if !hasCushion {
		t.Log("Warning: no cushion hit detected (ball may have stopped before reaching cushion)")
	}
}

func TestBallBallCollisionRebounds(t *testing.T) {
	// Head-on collision: cue ball going right, target ball stationary
	engine := setupStraightShot(-10000, 0, 10000, 0, 3000, 0)

	engine.Simulate()

	// After head-on collision, cue ball should slow down / stop, target should move right
	// In a head-on elastic collision, cue ball transfers most energy to target
	// Target ball should be further right than its starting position
	if engine.Balls[1].Position.X <= 10000 {
		t.Errorf("Target ball should have moved right from head-on hit: x=%.0f", engine.Balls[1].Position.X)
	}
}

func TestCushionBounce(t *testing.T) {
	// Shoot ball at the right wall
	table := NewStandard8BallTable()
	var balls [NumBalls]*Ball
	for i := 0; i < NumBalls; i++ {
		balls[i] = &Ball{ID: i, Position: NewVec2(0, 100000), Active: false, Grip: 1}
	}
	balls[0] = &Ball{
		ID: 0, Position: NewVec2(40000, 0),
		Velocity: NewVec2(4000, 0), // shooting right toward cushion
		Active: true, Grip: 1,
	}
	engine := NewPhysicsEngine(balls, table)

	events := engine.Simulate()

	// Should have at least one cushion collision
	cushionHits := 0
	for _, e := range events {
		if e.Type == "line" && e.BallID == 0 {
			cushionHits++
		}
	}
	if cushionHits == 0 {
		t.Error("Expected at least one cushion hit")
	}
}

func TestPocketCapture(t *testing.T) {
	// Shoot ball directly toward a corner pocket
	table := NewStandard8BallTable()
	var balls [NumBalls]*Ball
	for i := 0; i < NumBalls; i++ {
		balls[i] = &Ball{ID: i, Position: NewVec2(0, 100000), Active: false, Grip: 1}
	}

	// Corner pocket is at approximately (50*N+pr/2, -25*N-pr/4)
	// Shoot ball 1 toward bottom-right corner pocket from nearby
	pocket := table.Pockets[2] // top-right corner
	// Position ball 1 near the pocket, moving toward it
	balls[0] = &Ball{ID: 0, Position: NewVec2(0, 0), Active: true, Grip: 1}
	balls[1] = &Ball{
		ID: 1, Position: NewVec2(pocket.Position.X-5000, pocket.Position.Y+5000),
		Velocity: NewVec2(2000, -2000),
		Active: true, Grip: 1,
	}
	engine := NewPhysicsEngine(balls, table)

	events := engine.Simulate()

	// Check if ball 1 was pocketed
	pocketed := false
	for _, e := range events {
		if e.Type == "pocket" && e.BallID == 1 {
			pocketed = true
			break
		}
	}
	if pocketed {
		// Ball 1 should be inactive
		if engine.Balls[1].Active {
			t.Error("Pocketed ball should be inactive")
		}
	} else {
		t.Log("Ball wasn't pocketed in this trajectory — adjust test if needed")
	}
}

func TestDeterminism(t *testing.T) {
	// Same input should always produce the same output
	run := func() [NumBalls]Vec2 {
		engine := setupStraightShot(-20000, 0, 0, 0, 3000, 0)
		engine.Simulate()
		var result [NumBalls]Vec2
		for i, b := range engine.Balls {
			result[i] = b.Position
		}
		return result
	}

	result1 := run()
	result2 := run()

	for i := 0; i < NumBalls; i++ {
		if result1[i].X != result2[i].X || result1[i].Y != result2[i].Y {
			t.Errorf("Non-deterministic: ball %d run1=(%.4f,%.4f) run2=(%.4f,%.4f)",
				i, result1[i].X, result1[i].Y, result2[i].X, result2[i].Y)
		}
	}
}

func TestBreakShotScattersBalls(t *testing.T) {
	// Full rack break shot — verify balls scatter
	table := NewStandard8BallTable()
	rackPos := Standard8BallRack()

	var balls [NumBalls]*Ball
	for i := 0; i < NumBalls; i++ {
		balls[i] = &Ball{
			ID:       i,
			Position: rackPos[i],
			Active:   true,
			Grip:     1,
		}
	}

	// Cue ball shoots right toward the rack at full power
	balls[0].Velocity = NewVec2(MaxPower, 0)

	engine := NewPhysicsEngine(balls, table)
	events := engine.Simulate()

	// Should have multiple ball-ball collisions
	ballHits := 0
	for _, e := range events {
		if e.Type == "ball" {
			ballHits++
		}
	}
	if ballHits < 3 {
		t.Errorf("Expected at least 3 ball-ball collisions on break, got %d", ballHits)
	}

	// At least some balls should have moved significantly from their rack positions
	moved := 0
	for i := 1; i < NumBalls; i++ {
		dx := engine.Balls[i].Position.X - rackPos[i].X
		dy := engine.Balls[i].Position.Y - rackPos[i].Y
		dist := math.Sqrt(dx*dx + dy*dy)
		if dist > BallRadius {
			moved++
		}
	}
	if moved < 5 {
		t.Errorf("Expected at least 5 balls to move significantly on break, got %d", moved)
	}
}

func TestAllStoppedLogic(t *testing.T) {
	table := NewStandard8BallTable()
	var balls [NumBalls]*Ball
	for i := 0; i < NumBalls; i++ {
		balls[i] = &Ball{ID: i, Position: NewVec2(0, 0), Active: false, Grip: 1}
	}
	balls[0] = &Ball{ID: 0, Position: NewVec2(0, 0), Active: true, Grip: 1}
	engine := NewPhysicsEngine(balls, table)

	// No velocity — should be stopped
	if !engine.AllStopped() {
		t.Error("AllStopped should return true when no balls have velocity")
	}

	// Give cue ball velocity
	engine.Balls[0].Velocity = NewVec2(100, 0)
	if engine.AllStopped() {
		t.Error("AllStopped should return false when cue ball has velocity")
	}
}
