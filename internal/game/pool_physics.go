package game

import "math"

// Ball represents a single pool ball's physics state.
type Ball struct {
	ID         int     `json:"id"`
	Position   Vec2    `json:"position"`
	Velocity   Vec2    `json:"velocity"`
	Active     bool    `json:"active"`
	Screw      float64 `json:"screw"`       // z-axis spin (cue ball only)
	English    float64 `json:"english"`     // x-axis spin (cue ball only)
	YSpin      float64 `json:"y_spin"`      // roll spin
	Grip       float64 `json:"grip"`        // grip coefficient (0-1)
	DeltaScrew Vec2    `json:"delta_screw"` // screw accumulator (cue ball only)
}

// CollisionEvent records a collision for rule checking and sound playback.
type CollisionEvent struct {
	Type     string  `json:"type"`      // "ball", "line", "vertex", "pocket"
	BallID   int     `json:"ball_id"`
	TargetID int     `json:"target_id"` // ball ID, line index, vertex index, or pocket ID
	Speed    float64 `json:"speed"`     // impact speed (for sound volume)
}

// collisionCandidate is an internal struct for collision detection.
type collisionCandidate struct {
	collisionType        string
	object               *Ball
	target               interface{} // *Ball, *CushionLine, *Vertex, or *Pocket
	time                 float64
	objectIntersectPoint Vec2
	targetIntersectPoint Vec2 // only for ball-ball
}

// PhysicsEngine runs the billiard physics simulation.
type PhysicsEngine struct {
	Balls         [NumBalls]*Ball
	Table         *Table
	Events        []CollisionEvent
	omissionArray []*Ball // balls to skip during moveBalls
}

// NewPhysicsEngine creates a physics engine from ball states and table geometry.
func NewPhysicsEngine(balls [NumBalls]*Ball, table *Table) *PhysicsEngine {
	return &PhysicsEngine{
		Balls:  balls,
		Table:  table,
		Events: make([]CollisionEvent, 0),
	}
}

// Simulate runs the physics until all balls stop. Returns collision events.
func (pe *PhysicsEngine) Simulate() []CollisionEvent {
	pe.Events = make([]CollisionEvent, 0)
	for !pe.AllStopped() {
		pe.updatePhysics()
	}
	return pe.Events
}

// AllStopped returns true if all active balls have zero velocity.
func (pe *PhysicsEngine) AllStopped() bool {
	for _, b := range pe.Balls {
		if b.Active && !b.Velocity.IsZero() {
			return false
		}
	}
	// Also check deltaScrew on cue ball
	if pe.Balls[0].Active && !pe.Balls[0].DeltaScrew.IsZero() {
		return false
	}
	return true
}

func (pe *PhysicsEngine) updatePhysics() {
	pe.predictCollisions()
	pe.updateFriction()
}

