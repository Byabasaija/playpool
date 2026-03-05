package game

// Physics and table constants for 8-ball pool.

const (
	AdjustmentScale = 2.3
	BallRadius      = 2300.0 // 1000 * AdjustmentScale
	MaxPower        = 5000.0
	NumBalls        = 16 // 0=cue, 1-7=solids, 8=eight, 9-15=stripes

	// Table geometry base unit: n = 600 * AdjustmentScale
	N = 1380.0 // 600 * 2.3
)
