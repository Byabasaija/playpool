// Ball renderer matching the original 8Ball-Pool-HTML5 rendering approach:
// Each ball is composited from: base color (solidsSpriteSheet) + number spot (spotSpriteSheet) + shade overlay.
// Stripe balls use per-ball sprite sheets (ballSpriteSheet9-15) with 41 rotation frames.
// Quaternion-based 3D rotation drives spot positioning and stripe frame selection.

import { PoolAssets } from './AssetLoader';

// solidsSpriteSheet.png: 144x144, 3 cols x 3 rows, 48x48 per frame
// Frame 0=white(cue), 1=yellow, 2=blue, 3=red, 4=purple, 5=orange, 6=green, 7=maroon, 8=black
const SOLID_FW = 48;
const SOLID_FH = 48;
const SOLID_COLS = 3;

// spotSpriteSheet.png: 152x152, 4 cols x 4 rows, 38x38 per frame
// Frame 0=cue dot, 1-15=ball numbers
const SPOT_FW = 38;
const SPOT_FH = 38;
const SPOT_COLS = 4;

// ballSpriteSheet{9-15}.png: 256x512, 50x50 per frame, 41 frames each
// Shows stripe pattern at different rotation angles
const STRIPE_FW = 50;
const STRIPE_FH = 50;
const STRIPE_COLS = 5; // floor(256/50)
const STRIPE_FRAMES = 41;

// shade.png: 52x52 single overlay for 3D lighting
// shadow.png: 50x50 ball shadow on table

// --- Quaternion-based 3D ball rotation state ---

type Quat = [number, number, number, number]; // [w, x, y, z]

interface BallRotState {
  quat: Quat;
}

const ballStates: Map<number, BallRotState> = new Map();

function normalize(q: Quat): Quat {
  const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

function rotateQuat(q: Quat, ax: number, ay: number, az: number, angle: number): Quat {
  const len = Math.sqrt(ax * ax + ay * ay + az * az);
  if (len < 0.0001) return q;
  const nx = ax / len, ny = ay / len, nz = az / len;
  const halfAngle = angle * 0.5;
  const sinH = Math.sin(halfAngle);
  const cosH = Math.cos(halfAngle);
  // Rotation quaternion
  const rw = cosH;
  const rx = nx * sinH;
  const ry = ny * sinH;
  const rz = nz * sinH;
  // Multiply: result = q * r (applying rotation r to existing q)
  return [
    q[0] * rw + q[1] * rz - q[2] * ry + q[3] * rx,
    -q[0] * rz + q[1] * rw + q[2] * rx + q[3] * ry,
    q[0] * ry - q[1] * rx + q[2] * rw + q[3] * rz,
    -q[0] * rx - q[1] * ry - q[2] * rz + q[3] * rw,
  ];
}

function getOrCreateState(ballId: number): BallRotState {
  let state = ballStates.get(ballId);
  if (!state) {
    state = { quat: [1, 0, 0, 0] };
    // Randomize initial orientation slightly (matches original)
    const rx = 10 * Math.random() - 5;
    const ry = 10 * Math.random() - 5;
    const rz = 10 * Math.random() - 5;
    const mag = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (mag > 0.01) {
      state.quat = normalize(rotateQuat(state.quat, rz / mag, -rx / mag, ry / mag, mag / 23));
    }
    ballStates.set(ballId, state);
  }
  return state;
}

/** Extract rendering angles from quaternion (matches original renderBall). */
function quatToAngles(q: Quat): { yaw: number; pitch: number; roll: number; gimbalLock: boolean } {
  const [w, x, y, z] = q;
  // Euler angles (ZXY convention matching original)
  const yaw = Math.atan2(2 * w * z - 2 * x * y, 1 - 2 * w * w - 2 * y * y) + Math.PI;
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * x * w + 2 * y * z))) + Math.PI;
  const roll = Math.atan2(2 * x * z - 2 * w * y, 1 - 2 * x * x - 2 * y * y) + Math.PI;
  const test = x * w + y * z;
  return { yaw, pitch, roll, gimbalLock: test > 0.499 || test < -0.499 };
}