func (pe *PhysicsEngine) predictCollisions() {
	t := 0.0
	iterations := 0

	for {
		var bestTime float64 = 1.0
		var candidates []collisionCandidate
		remaining := fix(1 - t)

		for a := 0; a < NumBalls; a++ {
			ball := pe.Balls[a]
			if !ball.Active {
				continue
			}

			projectedPos := ball.Position.Plus(ball.Velocity.Times(remaining))

			// Ball-ball collisions
			for p := a; p < NumBalls; p++ {
				other := pe.Balls[p]
				if other == ball || !other.Active {
					continue
				}
				if ball.Velocity.MagnitudeSquared() == 0 && other.Velocity.MagnitudeSquared() == 0 {
					continue
				}
				if !checkObjectsConverging(ball.Position, other.Position, ball.Velocity, other.Velocity) {
					continue
				}

				// Use relative velocity for collision detection
				relVel := ball.Velocity.Minus(other.Velocity)
				projEnd := ball.Position.Plus(relVel.Times(remaining))

				result := lineIntersectCircle(
					point{ball.Position.X, ball.Position.Y},
					point{projEnd.X, projEnd.Y},
					point{other.Position.X, other.Position.Y},
					2*BallRadius,
				)

				if !result.intersects && !result.inside {
					continue
				}

				var hitPoint point
				var collisionTime float64

				if result.intersects {
					if result.enter != nil {
						hitPoint = *result.enter
					} else if result.exit != nil {
						hitPoint = *result.exit
					} else {
						continue
					}
					fullPath := createVectorFrom2Points(
						point{ball.Position.X, ball.Position.Y},
						point{projEnd.X, projEnd.Y},
					)
					toHit := createVectorFrom2Points(
						point{ball.Position.X, ball.Position.Y},
						hitPoint,
					)
					if fullPath.Magnitude() > 0 {
						collisionTime = fix(t + toHit.Magnitude()/fullPath.Magnitude()*remaining)
					} else {
						collisionTime = t
					}
				} else if result.inside {
					// Already overlapping — resolve immediately
					sep := ball.Position.Minus(other.Position).Normalize()
					_ = other.Position.Plus(sep.Times(2 * BallRadius))
					collisionTime = t
				}

				if collisionTime < bestTime {
					bestTime = collisionTime
					candidates = []collisionCandidate{{
						collisionType:        "ball",
						object:               ball,
						target:               other,
						time:                 collisionTime,
						objectIntersectPoint: ball.Position.Plus(ball.Velocity.Times(collisionTime - t)),
						targetIntersectPoint: other.Position.Plus(other.Velocity.Times(collisionTime - t)),
					}}
				} else if collisionTime == bestTime && collisionTime != 1 {
					candidates = append(candidates, collisionCandidate{
						collisionType:        "ball",
						object:               ball,
						target:               other,
						time:                 collisionTime,
						objectIntersectPoint: ball.Position.Plus(ball.Velocity.Times(collisionTime - t)),
						targetIntersectPoint: other.Position.Plus(other.Velocity.Times(collisionTime - t)),
					})
				}
			}

			if ball.Velocity.MagnitudeSquared() == 0 {
				continue
			}

			// Ball-line (cushion) collisions
			for li := range pe.Table.Lines {
				line := &pe.Table.Lines[li]

				// Try primary collision line (p3-p4)
				hit := lineIntersectLine(
					point{ball.Position.X, ball.Position.Y},
					point{projectedPos.X, projectedPos.Y},
					point{line.P3.X, line.P3.Y},
					point{line.P4.X, line.P4.Y},
				)

				// Fallback to secondary line (p5-p6)
				if hit == nil {
					hit = lineIntersectLine(
						point{ball.Position.X, ball.Position.Y},
						point{projectedPos.X, projectedPos.Y},
						point{line.P5.X, line.P5.Y},
						point{line.P6.X, line.P6.Y},
					)
					if hit != nil {
						// Adjust intersection point outward
						offset := line.Normal.Times(0.2 * BallRadius)
						adjusted := NewVec2(hit.x, hit.y).Plus(offset)
						hit = &point{adjusted.X, adjusted.Y}
					}
				}

				if hit == nil {
					continue
				}

				hitVec := NewVec2(hit.x, hit.y)
				fullPath := createVectorFrom2Points(
					point{ball.Position.X, ball.Position.Y},
					point{projectedPos.X, projectedPos.Y},
				)
				toHit := createVectorFrom2Points(
					point{ball.Position.X, ball.Position.Y},
					*hit,
				)
				var collisionTime float64
				if fullPath.Magnitude() > 0 {
					collisionTime = fix(t + toHit.Magnitude()/fullPath.Magnitude()*remaining)
				} else {
					collisionTime = t
				}

				if collisionTime < bestTime {
					bestTime = collisionTime
					candidates = []collisionCandidate{{
						collisionType:        "line",
						object:               ball,
						target:               line,
						time:                 collisionTime,
						objectIntersectPoint: hitVec,
					}}
				} else if collisionTime == bestTime && collisionTime != 1 {
					candidates = append(candidates, collisionCandidate{
						collisionType:        "line",
						object:               ball,
						target:               line,
						time:                 collisionTime,
						objectIntersectPoint: hitVec,
					})
				}
			}

			// Ball-vertex collisions
			for vi := range pe.Table.Vertices {
				vtx := &pe.Table.Vertices[vi]

				// Proximity check
				if math.Abs(ball.Position.X-vtx.Position.X) > 8000 ||
					math.Abs(ball.Position.Y-vtx.Position.Y) > 8000 {
					continue
				}

				result := lineIntersectCircle(
					point{ball.Position.X, ball.Position.Y},
					point{projectedPos.X, projectedPos.Y},
					point{vtx.Position.X, vtx.Position.Y},
					BallRadius,
				)

				if !result.intersects && !result.inside {
					continue
				}

				var hitPoint point
				var collisionTime float64

				if result.intersects {
					if result.enter != nil {
						hitPoint = *result.enter
					} else if result.exit != nil {
						hitPoint = *result.exit
					} else {
						continue
					}
					fullPath := createVectorFrom2Points(
						point{ball.Position.X, ball.Position.Y},
						point{projectedPos.X, projectedPos.Y},
					)
					toHit := createVectorFrom2Points(
						point{ball.Position.X, ball.Position.Y},
						hitPoint,
					)
					if fullPath.Magnitude() > 0 {
						collisionTime = fix(t + toHit.Magnitude()/fullPath.Magnitude()*remaining)
					} else {
						collisionTime = t
					}
				} else if result.inside {
					collisionTime = t
				}

				hitVec := NewVec2(hitPoint.x, hitPoint.y)

				if collisionTime < bestTime {
					bestTime = collisionTime
					candidates = []collisionCandidate{{
						collisionType:        "vertex",
						object:               ball,
						target:               vtx,
						time:                 collisionTime,
						objectIntersectPoint: hitVec,
					}}
				} else if collisionTime == bestTime && collisionTime != 1 {
					candidates = append(candidates, collisionCandidate{
						collisionType:        "vertex",
						object:               ball,
						target:               vtx,
						time:                 collisionTime,
						objectIntersectPoint: hitVec,
					})
				}
			}

			// Ball-pocket collisions
			for pi := range pe.Table.Pockets {
				pocket := &pe.Table.Pockets[pi]

				// Proximity check
				if math.Abs(ball.Position.X-pocket.Position.X) > 8000 ||
					math.Abs(ball.Position.Y-pocket.Position.Y) > 8000 {
					continue
				}

				// Convergence check — ball must be moving toward pocket
				dir := pocket.Position.Minus(ball.Position).Normalize()
				if ball.Velocity.Dot(dir) <= 0 {
					continue
				}

				result := lineIntersectCircle(
					point{ball.Position.X, ball.Position.Y},
					point{projectedPos.X, projectedPos.Y},
					point{pocket.Position.X, pocket.Position.Y},
					PocketRadius,
				)

				if !result.intersects && !result.inside {
					continue
				}

				var hitPoint point
				var collisionTime float64

				if result.intersects {
					if result.enter != nil {
						hitPoint = *result.enter
					} else if result.exit != nil {
						hitPoint = *result.exit
					} else {
						continue
					}
					fullPath := createVectorFrom2Points(
						point{ball.Position.X, ball.Position.Y},
						point{projectedPos.X, projectedPos.Y},
					)
					toHit := createVectorFrom2Points(
						point{ball.Position.X, ball.Position.Y},
						hitPoint,
					)
					if fullPath.Magnitude() > 0 {
						collisionTime = fix(t + toHit.Magnitude()/fullPath.Magnitude()*remaining)
					} else {
						collisionTime = t
					}
				} else if result.inside {
					collisionTime = t
				}

				hitVec := NewVec2(hitPoint.x, hitPoint.y)

				if collisionTime < bestTime {
					bestTime = collisionTime
					candidates = []collisionCandidate{{
						collisionType:        "pocket",
						object:               ball,
						target:               pocket,
						time:                 collisionTime,
						objectIntersectPoint: hitVec,
					}}
				} else if collisionTime == bestTime && collisionTime != 1 {
					candidates = append(candidates, collisionCandidate{
						collisionType:        "pocket",
						object:               ball,
						target:               pocket,
						time:                 collisionTime,
						objectIntersectPoint: hitVec,
					})
				}
			}
		}

		if len(candidates) > 0 {
			pe.resolveCollisions(candidates)
		}

		dt := fix(bestTime - t)
		pe.moveBalls(dt)
		t = bestTime
		iterations++

		if len(candidates) == 0 || iterations >= MaxIterations {
			break
		}
	}
}

