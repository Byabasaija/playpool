// Shared types for the pool game engine.

export interface BallState {
  id: number;
  x: number;
  y: number;
  active: boolean;
}

export type BallGroup = 'SOLIDS' | 'STRIPES' | 'ANY' | '8BALL';

export interface ShotParams {
  angle: number;
  power: number;
  screw: number;
  english: number;
}

export interface PocketingAnim {
  ballId: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  startTime: number;
  duration: number;
}