/** Update ball rotation based on velocity (call each animation frame). */
export function updateBallRotation(ballId: number, vx: number, vy: number): void {
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed < 0.5) return;

  const state = getOrCreateState(ballId);
  // Map velocity to rotation: ball rolls in direction of movement
  // Rotation axis is perpendicular to velocity direction
  // Amount = distance / radius (rolling without slipping)
  const circRad = 23; // ballRadius * physScale = 2300 * 0.01
  state.quat = normalize(rotateQuat(state.quat, vy / speed, -vx / speed, 0, speed / circRad));
}

/** Reset all rotation state (e.g. new game). */
export function resetBallRotations(): void {
  ballStates.clear();
}

// --- Drawing helpers ---

/** Draw a frame from a sprite sheet. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  frame: number,
  fw: number, fh: number, cols: number,
  dx: number, dy: number, dw: number, dh: number,
): void {
  const col = frame % cols;
  const row = Math.floor(frame / cols);
  ctx.drawImage(sheet, col * fw, row * fh, fw, fh, dx, dy, dw, dh);
}

/** Draw the number/spot overlay with 3D positioning on the ball surface. */
function drawSpot(
  ctx: CanvasRenderingContext2D,
  spotSheet: HTMLImageElement,
  ballId: number,
  cx: number, cy: number,
  radiusPx: number,
  yaw: number, pitch: number, roll: number,
): void {
  // Project spot position onto ball surface (matches original renderBall)
  let spotX: number, spotY: number;

  if (pitch < Math.PI / 2 || pitch > 3 * Math.PI / 2) {
    if (roll > Math.PI / 2 && roll < 3 * Math.PI / 2) {
      spotY = radiusPx * Math.cos(roll) * Math.sin(pitch);
      spotX = radiusPx * Math.sin(roll);
    } else {
      spotY = -radiusPx * Math.cos(roll) * Math.sin(pitch);
      spotX = -radiusPx * Math.sin(roll);
    }
  } else {
    if (roll > Math.PI / 2 && roll < 3 * Math.PI / 2) {
      spotY = -radiusPx * Math.cos(roll) * Math.sin(pitch);
      spotX = -radiusPx * Math.sin(roll);
    } else {
      spotY = radiusPx * Math.cos(roll) * Math.sin(pitch);
      spotX = radiusPx * Math.sin(roll);
    }
  }

  // Calculate foreshortening and visibility
  const dist = Math.sqrt(spotX * spotX + spotY * spotY) / radiusPx;
  const foreshorten = Math.cos(dist * Math.PI / 2);
  if (foreshorten <= 0) return; // spot is on the far side of the ball

  const spotAngle = Math.atan2(spotY, spotX);
  const spotSize = radiusPx * 1.0; // spot display size

  ctx.save();
  ctx.translate(cx + spotX, cy + spotY);
  // Apply foreshortening: scale Y by foreshorten factor, rotate to face correct direction
  ctx.rotate(spotAngle + Math.PI / 2);
  ctx.scale(1, foreshorten);
  ctx.rotate(-(spotAngle + Math.PI / 2));
  // Rotate spot by yaw so the number faces the right way
  ctx.rotate(yaw - Math.PI);
  ctx.globalAlpha = Math.min(1, foreshorten + 0.2);

  // Draw spot from sprite sheet
  const spotCol = ballId % SPOT_COLS;
  const spotRow = Math.floor(ballId / SPOT_COLS);
  ctx.drawImage(
    spotSheet,
    spotCol * SPOT_FW, spotRow * SPOT_FH, SPOT_FW, SPOT_FH,
    -spotSize / 2, -spotSize / 2, spotSize, spotSize,
  );
  ctx.restore();
}

