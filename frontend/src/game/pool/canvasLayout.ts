// Canvas layout constants and coordinate conversion shared between PoolCanvas and PoolGamePage.
// Matches original 8Ball-Pool-HTML5 approach: all three table images (pockets, cloth, tableTop)
// are centered on the same point and scaled uniformly from their native sizes.

import { BALL_RADIUS, N } from './constants';

// Canvas dimensions
export const CANVAS_WIDTH = 990;
export const CANVAS_HEIGHT = 560;

// Physics play area in physics units
export const TABLE_PHYS_W = 100 * N; // 138000
export const TABLE_PHYS_H = 50 * N;  // 69000

// In the original game (physScale=0.01), the play area is 1380x690 display pixels.
// The cloth image is 1449x822 — slightly larger (includes cushion edge bleed).
// We scale so the play area fits within our canvas with some padding for the frame.

// Native image sizes (from the original assets)
export const CLOTH_NATIVE_W = 1449;
export const CLOTH_NATIVE_H = 822;
export const TABLE_TOP_NATIVE_W = 1591;
export const TABLE_TOP_NATIVE_H = 902;
export const POCKETS_NATIVE_W = 1654;
export const POCKETS_NATIVE_H = 965;

// Original display-pixel play area (100*N * physScale x 50*N * physScale)
const ORIG_PLAY_W = 1380; // 100 * 1380 * 0.01
const ORIG_PLAY_H = 690;  // 50 * 1380 * 0.01

// We need the pockets image (largest) to fit in the canvas with small margin
const PADDING = 10;
const SCALE_FIT_W = (CANVAS_WIDTH - PADDING * 2) / POCKETS_NATIVE_W;
const SCALE_FIT_H = (CANVAS_HEIGHT - PADDING * 2) / POCKETS_NATIVE_H;
export const IMG_SCALE = Math.min(SCALE_FIT_W, SCALE_FIT_H);

// Table center on canvas
export const TABLE_CX = CANVAS_WIDTH / 2;
export const TABLE_CY = CANVAS_HEIGHT / 2;

// Scaled image sizes (for drawing centered on TABLE_CX, TABLE_CY)
export const CLOTH_W = CLOTH_NATIVE_W * IMG_SCALE;
export const CLOTH_H = CLOTH_NATIVE_H * IMG_SCALE;
export const TABLE_TOP_W = TABLE_TOP_NATIVE_W * IMG_SCALE;
export const TABLE_TOP_H = TABLE_TOP_NATIVE_H * IMG_SCALE;
export const POCKETS_W = POCKETS_NATIVE_W * IMG_SCALE;
export const POCKETS_H = POCKETS_NATIVE_H * IMG_SCALE;

// Play area in canvas pixels (scaled from original display size)
export const TABLE_W = ORIG_PLAY_W * IMG_SCALE;
export const TABLE_H = ORIG_PLAY_H * IMG_SCALE;

// Physics-to-canvas conversion scale
export const SCALE_X = TABLE_W / TABLE_PHYS_W;
export const SCALE_Y = TABLE_H / TABLE_PHYS_H;
export const BALL_R_PX = BALL_RADIUS * SCALE_X;

export function physToCanvas(px: number, py: number): [number, number] {
  const cx = TABLE_CX + px * SCALE_X;
  const cy = TABLE_CY + py * SCALE_Y;
  return [cx, cy];
}

export function canvasToPhys(cx: number, cy: number): [number, number] {
  const px = (cx - TABLE_CX) / SCALE_X;
  const py = (cy - TABLE_CY) / SCALE_Y;
  return [px, py];
}
