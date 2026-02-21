// Main pool table canvas — sprite-based rendering with 8Ball-Pool-HTML5 assets.
// Includes animated cue stick with pull-back, strike, and follow-through.

import { useRef, useEffect, useCallback, useState } from 'react';
import { MAX_POWER, BALL_RADIUS } from './constants';
import { createStandard8BallTable, type Table } from './TableGeometry';
import { PoolAssets } from './AssetLoader';
import { drawBall, drawPocketingBall } from './BallRenderer';
import {
  CANVAS_WIDTH, CANVAS_HEIGHT,
  TABLE_CX, TABLE_CY, TABLE_H,
  CLOTH_W, CLOTH_H, TABLE_TOP_W, TABLE_TOP_H, POCKETS_W, POCKETS_H,
  BALL_R_PX, physToCanvas, canvasToPhys,
} from './canvasLayout';
import { type BallState, type BallGroup, type ShotParams, type PocketingAnim } from './types';

// --- Marker sprite sheet constants (from marker.json) ---
// 60 frames, 186x186 each, packed in a sprite atlas.
// Frame order in the JSON: marker0025..marker0060, marker0001..marker0024
// We parse positions from the JSON at build time. The atlas is 1495x1495.
const MARKER_FRAME_SIZE = 186;
const MARKER_TOTAL_FRAMES = 60;
const MARKER_FPS = 40;
const MARKER_ANIM_INTERVAL = 5000; // restart animation every 5s

// Pre-computed frame positions (col*187, row*187 grid approach won't work since atlas is packed).
// From the JSON, frames are laid out in 8 columns (0..7) of 187px pitch, rows of 187px pitch.
// Actually they're at multiples of 187: 0,187,374,561,748,935,1122,1309 for x and y.
// The JSON frame order is: 25-60, then 1-24. We'll build a lookup for animation frame order 1-60.
function buildMarkerFrameMap(): Array<{ x: number; y: number }> {
  // Grid positions from the JSON (8 cols, rows go 0,187,374,561,748,935,1122,1309)
  const positions: Array<{ x: number; y: number; idx: number }> = [];
  // Row-major order from the atlas: each cell at (col*187, row*187)
  const cols = 8; // 0..1309 in steps of 187
  const rows = 8; // 0..1309 in steps of 187
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions.push({ x: c * 187, y: r * 187, idx: positions.length });
    }
  }
  // The JSON lists frames in order: 25,26,...,60,1,2,...,24 (positions 0..59)
  // We want animation order 1..60
  const jsonOrder: number[] = [];
  for (let i = 25; i <= 60; i++) jsonOrder.push(i);
  for (let i = 1; i <= 24; i++) jsonOrder.push(i);

  // Map from animation frame (1-60) to atlas position
  const frameMap = new Array<{ x: number; y: number }>(61);
  for (let jsonIdx = 0; jsonIdx < 60; jsonIdx++) {
    const animFrame = jsonOrder[jsonIdx]; // 1-60
    frameMap[animFrame] = positions[jsonIdx];
  }
  return frameMap;
}
const MARKER_FRAMES = buildMarkerFrameMap();

// --- Guide line raycasting helpers (operates in physics coordinates) ---

/** Line-circle intersection: returns the enter point if the line from p1→p2 intersects circle at center with given radius. */
function lineIntersectCircle(
  p1x: number, p1y: number, p2x: number, p2y: number,
  cx: number, cy: number, radius: number,
): { intersects: boolean; enterX: number; enterY: number } {
  const dx = p2x - p1x;
  const dy = p2y - p1y;
  const fx = p1x - cx;
  const fy = p1y - cy;

  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;

  let discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return { intersects: false, enterX: 0, enterY: 0 };

  discriminant = Math.sqrt(discriminant);
  const t = (-b - discriminant) / (2 * a);

  if (t >= 0 && t <= 1) {
    return {
      intersects: true,
      enterX: p1x + t * dx,
      enterY: p1y + t * dy,
    };
  }
  return { intersects: false, enterX: 0, enterY: 0 };
}

// Re-export types for backward compatibility
export { type BallState, type BallGroup, type ShotParams, type PocketingAnim } from './types';

// Cue animation state machine
type CuePhase = 'aiming' | 'striking' | 'followThrough' | 'hidden';

