// Sprite-based ball renderer with rotation tracking for all balls.

import { PoolAssets } from './AssetLoader';

// Track rotation angle per ball (for canvas rotation — rolling effect)
const ballRotations: Map<number, number> = new Map();
// Track stripe-specific frame index (for sprite sheet frame selection)
const stripeFrames: Map<number, number> = new Map();
const stripeAccum: Map<number, number> = new Map();

/** Update ball rotation based on velocity (call each animation frame). */
export function updateBallRotation(ballId: number, vx: number, vy: number): void {
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed < 10) return;

  // Canvas rotation for rolling visual (all balls)
  const currentAngle = ballRotations.get(ballId) || 0;
  ballRotations.set(ballId, currentAngle + speed * 0.0003);

  // Stripe frame rotation (stripes only)
  if (ballId >= 9 && ballId <= 15) {
    const accum = (stripeAccum.get(ballId) || 0) + speed * 0.00015;
    stripeAccum.set(ballId, accum);
    stripeFrames.set(ballId, Math.floor(accum) % 41);
  }
}

/** Reset all rotation state (e.g. new game). */
export function resetBallRotations(): void {
  ballRotations.clear();
  stripeFrames.clear();
  stripeAccum.clear();
}

/** Draw a single ball with all sprite layers. */
export function drawBall(
  ctx: CanvasRenderingContext2D,
  assets: PoolAssets,
  ballId: number,
  cx: number,
  cy: number,
  radiusPx: number,
): void {
  const size = radiusPx * 2.2;
  const halfSize = size / 2;

  // 1. Shadow (not rotated — stays fixed)
  ctx.drawImage(assets.images.shadow, cx - halfSize + 2, cy - halfSize + 3, size, size);

  // 2. Ball body + spot (rotated together)
  const rotation = ballRotations.get(ballId) || 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);

  if (ballId <= 8) {
    // Solid ball: frame from solidsSpriteSheet (144x144, 3x3 grid, 48x48 per frame)
    const frame = ballId; // 0=cue, 1-8=solids
    const col = frame % 3;
    const row = Math.floor(frame / 3);
    ctx.drawImage(
      assets.images.solidsSpriteSheet,
      col * 48, row * 48, 48, 48,
      -halfSize, -halfSize, size, size,
    );
  } else {
    // Stripe ball: frame from per-ball sprite sheet (256x512, 5 cols, 41 frames, ~51x51 each)
    const sheet = assets.images.ballSpriteSheets[ballId];
    if (sheet) {
      const frame = stripeFrames.get(ballId) ?? 20;
      const fw = 51;
      const fh = 51;
      const cols = 5;
      const col = frame % cols;
      const row = Math.floor(frame / cols);
      ctx.drawImage(
        sheet,
        col * fw, row * fh, fw, fh,
        -halfSize, -halfSize, size, size,
      );
    }
  }

  // 3. Spot/number overlay (rotates with ball)
  // spotSpriteSheet: 152x152, 4x4 grid = 38x38 per frame, frame = ballId
  if (ballId >= 1 && ballId <= 15) {
    const spotSize = size * 0.7;
    const spotHalf = spotSize / 2;
    const spotCol = ballId % 4;
    const spotRow = Math.floor(ballId / 4);
    ctx.drawImage(
      assets.images.spotSpriteSheet,
      spotCol * 38, spotRow * 38, 38, 38,
      -spotHalf, -spotHalf, spotSize, spotSize,
    );
  }

  ctx.restore();

  // 4. 3D sheen overlay (not rotated — light stays fixed)
  ctx.drawImage(assets.images.shade, cx - halfSize, cy - halfSize, size, size);
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
  const size = radiusPx * 2.2 * scale;
  const halfSize = size / 2;

  ctx.save();
  ctx.globalAlpha = scale;
  ctx.translate(cx, cy);

  const rotation = ballRotations.get(ballId) || 0;
  ctx.rotate(rotation);

  if (ballId <= 8) {
    const frame = ballId;
    const col = frame % 3;
    const row = Math.floor(frame / 3);
    ctx.drawImage(
      assets.images.solidsSpriteSheet,
      col * 48, row * 48, 48, 48,
      -halfSize, -halfSize, size, size,
    );
  } else {
    const sheet = assets.images.ballSpriteSheets[ballId];
    if (sheet) {
      const frame = stripeFrames.get(ballId) ?? 20;
      const fw = 51;
      const fh = 51;
      const cols = 5;
      const col = frame % cols;
      const row = Math.floor(frame / cols);
      ctx.drawImage(
        sheet,
        col * fw, row * fh, fw, fh,
        -halfSize, -halfSize, size, size,
      );
    }
  }

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