/** Draw a single ball with full compositing and 3D rotation. */
export function drawBall(
  ctx: CanvasRenderingContext2D,
  assets: PoolAssets,
  ballId: number,
  cx: number,
  cy: number,
  radiusPx: number,
): void {
  const diameter = radiusPx * 2;
  const half = radiusPx;
  const shadeSize = radiusPx * 2.1; // shade is slightly larger (matches original: 2.1 * circRad)
  const state = getOrCreateState(ballId);
  const { yaw, pitch, roll, gimbalLock } = quatToAngles(state.quat);

  if (gimbalLock) {
    // Skip spot rendering at gimbal lock to avoid glitches (matches original)
  }

  if (ballId === 0) {
    // === CUE BALL ===
    // Base white circle
    drawFrame(ctx, assets.images.solidsSpriteSheet, 0, SOLID_FW, SOLID_FH, SOLID_COLS,
      cx - half, cy - half, diameter, diameter);
    // Number spot (frame 0 = black dot)
    if (!gimbalLock) {
      drawSpot(ctx, assets.images.spotSpriteSheet, 0, cx, cy, radiusPx, yaw, pitch, roll);
    }
    // Shade overlay
    ctx.drawImage(assets.images.shade,
      cx - shadeSize / 2, cy - shadeSize / 2, shadeSize, shadeSize);
  } else if (ballId <= 8) {
    // === SOLID BALLS (1-7) + 8-BALL ===
    // Base colored circle from solidsSpriteSheet
    drawFrame(ctx, assets.images.solidsSpriteSheet, ballId, SOLID_FW, SOLID_FH, SOLID_COLS,
      cx - half, cy - half, diameter, diameter);
    // Number spot
    if (!gimbalLock) {
      drawSpot(ctx, assets.images.spotSpriteSheet, ballId, cx, cy, radiusPx, yaw, pitch, roll);
    }
    // Shade overlay
    ctx.drawImage(assets.images.shade,
      cx - shadeSize / 2, cy - shadeSize / 2, shadeSize, shadeSize);
  } else {
    // === STRIPE BALLS (9-15) ===
    // Stripe texture from per-ball sprite sheet, frame selected by pitch
    const sheet = assets.images.ballSpriteSheets[ballId];
    if (sheet) {
      // Determine frame from pitch (matches original: frame = 41 - round(41 * p))
      const p = (pitch - Math.PI / 2) / Math.PI;
      const pClamped = Math.max(0, Math.min(1, p));
      const frame = Math.min(STRIPE_FRAMES - 1, Math.max(0,
        STRIPE_FRAMES - 1 - Math.round((STRIPE_FRAMES - 1) * pClamped)));

      // Draw rotated by yaw (the stripe pattern orbits around the ball)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(yaw - Math.PI);
      drawFrame(ctx, sheet, frame, STRIPE_FW, STRIPE_FH, STRIPE_COLS,
        -half, -half, diameter, diameter);
      ctx.restore();
    }
    // Number spot
    if (!gimbalLock) {
      drawSpot(ctx, assets.images.spotSpriteSheet, ballId, cx, cy, radiusPx, yaw, pitch, roll);
    }
    // Shade overlay (stays fixed, doesn't rotate)
    ctx.drawImage(assets.images.shade,
      cx - shadeSize / 2, cy - shadeSize / 2, shadeSize, shadeSize);
  }
}

/** Draw a ball being pocketed (shrinking into pocket). */
export function drawPocketingBall(
  ctx: CanvasRenderingContext2D,
  assets: PoolAssets,
  ballId: number,
  cx: number,
  cy: number,
  radiusPx: number,
  scale: number, // 1.0 → 0.0
): void {
  if (scale <= 0) return;
  ctx.save();
  ctx.globalAlpha = scale;
  drawBall(ctx, assets, ballId, cx, cy, radiusPx * scale);
  ctx.restore();
}

/** Draw a sprite frame from a sprite sheet (for UI use). */
export function drawSpriteFrame(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  frame: number,
  frameWidth: number,
  frameHeight: number,
  columns: number,
  dx: number, dy: number, dw: number, dh: number,
): void {
  const col = frame % columns;
  const row = Math.floor(frame / columns);
  ctx.drawImage(sheet, col * frameWidth, row * frameHeight, frameWidth, frameHeight, dx, dy, dw, dh);
}
