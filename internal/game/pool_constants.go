package game

// Physics and table constants for 8-ball pool.
// These MUST match the TypeScript constants in frontend/src/game/pool/constants.ts exactly.

const (
	AdjustmentScale    = 2.3
	BallRadius         = 2300.0  // 1000 * AdjustmentScale
	PocketRadius       = 2250.0
	PhysScale          = 0.01
	Friction           = 1.5
	MinVelocity        = 2.0
	CushionRestitution = 0.6
	BallRestitution    = 0.94
	MaxPower           = 5000.0
	MaxIterations      = 20
	FrictionSpeedThresh = 85.0
	NumBalls           = 16 // 0=cue, 1-7=solids, 8=eight, 9-15=stripes

	// Table geometry base unit: n = 600 * AdjustmentScale
	N = 1380.0 // 600 * 2.3
)
