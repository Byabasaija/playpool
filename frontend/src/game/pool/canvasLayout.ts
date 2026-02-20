// Canvas layout constants and coordinate conversion shared between PoolCanvas and PoolGamePage.

import { BALL_RADIUS, N } from './constants';

// Canvas dimensions (wider to accommodate wooden rail frame)
export const CANVAS_WIDTH = 990;
export const CANVAS_HEIGHT = 560;

// Table play area (inside the rails)
export const RAIL_MARGIN = 55;
export const TABLE_LEFT = RAIL_MARGIN + 40;
export const TABLE_TOP = RAIL_MARGIN + 30;
export const TABLE_W = CANVAS_WIDTH - TABLE_LEFT * 2;
export const TABLE_H = CANVAS_HEIGHT - TABLE_TOP * 2;

// Physics-to-canvas conversion
export const TABLE_PHYS_W = 100 * N;
export const TABLE_PHYS_H = 50 * N;
export const SCALE_X = TABLE_W / TABLE_PHYS_W;
export const SCALE_Y = TABLE_H / TABLE_PHYS_H;
export const BALL_R_PX = BALL_RADIUS * SCALE_X;

export function physToCanvas(px: number, py: number): [number, number] {
  const cx = TABLE_LEFT + TABLE_W / 2 + px * SCALE_X;
  const cy = TABLE_TOP + TABLE_H / 2 + py * SCALE_Y;
  return [cx, cy];
}

export function canvasToPhys(cx: number, cy: number): [number, number] {
  const px = (cx - TABLE_LEFT - TABLE_W / 2) / SCALE_X;
  const py = (cy - TABLE_TOP - TABLE_H / 2) / SCALE_Y;
  return [px, py];
}
