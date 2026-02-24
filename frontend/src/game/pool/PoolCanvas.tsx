// Main pool table canvas — sprite-based rendering with 8Ball-Pool-HTML5 assets.
// Includes animated cue stick with pull-back, strike, and follow-through.
// Performance: all canvas-only state uses refs (no React re-renders on mouse move).

import { useRef, useEffect, useCallback } from 'react';
import { MAX_POWER, BALL_RADIUS } from './constants';
import { createStandard8BallTable, type Table } from './TableGeometry';
import { PoolAssets } from './AssetLoader';
import { drawBall, drawPocketingBall } from './BallRenderer';
import {
  CANVAS_WIDTH, CANVAS_HEIGHT,
  TABLE_CX, TABLE_CY, TABLE_W, TABLE_H,
  CLOTH_W, CLOTH_H, TABLE_TOP_W, TABLE_TOP_H, POCKETS_W, POCKETS_H,
  BALL_R_PX, physToCanvas, canvasToPhys,
} from './canvasLayout';
import { type BallState, type BallGroup, type ShotParams, type PocketingAnim } from './types';

// --- Marker sprite sheet constants (from marker.json) ---
const MARKER_FRAME_SIZE = 186;
const MARKER_TOTAL_FRAMES = 60;
const MARKER_FPS = 40;
const MARKER_ANIM_INTERVAL = 5000;

function buildMarkerFrameMap(): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      positions.push({ x: c * 187, y: r * 187 });
    }
  }
  const jsonOrder: number[] = [];
  for (let i = 25; i <= 60; i++) jsonOrder.push(i);
  for (let i = 1; i <= 24; i++) jsonOrder.push(i);
  const frameMap = new Array<{ x: number; y: number }>(61);
  for (let jsonIdx = 0; jsonIdx < 60; jsonIdx++) {
    frameMap[jsonOrder[jsonIdx]] = positions[jsonIdx];
  }
  return frameMap;
}
const MARKER_FRAMES = buildMarkerFrameMap();

// --- Guide line raycasting helpers (physics coordinates) ---
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
    return { intersects: true, enterX: p1x + t * dx, enterY: p1y + t * dy };
  }
  return { intersects: false, enterX: 0, enterY: 0 };
}

// find intersection points between two circles (canvas coordinates)
function circleIntersectCircle(
  x0: number, y0: number, r0: number,
  x1: number, y1: number, r1: number,
): { x3: number; y3: number; x4: number; y4: number } | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d > r0 + r1 || d < Math.abs(r0 - r1) || d === 0) return null;
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
  const xm = x0 + (a * dx) / d;
  const ym = y0 + (a * dy) / d;
  const rx = -(dy * (h / d));
  const ry = dx * (h / d);
  return {
    x3: xm + rx,
    y3: ym + ry,
    x4: xm - rx,
    y4: ym - ry,
  };
}

// helper: choose a random canvas coordinate inside the cloth that does
// not overlap any active non‑cue balls. falls back to centre after a few tries.
function randomBallInHandCanvasPos(): { cx: number; cy: number } {
  const halfW = TABLE_W / 2 - BALL_R_PX;
  const halfH = TABLE_H / 2 - BALL_R_PX;

  // compile list of other balls in canvas space
  const others: Array<{ cx: number; cy: number }> = ballsRefStatic.current
    .filter((b) => b.active && b.id !== 0)
    .map((b) => {
      const [bx, by] = physToCanvas(b.x, b.y);
      return { cx: bx, cy: by };
    });

  for (let i = 0; i < 500; i++) {
    const cx = TABLE_CX - halfW + Math.random() * halfW * 2;
    const cy = TABLE_CY - halfH + Math.random() * halfH * 2;
    let overlap = false;
    for (const b of others) {
      const dx = cx - b.cx;
      const dy = cy - b.cy;
      if (dx * dx + dy * dy < (BALL_R_PX * 2) ** 2) {
        overlap = true;
        break;
      }
    }
    if (!overlap) {
      return { cx, cy };
    }
  }
  return { cx: TABLE_CX, cy: TABLE_CY };
}

// Re-export types for backward compatibility
export { type BallState, type BallGroup, type ShotParams, type PocketingAnim } from './types';

// Cue animation state machine
type CuePhase = 'aiming' | 'striking' | 'followThrough' | 'hidden';

interface CueStrikeState {
  phase: CuePhase;
  strikeStartTime: number;
  strikeDuration: number;
  shotPower: number;
  shotAngle: number;
  pullbackPx: number;
  followStartTime: number;
  fadeDuration: number;
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
  // when the opponent is dragging the cue ball, their canvas coordinates
  // are supplied here so we can render the mover sprite at that location.
  // test-only hook for observing ghost position changes
  onBallInHandPosChanged?: (pos: { cx: number; cy: number } | null) => void;
  // increments when a scratch occurred (resets ghost when ballInHand)
  scratchCount?: number;
}

// static ref used by helper to sample other balls outside of render
const ballsRefStatic = { current: [] as BallState[] };