func (pe *PhysicsEngine) resolveCollisions(candidates []collisionCandidate) {
	pe.omissionArray = make([]*Ball, 0)

	for _, c := range candidates {
		switch c.collisionType {
		case "ball":
			pe.resolveBallBall(c)
		case "line":
			pe.resolveBallLine(c)
		case "vertex":
			pe.resolveBallVertex(c)
		case "pocket":
			pe.resolveBallPocket(c)
		}
	}
}

func (pe *PhysicsEngine) resolveBallBall(c collisionCandidate) {
	ball := c.object
	target := c.target.(*Ball)

	ball.Position = c.objectIntersectPoint
	target.Position = c.targetIntersectPoint
	pe.omissionArray = append(pe.omissionArray, ball, target)

	// Decompose velocities into normal and tangential components
	n := target.Position.Minus(ball.Position).Normalize()
	r := n.RightNormal()

	ballNormal := n.Times(ball.Velocity.Dot(n))
	ballTangent := r.Times(ball.Velocity.Dot(r))
	targetNormal := n.Times(target.Velocity.Dot(n))
	targetTangent := r.Times(target.Velocity.Dot(r))

	// Transfer ySpin
	if math.Abs(target.YSpin) < math.Abs(ball.YSpin) {
		target.YSpin = -0.5 * ball.YSpin
	}

	// Screw effect on first contact for cue ball
	if ball.ID == 0 && !ball.firstContactMade() {
		ball.DeltaScrew = ballNormal.Times(0.17 * -ball.Screw)
	}

	// Apply restitution
	newBallNormal := targetNormal.Times(BallRestitution).Plus(ballNormal.Times(1 - BallRestitution))
	newTargetNormal := ballNormal.Times(BallRestitution).Plus(targetNormal.Times(1 - BallRestitution))

	ball.Velocity = ballTangent.Plus(newBallNormal)
	target.Velocity = targetTangent.Plus(newTargetNormal)

	// Grip loss on high impact
	if newTargetNormal.Magnitude() > 450 {
		target.Grip = 0
	}

	// Record collision events for both balls
	speed := ball.Velocity.Magnitude()
	pe.Events = append(pe.Events, CollisionEvent{
		Type:     "ball",
		BallID:   ball.ID,
		TargetID: target.ID,
		Speed:    speed,
	})
	pe.Events = append(pe.Events, CollisionEvent{
		Type:     "ball",
		BallID:   target.ID,
		TargetID: ball.ID,
		Speed:    target.Velocity.Magnitude(),
	})
}