interface CueStrikeState {
  phase: CuePhase;
  // Strike animation
  strikeStartTime: number;    // performance.now() when strike began
  strikeDuration: number;     // ms for cue to reach ball
  // The power/angle at time of shot
  shotPower: number;
  shotAngle: number;
  // Pull-back distance at moment of release (start of strike)
  pullbackPx: number;
  // Follow-through
  followStartTime: number;    // when follow-through + fade begins
  fadeDuration: number;       // ms for cue to fade out
  // Fixed position — captured at strike time so cue doesn't follow the moving ball
  strikeCanvasX: number;
  strikeCanvasY: number;
}

interface PoolCanvasProps {
  balls: BallState[];
  myTurn: boolean;
  ballInHand: boolean;
  isBreakShot: boolean;
  myGroup: BallGroup;
  opponentGroup: BallGroup;
  animating: boolean;
  onTakeShot: (params: ShotParams) => void;
  onPlaceCueBall: (x: number, y: number) => void;
  assets: PoolAssets;
  showGuideLine?: boolean;
  pocketingBalls?: PocketingAnim[];
}

export default function PoolCanvas({
  balls, myTurn, ballInHand, isBreakShot, myGroup, opponentGroup: _opponentGroup,
  animating, onTakeShot, onPlaceCueBall, assets, showGuideLine = true, pocketingBalls = [],
}: PoolCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [aimAngle, setAimAngle] = useState(0);
  const [power, setPower] = useState(0);
  const [settingPower, setSettingPower] = useState(false);
  const [mouseStart, setMouseStart] = useState<{ x: number; y: number } | null>(null);
  const [ballInHandPos, setBallInHandPos] = useState<{ cx: number; cy: number } | null>(null);
  const tableRef = useRef<Table | null>(null);

  // Cue animation state
  const cueStateRef = useRef<CueStrikeState>({
    phase: 'aiming',
    strikeStartTime: 0,
    strikeDuration: 0,
    shotPower: 0,
    shotAngle: 0,
    pullbackPx: 0,
    followStartTime: 0,
    fadeDuration: 1000,
    strikeCanvasX: 0,
    strikeCanvasY: 0,
  });
  // Track whether shot has been fired (to avoid double-fire)
  const shotFiredRef = useRef(false);

  if (!tableRef.current) {
    tableRef.current = createStandard8BallTable();
  }

  // Reset cue to aiming when it becomes our turn and we're not animating
  useEffect(() => {
    if (myTurn && !animating && !ballInHand) {
      cueStateRef.current.phase = 'aiming';
      shotFiredRef.current = false;
    }
  }, [myTurn, animating, ballInHand]);

  // When external animation starts (from shot result), hide cue
  useEffect(() => {
    if (animating) {
      // If we're in follow-through or striking, let it continue
      // The cue will naturally be hidden or fading
      if (cueStateRef.current.phase === 'aiming') {
        cueStateRef.current.phase = 'hidden';
      }
    }
  }, [animating]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Dark background
    ctx.fillStyle = '#0e1628';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // === TABLE LAYERS (all centered on same point, matching original game) ===
    ctx.drawImage(
      assets.images.pockets,
      TABLE_CX - POCKETS_W / 2, TABLE_CY - POCKETS_H / 2,
      POCKETS_W, POCKETS_H,
    );
    ctx.drawImage(
      assets.images.cloth,
      TABLE_CX - CLOTH_W / 2, TABLE_CY - CLOTH_H / 2,
      CLOTH_W, CLOTH_H,
    );
    ctx.drawImage(
      assets.images.tableTop,
      TABLE_CX - TABLE_TOP_W / 2, TABLE_CY - TABLE_TOP_H / 2,
      TABLE_TOP_W, TABLE_TOP_H,
    );

    // Head string line (for break shot ball placement)
    if (isBreakShot && ballInHand) {
      const [lx] = physToCanvas(-15000 * 2.3, 0);
      const playTop = TABLE_CY - TABLE_H / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(lx, playTop);
      ctx.lineTo(lx, playTop + TABLE_H);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // === BALLS ===
    const sortedBalls = [...balls].sort((a, b) => {
      if (a.id === 0) return 1;
      if (b.id === 0) return -1;
      return 0;
    });

    // Draw shadows first (under all balls)
    const shadowSize = BALL_R_PX * 4;
    for (const ball of sortedBalls) {
      if (!ball.active) continue;
      const [bx, by] = physToCanvas(ball.x, ball.y);
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.drawImage(assets.images.shadow, bx - shadowSize / 2, by - shadowSize / 2, shadowSize, shadowSize);
      ctx.restore();
    }

    // Draw balls on top
    for (const ball of sortedBalls) {
      if (!ball.active) continue;
      const [bx, by] = physToCanvas(ball.x, ball.y);
      drawBall(ctx, assets, ball.id, bx, by, BALL_R_PX);
    }

    // === BALL GROUP MARKERS (animated pulsing highlight for current player's balls) ===
    const now = performance.now();
    if (myTurn && !animating && !ballInHand && myGroup !== 'ANY') {
      // Determine which balls to highlight
      for (const ball of sortedBalls) {
        if (!ball.active || ball.id === 0) continue;
        const isSolid = ball.id >= 1 && ball.id <= 7;
        const isStripe = ball.id >= 9 && ball.id <= 15;
        const is8Ball = ball.id === 8;

        let shouldMark = false;
        if (myGroup === 'SOLIDS' && isSolid) shouldMark = true;
        if (myGroup === 'STRIPES' && isStripe) shouldMark = true;
        if (myGroup === '8BALL' && is8Ball) shouldMark = true;

        if (shouldMark) {
          const [bx, by] = physToCanvas(ball.x, ball.y);
          // Animate: play 60 frames at 40fps, then pause, repeat every 5s
          const cycleTime = now % MARKER_ANIM_INTERVAL;
          const animDuration = (MARKER_TOTAL_FRAMES / MARKER_FPS) * 1000; // 1500ms
          const startDelay = 500; // brief delay before animation starts

          let markerAlpha = 0;
          let frameIdx = 1;

          if (cycleTime > startDelay && cycleTime < startDelay + animDuration) {
            const elapsed = cycleTime - startDelay;
            frameIdx = Math.min(MARKER_TOTAL_FRAMES, Math.floor((elapsed / 1000) * MARKER_FPS) + 1);
            markerAlpha = 1;
          } else if (cycleTime >= startDelay + animDuration) {
            // After animation: hold last frame briefly then fade
            const fadeStart = startDelay + animDuration;
            const fadeTime = cycleTime - fadeStart;
            markerAlpha = Math.max(0, 1 - fadeTime / 500);
            frameIdx = MARKER_TOTAL_FRAMES;
          }

          if (markerAlpha > 0 && MARKER_FRAMES[frameIdx]) {
            const frame = MARKER_FRAMES[frameIdx];
            const markerSize = BALL_R_PX * 4; // marker is larger than ball
            ctx.save();
            ctx.globalAlpha = markerAlpha * 0.8;
            ctx.drawImage(
              assets.images.marker,
              frame.x, frame.y, MARKER_FRAME_SIZE, MARKER_FRAME_SIZE,
              bx - markerSize / 2, by - markerSize / 2, markerSize, markerSize,
            );
            ctx.restore();
          }
        }
      }
    }

    // === POCKETING ANIMATIONS ===
    for (const pa of pocketingBalls) {
      const elapsed = now - pa.startTime;
      const progress = Math.min(1, elapsed / pa.duration);
      if (progress >= 1) continue;
      const ease = 1 - (1 - progress) * (1 - progress);
      const px = pa.startX + (pa.targetX - pa.startX) * ease;
      const py = pa.startY + (pa.targetY - pa.startY) * ease;
      const scale = 1 - ease;
      drawPocketingBall(ctx, assets, pa.ballId, px, py, BALL_R_PX, scale);
    }

    // === CUE STICK + AIMING GUIDE ===
    const cueBall = balls.find((b) => b.id === 0 && b.active);
    const cue = cueStateRef.current;
    // Show cue: during my turn while aiming, or during strike/follow-through animation
    const showCue = cueBall && !ballInHand && cue.phase !== 'hidden' && (
      (myTurn && !animating && cue.phase === 'aiming') ||
      cue.phase === 'striking' ||
      cue.phase === 'followThrough'
    );

    if (showCue) {
      // During strike/follow-through, use the fixed position captured at strike time
      // so the cue doesn't follow the moving ball (matches original game)
      const [liveCx, liveCy] = physToCanvas(cueBall.x, cueBall.y);
      const cx = (cue.phase === 'striking' || cue.phase === 'followThrough') ? cue.strikeCanvasX : liveCx;
      const cy = (cue.phase === 'striking' || cue.phase === 'followThrough') ? cue.strikeCanvasY : liveCy;
      const cueDrawLen = BALL_R_PX * 18;
      const cueDrawThick = BALL_R_PX * 0.8;
      const baseGap = BALL_R_PX * 1.5;

      // Determine cue position based on animation phase
      let cueOffset = baseGap; // distance from ball center to cue tip
      let cueAlpha = 1;
      let showGuide = showGuideLine && cue.phase === 'aiming';
      const drawAngle = cue.phase === 'aiming' ? aimAngle : cue.shotAngle;

      if (cue.phase === 'aiming') {
        // Pull back proportional to power while charging
        if (settingPower) {
          cueOffset = baseGap + power * 0.018;
        }
      } else if (cue.phase === 'striking') {
        // Tween from pulled-back position toward ball
        const elapsed = now - cue.strikeStartTime;
        const t = Math.min(1, elapsed / cue.strikeDuration);
        // Ease out (decelerating toward ball)
        const easeT = 1 - (1 - t) * (1 - t);

        // Start position: baseGap + pullback; End position: -BALL_R_PX (past center slightly)
        const startOffset = baseGap + cue.pullbackPx;
        const endOffset = -BALL_R_PX * 0.3; // tip goes slightly past ball center
        cueOffset = startOffset + (endOffset - startOffset) * easeT;

        // Fire the shot when tip reaches the ball (offset reaches baseGap going down)
        if (cueOffset <= baseGap && !shotFiredRef.current) {
          shotFiredRef.current = true;
          onTakeShot({ angle: cue.shotAngle, power: cue.shotPower, screw: 0, english: 0 });
        }

        // Transition to follow-through when strike completes
        if (t >= 1) {
          cue.phase = 'followThrough';
          cue.followStartTime = now;
          cue.fadeDuration = 800;
        }
      } else if (cue.phase === 'followThrough') {
        // Cue stays at forward position and fades out
        const elapsed = now - cue.followStartTime;
        const fadeDelay = 200; // brief pause before fading

        cueOffset = -BALL_R_PX * 0.3;

        if (elapsed > fadeDelay) {
          const fadeT = Math.min(1, (elapsed - fadeDelay) / cue.fadeDuration);
          cueAlpha = 1 - fadeT;
        }

        // When fully faded, transition to hidden
        if (elapsed > fadeDelay + cue.fadeDuration) {
          cue.phase = 'hidden';
          cueAlpha = 0;
        }
      }

      // Draw guide line with physics raycasting (matching original game)
      if (showGuide && cueBall) {
        const dirX = Math.cos(drawAngle);
        const dirY = Math.sin(drawAngle);
        // Ray from cue ball in aim direction (physics coords)
        const rayEndX = cueBall.x + dirX * 500000;
        const rayEndY = cueBall.y + dirY * 500000;
        const collisionRadius = BALL_RADIUS * 2; // two ball radii for ball-ball collision

        // Find closest ball intersection
        let closestBall: BallState | null = null;
        let closestEnterX = 0, closestEnterY = 0;
        let closestDistSq = Infinity;

        for (const b of balls) {
          if (b.id === 0 || !b.active) continue;
          const hit = lineIntersectCircle(
            cueBall.x, cueBall.y, rayEndX, rayEndY,
            b.x, b.y, collisionRadius,
          );
          if (hit.intersects) {
            const dSq = (b.x - cueBall.x) ** 2 + (b.y - cueBall.y) ** 2;
            if (dSq < closestDistSq) {
              closestDistSq = dSq;
              closestBall = b;
              closestEnterX = hit.enterX;
              closestEnterY = hit.enterY;
            }
          }
        }

        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';

        if (closestBall) {
          // Draw line from cue ball to impact point
          const [fromX, fromY] = physToCanvas(cueBall.x, cueBall.y);
          const [toX, toY] = physToCanvas(closestEnterX, closestEnterY);
          ctx.beginPath();
          ctx.moveTo(fromX, fromY);
          ctx.lineTo(toX, toY);
          ctx.stroke();

          // Ghost circle at impact point (shows where cue ball will be)
          ctx.beginPath();
          ctx.arc(toX, toY, BALL_R_PX, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.stroke();

          // Target ball deflection line
          const deflectDirX = closestBall.x - closestEnterX;
          const deflectDirY = closestBall.y - closestEnterY;
          const deflectLen = Math.sqrt(deflectDirX ** 2 + deflectDirY ** 2);
          if (deflectLen > 0.01) {
            const ndx = deflectDirX / deflectLen;
            const ndy = deflectDirY / deflectLen;
            // Deflection line length based on angle (shorter for thin cuts)
            const bearing1 = Math.atan2(closestEnterY - cueBall.y, closestEnterX - cueBall.x);
            const bearing2 = Math.atan2(ndy, ndx);
            const angleDiff = Math.abs(Math.atan2(Math.sin(bearing2 - bearing1), Math.cos(bearing2 - bearing1)));
            const lineLen = BALL_RADIUS * 5 * ((Math.PI / 2 - angleDiff) / (Math.PI / 2));
            const targetEndX = closestBall.x + ndx * Math.max(lineLen, BALL_RADIUS);
            const targetEndY = closestBall.y + ndy * Math.max(lineLen, BALL_RADIUS);

            const [tbx, tby] = physToCanvas(closestBall.x, closestBall.y);
            const [tex, tey] = physToCanvas(targetEndX, targetEndY);
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.moveTo(tbx, tby);
            ctx.lineTo(tex, tey);
            ctx.stroke();

            // Cue ball deflection line (after contact, cue ball goes at right angle)
            const cueBearing = bearing1;
            const cueDeflectAngle = bearing2 > cueBearing
              ? cueBearing - (Math.PI / 2 - angleDiff)
              : cueBearing + (Math.PI / 2 - angleDiff);
            const cueLineLen = BALL_RADIUS * 5 * angleDiff / (Math.PI / 2);
            if (cueLineLen > BALL_RADIUS * 0.5) {
              const cueEndX = closestEnterX + Math.cos(cueDeflectAngle) * cueLineLen;
              const cueEndY = closestEnterY + Math.sin(cueDeflectAngle) * cueLineLen;
              const [cex, cey] = physToCanvas(cueEndX, cueEndY);
              ctx.beginPath();
              ctx.strokeStyle = 'rgba(255,255,255,0.4)';
              ctx.moveTo(toX, toY);
              ctx.lineTo(cex, cey);
              ctx.stroke();
            }
          }
        } else {
          // No ball in path — trace to table boundary
          const halfW = 138000 / 2 - BALL_RADIUS;
          const halfH = 69000 / 2 - BALL_RADIUS;
          const walls = [
            { x1: -halfW, y1: -halfH, x2: halfW, y2: -halfH },  // top
            { x1: halfW, y1: -halfH, x2: halfW, y2: halfH },    // right
            { x1: halfW, y1: halfH, x2: -halfW, y2: halfH },    // bottom
            { x1: -halfW, y1: halfH, x2: -halfW, y2: -halfH },  // left
          ];
          let wallHitX = rayEndX, wallHitY = rayEndY;
          let minT = Infinity;
          for (const w of walls) {
            const denom = (w.y2 - w.y1) * dirX - (w.x2 - w.x1) * dirY;
            if (Math.abs(denom) < 0.001) continue;
            const t = ((w.x2 - w.x1) * (cueBall.y - w.y1) - (w.y2 - w.y1) * (cueBall.x - w.x1)) / denom;
            if (t > 0 && t < minT) {
              const u = dirX !== 0
                ? (cueBall.x + t * dirX - w.x1) / (w.x2 - w.x1)
                : (cueBall.y + t * dirY - w.y1) / (w.y2 - w.y1);
              if (u >= 0 && u <= 1) {
                minT = t;
                wallHitX = cueBall.x + t * dirX;
                wallHitY = cueBall.y + t * dirY;
              }
            }
          }
          const [fromX, fromY] = physToCanvas(cueBall.x, cueBall.y);
          const [toX, toY] = physToCanvas(wallHitX, wallHitY);
          ctx.beginPath();
          ctx.moveTo(fromX, fromY);
          ctx.lineTo(toX, toY);
          ctx.stroke();

          // Ghost circle at wall hit
          ctx.beginPath();
          ctx.arc(toX, toY, BALL_R_PX, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.stroke();
        }
        ctx.restore();
      }

      // Draw cue stick
      // cue.png: left=butt, right=tip (the hitting end).
      // We rotate to aimAngle so positive X = aim direction.
      // The cue is drawn at negative X (behind ball), with its right edge (tip)
      // at -cueOffset from center (closest to ball).
      if (cueAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = cueAlpha;
        ctx.translate(cx, cy);
        ctx.rotate(drawAngle);

        // Right edge (tip) at -cueOffset, left edge (butt) at -(cueOffset + cueDrawLen)
        const cueX = -(cueOffset + cueDrawLen);
        const cueY = -cueDrawThick / 2;

        // Shadow
        ctx.save();
        ctx.translate(3, 4);
        ctx.globalAlpha = cueAlpha * 0.35;
        ctx.drawImage(assets.images.cueShadow, cueX, cueY, cueDrawLen, cueDrawThick);
        ctx.restore();

        // Cue body
        ctx.globalAlpha = cueAlpha;
        ctx.drawImage(assets.images.cue, cueX, cueY, cueDrawLen, cueDrawThick);
        ctx.restore();
      }

      // Power indicator bar (only during aiming + charging)
      if (cue.phase === 'aiming' && settingPower && power > 0) {
        const barX = CANVAS_WIDTH - 28;
        const barTop = TABLE_CY - TABLE_H / 2;
        const barH = TABLE_H;
        const barW = 12;
        const powerPct = power / MAX_POWER;

        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(barX, barTop, barW, barH);

        const g = Math.round(255 * (1 - powerPct));
        ctx.fillStyle = `rgb(255, ${g}, 0)`;
        ctx.fillRect(barX, barTop + barH * (1 - powerPct), barW, barH * powerPct);

        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barTop, barW, barH);
      }
    }

    // Ball-in-hand: show ghost cue ball at cursor position + instruction text
    if (myTurn && ballInHand && !animating) {
      // Draw ghost cue ball at last known mouse position (if available)
      if (ballInHandPos) {
        const [ghx, ghy] = [ballInHandPos.cx, ballInHandPos.cy];
        ctx.save();
        ctx.globalAlpha = 0.5;
        drawBall(ctx, assets, 0, ghx, ghy, BALL_R_PX);
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Click to place cue ball', CANVAS_WIDTH / 2, TABLE_CY - TABLE_H / 2 - 10);
    }
  }, [balls, myTurn, animating, ballInHand, ballInHandPos, isBreakShot, myGroup, aimAngle, power, settingPower, showGuideLine, assets, pocketingBalls, onTakeShot]);

  // Render loop
  useEffect(() => {
    let animId: number;
    const loop = () => {
      draw();
      animId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animId);
  }, [draw]);

  // Initiate the cue strike animation
  const startStrike = useCallback((shotAngle: number, shotPower: number) => {
    const cue = cueStateRef.current;
    // Calculate strike duration: faster for stronger shots
    // Reference game: duration = 1/power seconds, clamped 0.1s to 0.8s
    let duration = 1 / (shotPower / 1000); // 1000ms at power=1000, 200ms at power=5000
    duration = Math.max(80, Math.min(600, duration * 1000)); // clamp 80ms-600ms

    // Capture cue ball position so cue stays fixed during strike/follow-through
    const cueBall = balls.find((b) => b.id === 0 && b.active);
    if (cueBall) {
      const [scx, scy] = physToCanvas(cueBall.x, cueBall.y);
      cue.strikeCanvasX = scx;
      cue.strikeCanvasY = scy;
    }

    cue.phase = 'striking';
    cue.strikeStartTime = performance.now();
    cue.strikeDuration = duration;
    cue.shotPower = shotPower;
    cue.shotAngle = shotAngle;
    cue.pullbackPx = shotPower * 0.018; // matches the charging pullback
    shotFiredRef.current = false;
  }, [balls]);

  // Convert client pixel coords to canvas coords
  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { mx: 0, my: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      mx: ((clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      my: ((clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  }, []);

  // Mouse handlers
  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    return clientToCanvas(e.clientX, e.clientY);
  }, [clientToCanvas]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (animating || !myTurn) return;
    const cue = cueStateRef.current;
    if (cue.phase !== 'aiming') return; // Don't update aim during strike/follow-through

    const { mx, my } = getCanvasCoords(e);

    const cueBall = balls.find((b) => b.id === 0 && b.active);
    if (!cueBall) return;
    const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);

    if (ballInHand) {
      // Track cursor position for ghost cue ball preview
      setBallInHandPos({ cx: mx, cy: my });
      return;
    }

    if (settingPower && mouseStart) {
      // Aim is locked during power setting (matches original).
      // Project drag onto aim direction (pulling back from ball).
      const dx = -(mx - mouseStart.x);
      const dy = -(my - mouseStart.y);
      const aimDirX = Math.cos(aimAngle);
      const aimDirY = Math.sin(aimAngle);
      let r = dx * aimDirX + dy * aimDirY;
      const maxDrag = 180;
      if (r < 0) r = 0;
      if (r > maxDrag) r = maxDrag;
      setPower(MAX_POWER * (Math.pow(r, 1.4) / Math.pow(maxDrag, 1.4)));
      return;
    }

    // Only update aim if mouse is far enough from the cue ball to avoid jitter
    const dist = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2);
    if (dist > BALL_R_PX * 2) {
      setAimAngle(Math.atan2(my - cy, mx - cx));
    }
  }, [balls, myTurn, animating, ballInHand, settingPower, mouseStart, aimAngle, getCanvasCoords]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!myTurn || animating) return;
    const cue = cueStateRef.current;
    if (cue.phase !== 'aiming') return;

    const { mx, my } = getCanvasCoords(e);

    if (ballInHand) {
      // Click to place cue ball
      const [px, py] = canvasToPhys(mx, my);
      onPlaceCueBall(px, py);
      setBallInHandPos(null);
      return;
    }

    setSettingPower(true);
    setMouseStart({ x: mx, y: my });
    setPower(0);
  }, [myTurn, animating, ballInHand, getCanvasCoords, onPlaceCueBall]);

  const handleMouseUp = useCallback((_e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!myTurn || animating) return;

    if (ballInHand) return; // Placement handled in mouseDown

    if (settingPower && power > 40) {
      // Start cue strike animation instead of immediately firing
      startStrike(aimAngle, power);
    }

    setSettingPower(false);
    setPower(0);
    setMouseStart(null);
  }, [myTurn, animating, ballInHand, settingPower, power, aimAngle, startStrike, onPlaceCueBall, getCanvasCoords]);

  // Touch handlers for mobile
  const getTouchCoords = useCallback((touch: React.Touch) => {
    return clientToCanvas(touch.clientX, touch.clientY);
  }, [clientToCanvas]);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!myTurn || animating || !e.touches[0]) return;
    const cue = cueStateRef.current;
    if (cue.phase !== 'aiming') return;

    const { mx, my } = getTouchCoords(e.touches[0]);

    if (ballInHand) {
      // Touch to place cue ball
      const [px, py] = canvasToPhys(mx, my);
      onPlaceCueBall(px, py);
      setBallInHandPos(null);
      return;
    }

    const cueBall = balls.find((b) => b.id === 0 && b.active);
    if (cueBall) {
      const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);
      setAimAngle(Math.atan2(my - cy, mx - cx));
    }

    setSettingPower(true);
    setMouseStart({ x: mx, y: my });
    setPower(0);
  }, [myTurn, animating, ballInHand, balls, getTouchCoords, onPlaceCueBall]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (animating || !myTurn || !e.touches[0]) return;
    const cue = cueStateRef.current;
    if (cue.phase !== 'aiming') return;

    const { mx, my } = getTouchCoords(e.touches[0]);

    if (ballInHand) {
      setBallInHandPos({ cx: mx, cy: my });
      return;
    }

    const cueBall = balls.find((b) => b.id === 0 && b.active);
    if (!cueBall) return;
    const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);

    if (settingPower && mouseStart) {
      // Touch: use vertical drag distance for power (original game uses power bar on side)
      const dy = my - mouseStart.y;
      const maxDrag = 500;
      let r = Math.max(0, Math.min(maxDrag, dy));
      setPower(MAX_POWER * (Math.pow(r, 1.4) / Math.pow(maxDrag, 1.4)));
      return;
    }

    setAimAngle(Math.atan2(my - cy, mx - cx));
  }, [balls, myTurn, animating, ballInHand, settingPower, mouseStart, getTouchCoords]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!myTurn || animating) return;

    if (ballInHand) return; // Placement handled in touchStart

    if (settingPower && power > 40) {
      // Start cue strike animation instead of immediately firing
      startStrike(aimAngle, power);
    }

    setSettingPower(false);
    setPower(0);
    setMouseStart(null);
  }, [myTurn, animating, ballInHand, settingPower, power, aimAngle, startStrike, onPlaceCueBall, getTouchCoords]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      style={{ width: '100%', maxWidth: '990px', touchAction: 'none', cursor: myTurn && !animating ? 'crosshair' : 'default' }}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        if (settingPower) {
          setSettingPower(false);
          setPower(0);
          setMouseStart(null);
        }
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    />
  );
}