export default function PoolCanvas({
  balls, myTurn, ballInHand, isBreakShot, myGroup, opponentGroup: _opponentGroup,
  animating, onTakeShot, onPlaceCueBall, assets,
  showGuideLine = true, pocketingBalls = [],
  onBallInHandPosChanged,
  scratchCount = 0,
}: PoolCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tableRef = useRef<Table | null>(null);

  // helper used when the player is moving the cue ball (ball-in-hand).
  // This implements the same behaviour as the original 8-ball game code:
  // the ghost ball is clamped inside the cloth, it is prevented from
  // overlapping other balls, and when dragged between two balls it will
  // slide around them instead of jittering.
  const constrainBallInHand = useCallback((cx: number, cy: number) => {
    // candidate position (canvas coords)
    let x = cx;
    let y = cy;

    // precompute list of other active balls in canvas coordinates
    const others = ballsRef.current
      .filter((b) => b.active && b.id !== 0)
      .map((b) => {
        const [bx, by] = physToCanvas(b.x, b.y);
        return { x: bx, y: by };
      });

    // helper functions ported from the original JS
    const tooClose = (tx: number, ty: number): boolean => {
      for (const b of others) {
        const dx = b.x - tx;
        const dy = b.y - ty;
        if (dx * dx + dy * dy < (BALL_R_PX * 2) * (BALL_R_PX * 2) * 2 + 10) {
          return true;
        }
      }
      return false;
    };

    const tooCloseTight = (tx: number, ty: number): boolean => {
      for (const b of others) {
        const dx = b.x - tx;
        const dy = b.y - ty;
        if (dx * dx + dy * dy < (BALL_R_PX * 2) * (BALL_R_PX * 2) * 2 - 10) {
          return true;
        }
      }
      return false;
    };


    // --- original algorithm follows ---
    const cuePos = { x, y }; // current (possibly inactive) cue position
    const pointer = { x: cx, y: cy };
    const hitBalls: Array<{ x: number; y: number }> = [];
    const hitPoints: Array<{ x: number; y: number }> = [];

    for (const b of others) {
      const hit = lineIntersectCircle(cuePos.x, cuePos.y, pointer.x, pointer.y, b.x, b.y, BALL_R_PX * 2);
      if (hit.intersects) {
        hitBalls.push(b);
        if (hit.enterX || hit.enterY) {
          hitPoints.push({ x: hit.enterX, y: hit.enterY });
        } else {
          hitPoints.push({ x: cuePos.x, y: cuePos.y });
        }
      }
    }

    if (hitBalls.length === 1) {
      const b = hitBalls[0];
      const p = hitPoints[0];
      // push the cue ball away from the collision point
      const vx = b.x - p.x;
      const vy = b.y - p.y;
      const len = Math.hypot(vx, vy) || 1;
      const ux = vx / len;
      const uy = vy / len;
      const offset = BALL_R_PX * 2;
      x = b.x - ux * offset;
      y = b.y - uy * offset;
    } else if (hitBalls.length > 1) {
      // compute intersections between every pair of hit balls
      let bestDist = Infinity;
      for (let i = 0; i < hitBalls.length; i++) {
        for (let j = i + 1; j < hitBalls.length; j++) {
          const a = hitBalls[i];
          const b = hitBalls[j];
          const inter = circleIntersectCircle(a.x, a.y, BALL_R_PX * 2, b.x, b.y, BALL_R_PX * 2);
          if (inter) {
            for (const cand of [
              { x: inter.x3, y: inter.y3 },
              { x: inter.x4, y: inter.y4 },
            ]) {
              if (!tooClose(cand.x, cand.y)) {
                const d2 = (cand.x - pointer.x) ** 2 + (cand.y - pointer.y) ** 2;
                if (d2 < bestDist) {
                  bestDist = d2;
                  x = cand.x;
                  y = cand.y;
                }
              }
            }
          }
        }
      }
      // if we failed to find a valid intersection, fall back to simple push
      if (bestDist === Infinity) {
        for (const b of others) {
          const dx = x - b.x;
          const dy = y - b.y;
          const dist = Math.hypot(dx, dy);
          const minDist = BALL_R_PX * 2;
          if (dist < minDist && dist > 0) {
            const ang = Math.atan2(dy, dx);
            x = b.x + Math.cos(ang) * minDist;
            y = b.y + Math.sin(ang) * minDist;
          }
        }
      }
    } else {
      // no hits along pointer ray – simply follow the pointer
      x = pointer.x;
      y = pointer.y;
    }

    // clamp inside table cloth
    const halfW = TABLE_W / 2 - BALL_R_PX;
    const halfH = TABLE_H / 2 - BALL_R_PX;
    x = Math.max(TABLE_CX - halfW, Math.min(TABLE_CX + halfW, x));
    y = Math.max(TABLE_CY - halfH, Math.min(TABLE_CY + halfH, y));

    // final nudges if still overlapping
    while (tooCloseTight(x, y)) {
      x -= BALL_R_PX / 4;
    }

    return { cx: x, cy: y };
  }, []);

  // --- Canvas-only state as refs (no React re-renders) ---
  const aimAngleRef = useRef(0);
  const powerRef = useRef(0);
  const dragDistRef = useRef(0); // raw drag distance (0-180) for cue pullback visual
  const settingPowerRef = useRef(false);
  const mouseStartRef = useRef<{ x: number; y: number } | null>(null);
  const ballInHandPosRef = useRef<{ cx: number; cy: number } | null>(null);
  // we only start moving the cue ball if pointer down occurs on the ghost ball
  const ballInHandDraggingRef = useRef(false);
  const ballInHandHoverRef = useRef(false);
  const placedInCenterRef = useRef(false);
  const moverAlphaRef = useRef(0.2);
  // track previous cue-ball active flag so we can detect when it gets pocketed
  const prevCueActiveRef = useRef<boolean>(true);
  // when true we are dragging the cue from the left-side UI area
  const draggingUIRef = useRef(false);
  // last pointer canvas coordinates (for optional debug drawing)
  const lastPointerRef = useRef<{ mx: number; my: number } | null>(null);
  const mouseDownRef = useRef(false);

  // left UI bar dimensions (recomputed each frame if formulas change)
  const UI_BAR_X = 16;
  // width used for hit testing when assets haven't loaded yet; we choose a
  // generous value to cover the rotated artwork once it scales up.
  const UI_BAR_W = 80;
  // reduce height of power bar relative to full table
  const BAR_SCALE = 0.7;
  // barTop and barH are recomputed during render

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
  const shotFiredRef = useRef(false);

  // Stable refs for props that event handlers / draw loop need
  const ballsRef = useRef(balls);
  ballsRef.current = balls;
  ballsRefStatic.current = balls; // keep sync for random helper
  const onTakeShotRef = useRef(onTakeShot);
  onTakeShotRef.current = onTakeShot;
  const onPlaceCueBallRef = useRef(onPlaceCueBall);
  onPlaceCueBallRef.current = onPlaceCueBall;
  const myTurnRef = useRef(myTurn);
  myTurnRef.current = myTurn;
  const animatingRef = useRef(animating);
  animatingRef.current = animating;
  const ballInHandRef = useRef(ballInHand);
  ballInHandRef.current = ballInHand;

  // Cached static table background
  const tableBgRef = useRef<HTMLCanvasElement | null>(null);

  if (!tableRef.current) {
    tableRef.current = createStandard8BallTable();
  }

  // Cache static table layers separately:
  // - tableBg: dark bg + pockets + cloth (behind pocketing balls)
  // - tableTop is drawn after pocketing balls so the frame occludes them
  useEffect(() => {
    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_WIDTH;
    offscreen.height = CANVAS_HEIGHT;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0e1628';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
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
    tableBgRef.current = offscreen;
  }, [assets]);

  // Reset cue to aiming when it becomes our turn and we're not animating
  useEffect(() => {
    if (myTurn && !animating && !ballInHand) {
      cueStateRef.current.phase = 'aiming';
      shotFiredRef.current = false;
    }
  }, [myTurn, animating, ballInHand]);

  // clear any in‑hand interaction state when ballInHand is revoked
  useEffect(() => {
    if (!ballInHand) {
      ballInHandDraggingRef.current = false;
      ballInHandHoverRef.current = false;
      placedInCenterRef.current = false;
      moverAlphaRef.current = 0.2;
      ballInHandPosRef.current = null;
    } else {
      // ensure the cue is in aiming phase, so pointerDown will succeed; this
      // is important because we may receive ballInHand while animation is
      // still running and cue.phase could be 'hidden' or 'followThrough'.
      cueStateRef.current.phase = 'aiming';
      shotFiredRef.current = false;
    }
  }, [ballInHand]);

  // when we become ball-in-hand we immediately show a ghost cue ball
  // centred on the table; the user can then drag it anywhere without waiting
  // for any animation or server position updates.  this avoids the case where
  // the cue ball is still flagged active at the pocket and the ghost never
  // seeds properly.
  //
  // additionally, if the cue ball is pocketed while we already have
  // ball-in-hand (e.g. we took a shot while placing the cue and scratched),
  // the state transition may not flip `ballInHand` so the effect won't run
  // again.  in that scenario the ghost can remain stuck at the last drag
  // position (often the pocket).  we detect the cue ball disappearing via
  // another effect below and reset the ghost to centre.
  useEffect(() => {
    if (ballInHand) {
      placedInCenterRef.current = true;
      ballInHandPosRef.current = { cx: TABLE_CX, cy: TABLE_CY };
      onBallInHandPosChanged?.(ballInHandPosRef.current);
    } else {
      ballInHandPosRef.current = null;
      placedInCenterRef.current = false;
      onBallInHandPosChanged?.(null);
    }
  }, [ballInHand]);

  // when the server indicates a scratch, the ghost should re‑centre even if
  // we already had ball-in-hand before taking the shot.  scratchCount is
  // incremented by the page whenever a scratch message arrives.
  useEffect(() => {
    if (ballInHand) {
      placedInCenterRef.current = true;
      ballInHandPosRef.current = { cx: TABLE_CX, cy: TABLE_CY };
      onBallInHandPosChanged?.(ballInHandPosRef.current);
    }
  }, [scratchCount, ballInHand]);

  // When external animation starts, hide cue
  useEffect(() => {
    if (animating) {
      if (cueStateRef.current.phase === 'aiming') {
        cueStateRef.current.phase = 'hidden';
      }
    }
  }, [animating]);

  // watch for the cue ball going inactive while we already have ball-in-hand
  // (scratch during a ball-in-hand shot).  in that case we need to reset the
  // ghost position because the primary "ballInHand" effect above won't run.
  useEffect(() => {
    const cueBall = ballsRef.current.find(b => b.id === 0);
    const cueActive = cueBall ? cueBall.active : false;
    if (ballInHand && prevCueActiveRef.current && !cueActive) {
      // reset to centre, just like the ballInHand effect
      placedInCenterRef.current = true;
      ballInHandPosRef.current = { cx: TABLE_CX, cy: TABLE_CY };
      onBallInHandPosChanged?.(ballInHandPosRef.current);
    }
    prevCueActiveRef.current = cueActive;
  }, [balls, ballInHand]);


  // --- RAF render loop (reads refs, no dependency on canvas-only state) ---
  useEffect(() => {
    let animId: number;

    const drawFrame = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const currentBalls = ballsRef.current;
      const aimAngle = aimAngleRef.current;
      const power = powerRef.current;
      const dragDist = dragDistRef.current;
      const settingPower = settingPowerRef.current;
      // lazily seed ballInHandPos if it isn't already set and we still have
      // ballInHand state – this covers the brief window before the effect
      // runs or when animating prevented it.
      if (ballInHand && !ballInHandPosRef.current) {
        const cueBall = currentBalls.find((b) => b.id === 0 && b.active);
        if (cueBall) {
          if (!placedInCenterRef.current) {
            placedInCenterRef.current = true;
            ballInHandPosRef.current = { cx: TABLE_CX, cy: TABLE_CY };
          } else {
            const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);
            ballInHandPosRef.current = { cx, cy };
          }
        } else {
          ballInHandPosRef.current = randomBallInHandCanvasPos();
        }
      }
      const ballInHandPos = ballInHandPosRef.current;

      // Draw cached table background
      if (tableBgRef.current) {
        ctx.drawImage(tableBgRef.current, 0, 0);
      } else {
        ctx.fillStyle = '#0e1628';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }

      // === POCKETING ANIMATIONS (drawn on cloth, before tableTop frame) ===
      const now = performance.now();
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

      // TableTop frame drawn AFTER pocketing balls — the frame edge occludes
      // balls entering pockets, creating a natural "sinking into hole" effect.
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
      const sortedBalls = [...currentBalls].sort((a, b) => {
        if (a.id === 0) return 1;
        if (b.id === 0) return -1;
        return 0;
      });

      // Draw shadows first
      const shadowSize = BALL_R_PX * 4;
      for (const ball of sortedBalls) {
        if (!ball.active) continue;
        if (ball.id === 0 && ballInHand) continue; // hide cue while we are lifting
        const [bx, by] = physToCanvas(ball.x, ball.y);
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.drawImage(assets.images.shadow, bx - shadowSize / 2, by - shadowSize / 2, shadowSize, shadowSize);
        ctx.restore();
      }

      // Draw balls
      for (const ball of sortedBalls) {
        if (!ball.active) continue;
        // do not draw the cue ball from state while ball-in-hand; we'll draw
        // it manually at the gesture position below instead.
        if (ball.id === 0 && ballInHand) continue;
        const [bx, by] = physToCanvas(ball.x, ball.y);
        drawBall(ctx, assets, ball.id, bx, by, BALL_R_PX);
      }

      // when ball is in hand and we have a computed position, draw the cue
      // ball itself beneath the mover sprite so the square appears to surround
      // it, just like the original game.
      if (ballInHand && ballInHandPos) {
        drawBall(ctx, assets, 0, ballInHandPos.cx, ballInHandPos.cy, BALL_R_PX);
      }

      // show mover sprite when ball-in-hand (ours)
      const moverPos = ballInHandPos;
      if (moverPos) {
        const size = BALL_R_PX * 2.5; // approximate scale of original mover
        ctx.save();
        ctx.globalAlpha = moverAlphaRef.current;
        ctx.drawImage(
          assets.images.mover,
          moverPos.cx - size / 2,
          moverPos.cy - size / 2,
          size,
          size,
        );
        ctx.restore();
      }

      // === BALL GROUP MARKERS ===
      if (myTurn && !animating && !ballInHand && myGroup !== 'ANY') {
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
            const cycleTime = now % MARKER_ANIM_INTERVAL;
            const animDuration = (MARKER_TOTAL_FRAMES / MARKER_FPS) * 1000;
            const startDelay = 500;

            let markerAlpha = 0;
            let frameIdx = 1;

            if (cycleTime > startDelay && cycleTime < startDelay + animDuration) {
              const elapsed = cycleTime - startDelay;
              frameIdx = Math.min(MARKER_TOTAL_FRAMES, Math.floor((elapsed / 1000) * MARKER_FPS) + 1);
              markerAlpha = 1;
            } else if (cycleTime >= startDelay + animDuration) {
              const fadeStart = startDelay + animDuration;
              const fadeTime = cycleTime - fadeStart;
              markerAlpha = Math.max(0, 1 - fadeTime / 500);
              frameIdx = MARKER_TOTAL_FRAMES;
            }

            if (markerAlpha > 0 && MARKER_FRAMES[frameIdx]) {
              const frame = MARKER_FRAMES[frameIdx];
              const markerSize = BALL_R_PX * 4;
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

      // === CUE STICK + AIMING GUIDE ===
      const cueBall = currentBalls.find((b) => b.id === 0 && b.active);
      const cue = cueStateRef.current;
      // when we're in ball-in-hand, always consider the ghost position as the
      // cue origin; ignore the real cueBall coordinate which may linger at the
      // pocket.  otherwise use the live cue ball if present.
      const effectiveCueOrigin = ballInHand && ballInHandPos ? 'ghost' : 'real';
      const showCue = ((effectiveCueOrigin === 'ghost' && ballInHandPos) || (effectiveCueOrigin === 'real' && cueBall)) &&
        !ballInHandHoverRef.current && cue.phase !== 'hidden' && (
          (myTurn && !animating && cue.phase === 'aiming') ||
          cue.phase === 'striking' ||
          cue.phase === 'followThrough'
        );

      if (showCue) {
        // determine where the cue should originate: if we're in ball-in-hand
        // we use the ghost position exclusively.  otherwise, prefer the real
        // cue ball coordinate if available.
        let cx: number, cy: number;
        if (effectiveCueOrigin === 'ghost' && ballInHandPos) {
          cx = ballInHandPos.cx;
          cy = ballInHandPos.cy;
        } else if (cueBall) {
          const [liveCx, liveCy] = physToCanvas(cueBall.x, cueBall.y);
          cx = liveCx;
          cy = liveCy;
        } else if (ballInHandPos) {
          cx = ballInHandPos.cx;
          cy = ballInHandPos.cy;
        } else {
          cx = TABLE_CX;
          cy = TABLE_CY;
        }
        if (cue.phase === 'striking' || cue.phase === 'followThrough') {
          cx = cue.strikeCanvasX;
          cy = cue.strikeCanvasY;
        }
        const cueDrawLen = BALL_R_PX * 18;
        const cueDrawThick = BALL_R_PX * 0.8;
        const baseGap = BALL_R_PX * 1.5;

        let cueOffset = baseGap;
        let cueAlpha = 1;
        let showGuide = showGuideLine && cue.phase === 'aiming';
        const drawAngle = cue.phase === 'aiming' ? aimAngle : cue.shotAngle;

        if (cue.phase === 'aiming') {
          if (settingPower) {
            cueOffset = baseGap + dragDist * 0.5; // matches original: cue.x = -0.5*r - gap
          }
        } else if (cue.phase === 'striking') {
          const elapsed = now - cue.strikeStartTime;
          const t = Math.min(1, elapsed / cue.strikeDuration);
          const easeT = 1 - (1 - t) * (1 - t);
          const startOffset = baseGap + cue.pullbackPx;
          const endOffset = -BALL_R_PX * 0.3;
          cueOffset = startOffset + (endOffset - startOffset) * easeT;

          if (cueOffset <= baseGap && !shotFiredRef.current) {
            shotFiredRef.current = true;
            onTakeShotRef.current({ angle: cue.shotAngle, power: cue.shotPower, screw: 0, english: 0 });
          }

          if (t >= 1) {
            cue.phase = 'followThrough';
            cue.followStartTime = now;
            cue.fadeDuration = 800;
          }
        } else if (cue.phase === 'followThrough') {
          const elapsed = now - cue.followStartTime;
          const fadeDelay = 200;
          cueOffset = -BALL_R_PX * 0.3;
          if (elapsed > fadeDelay) {
            const fadeT = Math.min(1, (elapsed - fadeDelay) / cue.fadeDuration);
            cueAlpha = 1 - fadeT;
          }
          if (elapsed > fadeDelay + cue.fadeDuration) {
            cue.phase = 'hidden';
            cueAlpha = 0;
          }
        }

        // Draw guide line with physics raycasting
        if (showGuide && cueBall) {
          const dirX = Math.cos(drawAngle);
          const dirY = Math.sin(drawAngle);
          let originX: number;
          let originY: number;
          if (effectiveCueOrigin === 'ghost' && ballInHandPos) {
            [originX, originY] = canvasToPhys(ballInHandPos.cx, ballInHandPos.cy);
          } else if (cueBall) {
            originX = cueBall.x;
            originY = cueBall.y;
          } else if (ballInHandPos) {
            [originX, originY] = canvasToPhys(ballInHandPos.cx, ballInHandPos.cy);
          } else {
            originX = 0;
            originY = 0;
          }
          const rayEndX = originX + dirX * 500000;
          const rayEndY = originY + dirY * 500000;
          const collisionRadius = BALL_RADIUS * 2;

          let closestBall: BallState | null = null;
          let closestEnterX = 0, closestEnterY = 0;
          let closestDistSq = Infinity;

          for (const b of currentBalls) {
            if (b.id === 0 || !b.active) continue;
            const hit = lineIntersectCircle(
              originX, originY, rayEndX, rayEndY,
              b.x, b.y, collisionRadius,
            );
            if (hit.intersects) {
              const dSq = (b.x - originX) ** 2 + (b.y - originY) ** 2;
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
            const [fromX, fromY] = physToCanvas(originX, originY);
            const [toX, toY] = physToCanvas(closestEnterX, closestEnterY);
            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(toX, toY, BALL_R_PX, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.stroke();

            const deflectDirX = closestBall.x - closestEnterX;
            const deflectDirY = closestBall.y - closestEnterY;
            const deflectLen = Math.sqrt(deflectDirX ** 2 + deflectDirY ** 2);
            if (deflectLen > 0.01) {
              const ndx = deflectDirX / deflectLen;
              const ndy = deflectDirY / deflectLen;
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
            const halfW = 138000 / 2 - BALL_RADIUS;
            const halfH = 69000 / 2 - BALL_RADIUS;
            const walls = [
              { x1: -halfW, y1: -halfH, x2: halfW, y2: -halfH },
              { x1: halfW, y1: -halfH, x2: halfW, y2: halfH },
              { x1: halfW, y1: halfH, x2: -halfW, y2: halfH },
              { x1: -halfW, y1: halfH, x2: -halfW, y2: -halfH },
            ];
            let wallHitX = rayEndX, wallHitY = rayEndY;
            let minT = Infinity;
            for (const w of walls) {
              const denom = (w.y2 - w.y1) * dirX - (w.x2 - w.x1) * dirY;
              if (Math.abs(denom) < 0.001) continue;
              const t = ((w.x2 - w.x1) * (originY - w.y1) - (w.y2 - w.y1) * (originX - w.x1)) / denom;
              if (t > 0 && t < minT) {
                const u = dirX !== 0
                  ? (originX + t * dirX - w.x1) / (w.x2 - w.x1)
                  : (originY + t * dirY - w.y1) / (w.y2 - w.y1);
                if (u >= 0 && u <= 1) {
                  minT = t;
                  wallHitX = originX + t * dirX;
                  wallHitY = originY + t * dirY;
                }
              }
            }
            const [fromX, fromY] = physToCanvas(originX, originY);
            const [toX, toY] = physToCanvas(wallHitX, wallHitY);
            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(toX, toY, BALL_R_PX, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.stroke();
          }
          ctx.restore();
        }

        // Draw cue stick
        if (cueAlpha > 0) {
          ctx.save();
          ctx.globalAlpha = cueAlpha;
          ctx.translate(cx, cy);
          ctx.rotate(drawAngle);

          const cueX = -(cueOffset + cueDrawLen);
          const cueY = -cueDrawThick / 2;

          ctx.save();
          ctx.translate(3, 4);
          ctx.globalAlpha = cueAlpha * 0.35;
          ctx.drawImage(assets.images.cueShadow, cueX, cueY, cueDrawLen, cueDrawThick);
          ctx.restore();

          ctx.globalAlpha = cueAlpha;
          ctx.drawImage(assets.images.cue, cueX, cueY, cueDrawLen, cueDrawThick);
          ctx.restore();
        }

        // Left‑side power UI (no right indicator any more)
        if (cue.phase === 'aiming') {
          const barH = TABLE_H * BAR_SCALE;
          const barTop = TABLE_CY - barH / 2;
          const leftX = 16;

          // determine how wide the artwork should be once it is scaled to span
          // the full height of the table.  the original assets are drawn rotated
          // -90° in Phaser, so we scale by barH / assetWidth and then the
          // resulting width is assetHeight * scale.
          let barW = UI_BAR_W; // fallback if assets not available yet
          if (assets.images.powerBarBG) {
            const bgScale = barH / assets.images.powerBarBG.width;
            barW = assets.images.powerBarBG.height * bgScale;
          }

          const powerPct = power / MAX_POWER;

          // draw the rotated background graphic
          if (assets.images.powerBarBG) {
            ctx.save();
            ctx.translate(leftX + barW / 2, TABLE_CY);
            ctx.rotate(-Math.PI / 2);
            ctx.drawImage(
              assets.images.powerBarBG,
              -barH / 2,
              -barW / 2,
              barH,
              barW,
            );
            ctx.restore();
          } else {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(leftX, barTop, barW, barH);
          }

          // fill indicator – we keep a simple colour fill clipped to the base
          // region, which sits roughly in the middle of the artwork.
          if (settingPower && power > 0) {
            const fillY = barTop + barH * (1 - powerPct);
            const fillH = barH * powerPct;
            ctx.save();
            // clip to the base area if we have an image, otherwise just draw
            if (assets.images.powerBarBase) {
              ctx.translate(leftX + barW / 2, TABLE_CY);
              ctx.rotate(-Math.PI / 2);
              // draw the coloured bar beneath the base graphic
              ctx.translate(0, -13); // match original offset of base sprite
              ctx.beginPath();
              ctx.rect(-barH / 2, -barW / 2, barH, barW);
              ctx.clip();
              const g = Math.round(255 * (1 - powerPct));
              ctx.fillStyle = `rgb(255, ${g}, 0)`;
              ctx.fillRect(-barH / 2, -barW / 2 + barH * (1 - powerPct), barH, fillH);
              ctx.rotate(Math.PI / 2);
              ctx.translate(-(leftX + barW / 2), -TABLE_CY);
            } else {
              const g = Math.round(255 * (1 - powerPct));
              ctx.fillStyle = `rgb(255, ${g}, 0)`;
              ctx.fillRect(leftX, fillY, barW, fillH);
            }
            ctx.restore();
          }

          // draw optional top cap graphic (purely decorative)
          if (assets.images.powerBarTop) {
            ctx.save();
            ctx.translate(leftX + barW / 2, TABLE_CY);
            ctx.rotate(-Math.PI / 2);
            ctx.drawImage(
              assets.images.powerBarTop,
              -barH / 2,
              -barW / 2,
              barH,
              barW,
            );
            ctx.restore();
          } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(leftX, barTop, barW, barH);
          }

          // mini cue icon slides along the bar to show pull amount.  rotate the
          // cue graphic itself so it is vertical and scale it to a more
          // reasonable length.
          const miniLen = 90;
          const cueCx = leftX + barW / 2 + barW * 0.1;
          const cueCy = TABLE_CY;
          const yPos = barTop + barH * (1 - powerPct);
          const yOffset = yPos - cueCy;

          if (assets.images.cue) {
            const scale = miniLen / assets.images.cue.width;
            ctx.save();
            ctx.translate(cueCx, cueCy + yOffset);
            ctx.rotate(-Math.PI / 2);
            ctx.scale(scale, scale);
            // shadow
            ctx.save();
            ctx.globalAlpha = 0.3;
            if (assets.images.cueShadow) {
              ctx.drawImage(
                assets.images.cueShadow,
                -assets.images.cue.width / 2,
                -assets.images.cue.height / 2,
              );
            }
            ctx.restore();
            ctx.globalAlpha = 0.8;
            ctx.drawImage(
              assets.images.cue,
              -assets.images.cue.width / 2,
              -assets.images.cue.height / 2,
            );
            ctx.restore();
          }
        }
      }

    };

    const loop = () => {
      drawFrame();
      animId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animId);
  }, [balls, myTurn, animating, ballInHand, isBreakShot, myGroup, assets, pocketingBalls, showGuideLine]);

  // --- Coordinate conversion (stable, no deps) ---
  const DEBUG_AIM = false; // set true to log pointer/ball coords for troubleshooting

  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { mx: 0, my: 0 };
    const rect = canvas.getBoundingClientRect();
    // use actual drawing buffer size in case CSS scales the element or
    // the devicePixelRatio differs from 1
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      mx: (clientX - rect.left) * scaleX,
      my: (clientY - rect.top) * scaleY,
    };
  }, []);

  // --- Event handlers (update refs, no setState, no re-renders) ---



  const startStrike = useCallback((shotAngle: number, shotPower: number) => {
    const cue = cueStateRef.current;
    let duration = 1 / (shotPower / 1000);
    duration = Math.max(80, Math.min(600, duration * 1000));

    const cueBall = ballsRef.current.find((b) => b.id === 0 && b.active);
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
    cue.pullbackPx = dragDistRef.current * 0.5; // matches original: 0.5 * dragDistance
    shotFiredRef.current = false;
  }, []);

  // Pointer-based unified handlers (replace separate mouse/touch flows).
  // We use pointer capture to continue receiving pointermove/up events
  // even when the pointer leaves the canvas. Pointer type distinguishes
  // mouse (desktop) from touch (mobile/tablet).
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    // allow ball-in-hand interactions even if animation is running; otherwise
    // require it to be our turn
    if ((!myTurnRef.current && !ballInHandRef.current) || (animatingRef.current && !ballInHandRef.current)) return;
    mouseDownRef.current = true;
    const cue = cueStateRef.current;
    // when ball-in-hand, we should be able to start dragging regardless of
    // the cue animation phase; cue phase may still be 'hidden' from the last
    // shot when the turn switched.  if we're not handling ball-in-hand then
    // require the cue to be aiming as usual.
    if (!ballInHandRef.current && cue.phase !== 'aiming') return;

    const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    let { mx, my } = clientToCanvas(e.clientX, e.clientY);
    const evtAny = e as any;
    if (evtAny.offsetX !== undefined && evtAny.offsetY !== undefined && canvasRef.current) {
      const canvas = canvasRef.current;
      const scaleX = canvas.width / canvas.clientWidth;
      const scaleY = canvas.height / canvas.clientHeight;
      mx = evtAny.offsetX * scaleX;
      my = evtAny.offsetY * scaleY;
    }
    lastPointerRef.current = { mx, my };

    // update aim based on current cue position (ghost or real) when we're not
    // interacting with the ball-in-hand. This ensures the guide line and the
    // shot originate from the correct spot immediately after placement.
    if (!ballInHandRef.current) {
      const pos = ballInHandPosRef.current;
      const cueBall = ballsRef.current.find((b) => b.id === 0 && b.active);
      let ox: number, oy: number;
      if (ballInHandRef.current && pos) {
        // should not happen, but cover for completeness
        ox = pos.cx;
        oy = pos.cy;
      } else if (cueBall) {
        [ox, oy] = physToCanvas(cueBall.x, cueBall.y);
      } else if (pos) {
        ox = pos.cx;
        oy = pos.cy;
      } else {
        ox = TABLE_CX;
        oy = TABLE_CY;
      }
      aimAngleRef.current = Math.atan2(my - oy, mx - ox);
      if (DEBUG_AIM) console.log('pointerDown aim reset', aimAngleRef.current.toFixed(3));
    }

    if (ballInHandRef.current) {
      // make sure we have a position recorded so the mover is clickable
      if (!ballInHandPosRef.current) {
        const cueBall = ballsRef.current.find((b) => b.id === 0 && b.active);
        if (cueBall) {
          if (!placedInCenterRef.current) {
            placedInCenterRef.current = true;
            ballInHandPosRef.current = { cx: TABLE_CX, cy: TABLE_CY };
          } else {
            const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);
            ballInHandPosRef.current = { cx, cy };
          }
        } else {
          ballInHandPosRef.current = randomBallInHandCanvasPos();
        }
      }

      const pos = ballInHandPosRef.current!;
      const dx = mx - pos.cx;
      const dy = my - pos.cy;
      const dist = Math.hypot(dx, dy);

      // if the click landed on the ghost/mover, begin dragging as before
      if (dist <= BALL_R_PX * 2.5) {
        ballInHandDraggingRef.current = true;
        const { cx, cy } = constrainBallInHand(mx, my);
        ballInHandPosRef.current = { cx, cy };
        // capture pointer to continue receiving moves outside the canvas
        try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {};
        return;
      }

      // clicking elsewhere should count as placing the cue ball at its
      // current ghost location; after placement we fall through to the
      // normal aiming code below so the shot can be taken immediately.
      if (pos) {
        const [px, py] = canvasToPhys(pos.cx, pos.cy);
        onPlaceCueBallRef.current(px, py);
        ballInHandRef.current = false; // clear local flag to enable shooting
        // reset aim to match click direction from ghost origin
        const ox = pos.cx;
        const oy = pos.cy;
        aimAngleRef.current = Math.atan2(my - oy, mx - ox);
      }
      // do not return; let aim logic handle the rest
    }

    // compute UI bar geometry
    const barH = TABLE_H * BAR_SCALE;
    const barTop = TABLE_CY - barH / 2;
    let barW = UI_BAR_W;
    if (assets.images.powerBarBG) {
      const bgScale = barH / assets.images.powerBarBG.width;
      barW = assets.images.powerBarBG.height * bgScale;
    }

    // Only treat the left-side bar as a UI-driven power control for touch
    const insideUI = isTouch && mx >= 0 && mx <= UI_BAR_X + barW + 20 && my >= barTop && my <= barTop + barH;
    if (insideUI) {
      draggingUIRef.current = true;
      // do not change aim on initial press; aim will update on move
      /*const cueBall = ballsRef.current.find((b) => b.id === 0 && b.active);
      if (cueBall) {
        const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);
        if (DEBUG_AIM) console.log('pointerDown aim', mx.toFixed(1), my.toFixed(1), 'ball', cx.toFixed(1), cy.toFixed(1));
        aimAngleRef.current = Math.atan2(my - cy, mx - cx);
      }*/
      settingPowerRef.current = true;
      mouseStartRef.current = { x: mx, y: my };
      powerRef.current = 0;
    } else {
      // outside UI: for both mouse and touch, DO NOT reset aim on down;
      // the current aim angle should remain until the user moves the cursor.
      /*const cueBall = ballsRef.current.find((b) => b.id === 0 && b.active);
      if (cueBall) {
        const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);
        if (DEBUG_AIM) console.log('pointerDown aim', mx.toFixed(1), my.toFixed(1), 'ball', cx.toFixed(1), cy.toFixed(1));
        aimAngleRef.current = Math.atan2(my - cy, mx - cx);
      }*/
      // remember where the drag started so we can project against the aim
      mouseStartRef.current = { x: mx, y: my };
      // For mouse pointers, capture so we keep receiving pointermove/up
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch (err) {
        // ignore if capture not supported
      }
    }
  }, [clientToCanvas]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    // allow movement if dragging the cue ball; otherwise respect animation state
    if ((animatingRef.current && !ballInHandRef.current) || !myTurnRef.current) return;
    const cue = cueStateRef.current;
    if (cue.phase !== 'aiming') return;

    const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    let { mx, my } = clientToCanvas(e.clientX, e.clientY);
    const evtAny = e as any;
    if (evtAny.offsetX !== undefined && evtAny.offsetY !== undefined && canvasRef.current) {
      const canvas = canvasRef.current;
      const scaleX = canvas.width / canvas.clientWidth;
      const scaleY = canvas.height / canvas.clientHeight;
      mx = evtAny.offsetX * scaleX;
      my = evtAny.offsetY * scaleY;
    }
    lastPointerRef.current = { mx, my };

    if (ballInHandRef.current && ballInHandDraggingRef.current) {
      const { cx, cy } = constrainBallInHand(mx, my);
      ballInHandPosRef.current = { cx, cy };
      return;
    }

    const tableLeft = TABLE_CX - TABLE_W / 2;
    const tableRight = TABLE_CX + TABLE_W / 2;
    const tableTop = TABLE_CY - TABLE_H / 2;
    const tableBottom = TABLE_CY + TABLE_H / 2;
    const inTable = mx >= tableLeft && mx <= tableRight && my >= tableTop && my <= tableBottom;

    // manage hover state when ball-in-hand but not dragging
    if (ballInHandRef.current && !ballInHandDraggingRef.current) {
      const pos = ballInHandPosRef.current;
      if (pos) {
        const dist = Math.hypot(mx - pos.cx, my - pos.cy);
        const hovering = dist <= BALL_R_PX * 2.5;
        if (hovering && !ballInHandHoverRef.current) {
          ballInHandHoverRef.current = true;
        } else if (!hovering && ballInHandHoverRef.current) {
          ballInHandHoverRef.current = false;
        }
      }
    }

    // adjust mover opacity: full when hovering or dragging
    if (ballInHandHoverRef.current || ballInHandDraggingRef.current) {
      moverAlphaRef.current = 1;
    } else {
      moverAlphaRef.current = 0.2;
    }

    // If hovering, do not update aim or power
    if (ballInHandHoverRef.current) return;

    // For mouse: begin a power drag when the user pulls backwards from
    // the initial down point (regardless of aim); update aim to follow the
    // direction of the drag.
    if (!isTouch && mouseDownRef.current && !draggingUIRef.current && mouseStartRef.current) {
      const ms = mouseStartRef.current;
      const dx = -(mx - ms.x);
      const dy = -(my - ms.y);
      const dist = Math.hypot(dx, dy);
      if (dist > 10) {
        draggingUIRef.current = true;
        settingPowerRef.current = true;
        // we will use the same start point for measuring power magnitude
        mouseStartRef.current = { x: mx, y: my };
        powerRef.current = 0;
      }
    }

    // If dragging UI (touch) then vertical bar maps to power directly
    if (draggingUIRef.current && isTouch) {
      const barH = TABLE_H * BAR_SCALE;
      const barTop2 = TABLE_CY - barH / 2;
      const pct = 1 - (my - barTop2) / barH;
      const clamped = Math.max(0, Math.min(1, pct));
      powerRef.current = clamped * MAX_POWER;
      dragDistRef.current = clamped * 180;
      return;
    }

    // If we're currently pulling for power with mouse, compute power using
    // the magnitude of the drag and update aim direction to match the pull.
    if (settingPowerRef.current && !isTouch && mouseStartRef.current) {
      const ms = mouseStartRef.current;
      const dx = -(mx - ms.x);
      const dy = -(my - ms.y);
      const r = Math.hypot(dx, dy);
      const maxDrag = 180;
      const clamped = Math.min(maxDrag, r);
      dragDistRef.current = clamped;
      powerRef.current = MAX_POWER * (Math.pow(clamped, 1.4) / Math.pow(maxDrag, 1.4));
      // keep aim fixed when pulling; it was set at drag start
      return;
    }

    if (settingPowerRef.current) return;

    // update aim only when the user is not actively dragging the mouse
    // (power drags or any button-down movement should keep aim fixed).
    const pos = ballInHandPosRef.current;
    if (inTable && !mouseDownRef.current) {
      const cueBall = ballsRef.current.find((b) => b.id === 0 && b.active);
      let origin: [number, number] | null = null;
      if (ballInHandRef.current && pos) {
        origin = [pos.cx, pos.cy];
      } else if (cueBall) {
        origin = physToCanvas(cueBall.x, cueBall.y);
      } else if (pos) {
        origin = [pos.cx, pos.cy];
      }
      if (!origin) return;
      const [cx, cy] = origin;
      if (DEBUG_AIM) console.log('pointerMove aim', mx.toFixed(1), my.toFixed(1), 'ball', cx.toFixed(1), cy.toFixed(1));
      aimAngleRef.current = Math.atan2(my - cy, mx - cx);
    }
  }, [clientToCanvas]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    mouseDownRef.current = false;

    if (ballInHandRef.current && ballInHandDraggingRef.current && ballInHandPosRef.current) {
      const { cx, cy } = ballInHandPosRef.current;
      const [px, py] = canvasToPhys(cx, cy);
      // clear local flag immediately so future clicks will fire shots
      ballInHandRef.current = false;
      onPlaceCueBallRef.current(px, py);
      ballInHandPosRef.current = null;
      ballInHandDraggingRef.current = false;
      draggingUIRef.current = false;
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch (err) {}
      return;
    }

    if (settingPowerRef.current && powerRef.current > 40) {
      startStrike(aimAngleRef.current, powerRef.current);
    }

    settingPowerRef.current = false;
    powerRef.current = 0;
    dragDistRef.current = 0;
    mouseStartRef.current = null;
    draggingUIRef.current = false;
    ballInHandHoverRef.current = false;
    moverAlphaRef.current = 0.2;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch (err) {}
  }, [startStrike]);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    // Treat cancel similar to up
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch (err) {}
    mouseDownRef.current = false;
    settingPowerRef.current = false;
    draggingUIRef.current = false;
    ballInHandDraggingRef.current = false;
    ballInHandHoverRef.current = false;
    powerRef.current = 0;
    dragDistRef.current = 0;
    mouseStartRef.current = null;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      style={{ width: '100%', height: '100%', objectFit: 'contain', touchAction: 'none', cursor: myTurn && !animating ? 'crosshair' : 'default' }}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    />
  );
}