func (pe *PhysicsEngine) resolveBallLine(c collisionCandidate) {
	ball := c.object
	line := c.target.(*CushionLine)

	ball.Position = c.objectIntersectPoint
	pe.omissionArray = append(pe.omissionArray, ball)

	// Transfer velocity to ySpin
	ball.YSpin += -ball.Velocity.Dot(line.Direction) / 100
	if ball.YSpin > 50 {
		ball.YSpin = 50
	}
	if ball.YSpin < -50 {
		ball.YSpin = -50
	}

	normalComp := line.Normal.Times(ball.Velocity.Dot(line.Normal))
	tangentComp := line.Direction.Times(ball.Velocity.Dot(line.Direction))

	// English effect on cue ball
	if ball.ID == 0 {
		tangentComp = tangentComp.Plus(line.Direction.Times(fix(0.2 * ball.English * ball.Velocity.Magnitude())))
		ball.English = fix(0.5 * ball.English)
		if ball.English > -0.1 && ball.English < 0.1 {
			ball.English = 0
		}
	}

	ball.Velocity = normalComp.Times(-CushionRestitution).Plus(tangentComp)

	// Grip loss on hard cushion hit
	if normalComp.Magnitude() > 700 {
		ball.Grip = 0
	}

	// Push ball away from cushion
	ball.Position = ball.Position.Plus(line.Normal.Times(200))

	// Reduce screw on cue ball
	if ball.ID == 0 {
		ball.DeltaScrew = ball.DeltaScrew.Times(0.8)
	}

	pe.Events = append(pe.Events, CollisionEvent{
		Type:   "line",
		BallID: ball.ID,
		Speed:  normalComp.Magnitude(),
	})
}

