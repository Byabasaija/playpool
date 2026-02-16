// Physics and table constants for 8-ball pool.
// These MUST match the Go constants in internal/game/pool_constants.go exactly.

export const ADJUSTMENT_SCALE = 2.3;
export const BALL_RADIUS = 2300; // 1000 * ADJUSTMENT_SCALE
export const POCKET_RADIUS = 2250;
export const PHYS_SCALE = 0.01;
export const FRICTION = 1.5;
export const MIN_VELOCITY = 2;
export const CUSHION_RESTITUTION = 0.6;
export const BALL_RESTITUTION = 0.94;
export const MAX_POWER = 5000;
export const MAX_ITERATIONS = 20;
export const FRICTION_SPEED_THRESH = 85;
export const NUM_BALLS = 16; // 0=cue, 1-7=solids, 8=eight, 9-15=stripes

// Table geometry base unit: n = 600 * ADJUSTMENT_SCALE
export const N = 1380; // 600 * 2.3
