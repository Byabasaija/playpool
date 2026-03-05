package game

import "math"

// Standard8BallRack returns the initial positions for all 16 balls (case 15 from levelData).
// Uses fixed offsets (no random jitter) for deterministic online play.
func Standard8BallRack() [NumBalls]Vec2 {
	var pos [NumBalls]Vec2

	i := 15000 * AdjustmentScale // 34500
	e := math.Sqrt(3)            // √3 ≈ 1.732: exact row spacing for touching balls
	s := 1.0                     // exact Y spacing for touching balls
	br := BallRadius

	// Cue ball (far left)
	pos[0] = NewVec2(-i, 0)

	// Apex ball
	pos[1] = NewVec2(i, 0)

	// Row 2
	pos[2] = NewVec2(i+e*br, br*s)
	pos[15] = NewVec2(i+e*br, -br*s)

	// Row 3 (8-ball in center)
	pos[8] = NewVec2(i+2*e*br, 0)
	pos[5] = NewVec2(i+2*e*br, 2*br*s)
	pos[10] = NewVec2(i+2*e*br, -2*br*s)

	// Row 4
	pos[7] = NewVec2(i+3*e*br, 1*br*s)
	pos[4] = NewVec2(i+3*e*br, 3*br*s)
	pos[9] = NewVec2(i+3*e*br, -1*br*s)
	pos[6] = NewVec2(i+3*e*br, -3*br*s)

	// Row 5
	pos[11] = NewVec2(i+4*e*br, 0)
	pos[12] = NewVec2(i+4*e*br, 2*br*s)
	pos[13] = NewVec2(i+4*e*br, -2*br*s)
	pos[14] = NewVec2(i+4*e*br, 4*br*s)
	pos[3] = NewVec2(i+4*e*br, -4*br*s)

	return pos
}