func (pe *PhysicsEngine) resolveBallVertex(c collisionCandidate) {
	ball := c.object
	vtx := c.target.(*Vertex)

	ball.Position = c.objectIntersectPoint
	pe.omissionArray = append(pe.omissionArray, ball)

	n := vtx.Position.Minus(ball.Position).Normalize()
	r := n.RightNormal()

	normalComp := n.Times(ball.Velocity.Dot(n))
	tangentComp := r.Times(ball.Velocity.Dot(r))

	ball.Velocity = normalComp.Times(-CushionRestitution).Plus(tangentComp)
	ball.Position = ball.Position.Minus(n.Times(200))

	// Reset screw on cue ball vertex hit
	if ball.ID == 0 {
		ball.DeltaScrew = Vec2{}
	}

	pe.Events = append(pe.Events, CollisionEvent{
		Type:   "vertex",
		BallID: ball.ID,
		Speed:  normalComp.Magnitude(),
	})
}

func (pe *PhysicsEngine) resolveBallPocket(c collisionCandidate) {
	ball := c.object
	pocket := c.target.(*Pocket)

	ball.Position = c.objectIntersectPoint
	pe.omissionArray = append(pe.omissionArray, ball)

	speed := ball.Velocity.Magnitude()
	ball.Active = false
	ball.Velocity = Vec2{}

	pe.Events = append(pe.Events, CollisionEvent{
		Type:     "pocket",
		BallID:   ball.ID,
		TargetID: pocket.ID,
		Speed:    speed,
	})
}

func (pe *PhysicsEngine) moveBalls(dt float64) {
	for _, ball := range pe.Balls {
		if !ball.Active {
			continue
		}
		// Skip balls that were just involved in a collision
		skip := false
		for _, omitted := range pe.omissionArray {
			if omitted == ball {
				skip = true
				break
			}
		}
		if skip {
			continue
		}
		ball.Position = ball.Position.Plus(ball.Velocity.Times(dt))
	}
	pe.omissionArray = nil
}

func (pe *PhysicsEngine) updateFriction() {
	for _, ball := range pe.Balls {
		if !ball.Active {
			continue
		}

		// Cue ball screw
		if ball.ID == 0 {
			ball.Velocity = ball.Velocity.Plus(ball.DeltaScrew)
			if ball.DeltaScrew.Magnitude() > 0 {
				ball.DeltaScrew = ball.DeltaScrew.Times(0.8)
				if ball.DeltaScrew.Magnitude() < 1 {
					ball.DeltaScrew = Vec2{}
				}
			}
		}

		// Linear friction
		speed := ball.Velocity.Magnitude()
		speed -= Friction
		dir := ball.Velocity.Normalize()

		if speed < MinVelocity {
			ball.Velocity = Vec2{}
		} else {
			ball.Velocity = dir.Times(speed)
		}

		// Grip recovery
		if ball.Grip < 1 {
			ball.Grip += 0.02
			if ball.Grip > 1 {
				ball.Grip = 1
			}
		}

		// YSpin damping
		if ball.YSpin >= 0.2 {
			ball.YSpin -= 0.2
		} else if ball.YSpin <= -0.2 {
			ball.YSpin += 0.2
		} else {
			ball.YSpin = 0
		}

		// Spin-induced velocity adjustment
		if ball.YSpin != 0 {
			leftNorm := ball.Velocity.LeftNormal().Normalize()
			spinEffect := leftNorm.Times(0.3 * ball.YSpin * ball.Velocity.Magnitude() / 800)
			ball.Velocity = ball.Velocity.Plus(spinEffect)
		}
	}
}

// firstContactMade is a helper to track if cue ball has hit anything yet.
// We track this via the collision events.
func (b *Ball) firstContactMade() bool {
	// This is called during collision resolution.
	// In the original code, ball.firstContact is set after the first ball-ball collision.
	// We simplify: screw delta is only applied on the very first ball-ball collision
	// of the cue ball in a shot. We check if DeltaScrew is already set.
	return !b.DeltaScrew.IsZero()
}

// GetFinalPositions returns the current positions of all balls.
func (pe *PhysicsEngine) GetFinalPositions() [NumBalls]Vec2 {
	var positions [NumBalls]Vec2
	for i, b := range pe.Balls {
		positions[i] = b.Position
	}
	return positions
}
