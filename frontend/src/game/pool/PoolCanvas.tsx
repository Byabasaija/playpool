// Main pool table canvas — sprite-based rendering with 8Ball-Pool-HTML5 assets.
// Includes animated cue stick with pull-back, strike, and follow-through.
// Performance: all canvas-only state uses refs (no React re-renders on mouse move).

import React, { useRef, useEffect, useCallback, useImperativeHandle } from 'react';
import { MAX_POWER, BALL_RADIUS } from './constants';

// exposed sizing helpers for the power bar; used by overlay component
export const POWER_BAR_SCALE = 0.4; // matches BAR_SCALE used inside canvas
export const POWER_BAR_WIDTH_SCALE = 0.5;

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
  // indicates whether the primary input device is touch-based. when
  // false we fall back to mouse/trackpad controls even if a pointer event
  // reports `pointerType === 'touch'` (some laptops do this).
  isTouchDevice?: boolean;
  // ref used by parent to track current aim angle
  aimAngleRef: React.MutableRefObject<number>;
  // streamed position of opponent's cue ball while they are in ball-in-hand
  // mode (physics coordinates); null when opponent is not placing.
  opponentCueBallPos?: { x: number; y: number } | null;
  // fires on every drag move (canvas coords) so the parent can throttle-stream
  // the position to the opponent via WebSocket.
  onBallInHandPosChanged?: (pos: { cx: number; cy: number } | null) => void;
  // increments when a scratch occurred (resets ghost when ballInHand)
  scratchCount?: number;
  // when true the game panel parent is CSS-rotated 90° CW (portrait mobile).
  // clientToCanvas must invert the rotation to produce correct canvas coords.
  isPortrait?: boolean;
}


export type PoolCanvasHandle = {
  fireShot: (angle: number, power: number) => void;
  canvas?: HTMLCanvasElement | null;
  beginPowerDrag: () => void;
  updatePowerFromDrag: (dist: number) => void;
  endPowerDrag: () => void;
};

const PoolCanvas = React.forwardRef<PoolCanvasHandle, PoolCanvasProps>(({
  balls, myTurn, ballInHand, isBreakShot, myGroup, opponentGroup: _opponentGroup,
  animating, onTakeShot, onPlaceCueBall, assets,
  showGuideLine = true, pocketingBalls = [],
  opponentCueBallPos,
  onBallInHandPosChanged,
  scratchCount = 0,
  aimAngleRef,
  isPortrait = false,
}, ref) => {
  // support high-DPI displays by scaling canvas buffer to devicePixelRatio
  const dpr = window.devicePixelRatio || 1;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tableRef = useRef<Table | null>(null);

  // helper used when the player is moving the cue ball (ball-in-hand).
  // This implements the same behaviour as the original 8-ball game code:
  // the ghost ball is clamped inside the cloth, it is prevented from
  // overlapping other balls, and when dragged between two balls it will
  // slide around them instead of jittering.
  const constrainBallInHand = useCallback((cx: number, cy: number, breakShot: boolean) => {
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

    // during break shot restrict to the kitchen (left of head string)
    if (breakShot) {
      const [headStringCX] = physToCanvas(-34500, 0);
      x = Math.min(x, headStringCX - BALL_R_PX);
    }

    return { cx: x, cy: y };
  }, []);

  // --- Canvas-only state as refs (no React re-renders) ---
  const powerRef = useRef(0);
  const dragDistRef = useRef(0); // raw drag distance (0-180) for cue pullback visual
  const settingPowerRef = useRef(false);
  const mouseStartRef = useRef<{ x: number; y: number } | null>(null);
  const ballInHandPosRef = useRef<{ cx: number; cy: number } | null>(null);
  // we only start moving the cue ball if pointer down occurs on the ghost ball
  const ballInHandDraggingRef = useRef(false);
  const ballInHandHoverRef = useRef(false);
  const placedInCenterRef = useRef(false);
  const moverAlphaRef = useRef(0.8);
  // track previous cue-ball active flag so we can detect when it gets pocketed
  const prevCueActiveRef = useRef<boolean>(true);
  // when true we are dragging the cue from the left-side UI area
  const draggingUIRef = useRef(false);
  // last pointer canvas coordinates (for optional debug drawing)
  const lastPointerRef = useRef<{ mx: number; my: number } | null>(null);
  const mouseDownRef = useRef(false);
  const lastPointerTypeRef = useRef<string>('mouse'); // 'mouse' | 'touch' | 'pen'
  const isPortraitRef = useRef(isPortrait);
  isPortraitRef.current = isPortrait;

  // touch rotary aim state (mirrors original 8Ball: startCue, startAng, aimSensitivity)
  const touchStartCueRef = useRef(0);
  const touchStartAngRef = useRef(0);
  const touchSensitivityRef = useRef(0.5);
  const touchAimActiveRef = useRef(false);

  // reduce height of power bar relative to full table
  const BAR_SCALE = POWER_BAR_SCALE; // kept in sync with exported constant
  // barTop and barH are recomputed during render

  // computed constant used by both canvas and overlay logic
  const barHConst = TABLE_H * BAR_SCALE;
  function computePowerFromDrag(dist: number) {
    const clamped = Math.max(0, Math.min(barHConst, dist));
    return MAX_POWER * (Math.pow(clamped, 1.4) / Math.pow(barHConst, 1.4));
  }

  const beginPowerDrag = () => {
    settingPowerRef.current = true;
    powerRef.current = 0;
    dragDistRef.current = 0;
    mouseStartRef.current = null;
  };

  const updatePowerFromDrag = (dist: number) => {
    const clamped = Math.max(0, Math.min(barHConst, dist));
    dragDistRef.current = clamped;
    powerRef.current = computePowerFromDrag(clamped);
  };

  const endPowerDrag = () => {
    if (settingPowerRef.current && powerRef.current > 40) {
      startStrike(aimAngleRef.current, powerRef.current);
    }
    settingPowerRef.current = false;
    powerRef.current = 0;
    dragDistRef.current = 0;
    mouseStartRef.current = null;
    draggingUIRef.current = false;
  };

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
  const isBreakShotRef = useRef(isBreakShot);
  isBreakShotRef.current = isBreakShot;

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
    // offscreen can be logical size; drawFrame will scale context when blitting
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
      // reset mover to default visible alpha so it shows immediately when
      // ball-in-hand starts (the !ballInHand branch above sets it to 0.2)
      moverAlphaRef.current = 0.8;
    }
  }, [ballInHand]);

  // Reset drag state when ball-in-hand starts or ends.
  // No ghost position is seeded here — the mover always renders at the physics ball.
  useEffect(() => {
    if (!ballInHand) {
      ballInHandPosRef.current = null;
      ballInHandDraggingRef.current = false;
      placedInCenterRef.current = false;
      onBallInHandPosChanged?.(null);
    }
  }, [ballInHand, scratchCount]);

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
      // cue ball just pocketed while still in ball-in-hand — clear drag state
      ballInHandPosRef.current = null;
      ballInHandDraggingRef.current = false;
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

      // apply DPR scaling once per frame - all subsequent coordinates are in
      // logical units (CANVAS_WIDTH, CANVAS_HEIGHT)
      ctx.save();
      ctx.scale(dpr, dpr);

      const currentBalls = ballsRef.current;
      const aimAngle = aimAngleRef.current;
      const dragDist = dragDistRef.current;
      const settingPower = settingPowerRef.current;
      // ballInHandPos tracks the mover drag position (null when not dragging)
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
      const isDraggingMover = ballInHand && ballInHandDraggingRef.current;
      const sortedBalls = [...currentBalls].sort((a, b) => {
        if (a.id === 0) return 1;
        if (b.id === 0) return -1;
        return 0;
      });

      // Draw shadows — cue ball uses dragged position while placing (not during animation).
      const shadowSize = BALL_R_PX * 4;
      for (const ball of sortedBalls) {
        if (!ball.active) continue;
        let bx: number, by: number;
        if (ball.id === 0 && ballInHandPos && !animating) {
          bx = ballInHandPos.cx; by = ballInHandPos.cy;
        } else {
          [bx, by] = physToCanvas(ball.x, ball.y);
        }
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.drawImage(assets.images.shadow, bx - shadowSize / 2, by - shadowSize / 2, shadowSize, shadowSize);
        ctx.restore();
      }

      // Draw balls — cue ball follows dragged position while placing, physics during shot.
      for (const ball of sortedBalls) {
        if (!ball.active) continue;
        let bx: number, by: number;
        if (ball.id === 0 && ballInHandPos && !animating) {
          bx = ballInHandPos.cx; by = ballInHandPos.cy;
        } else {
          [bx, by] = physToCanvas(ball.x, ball.y);
        }
        drawBall(ctx, assets, ball.id, bx, by, BALL_R_PX);
      }

      // Mover overlay — shown on top of the real cue ball for the placing player.
      // Position: drag position if actively dragging, otherwise physics ball 0.
      // For the observer: streamed opponent position if available.
      if (ballInHand) {
        let moverPos: { cx: number; cy: number } | null = null;
        if (myTurn) {
          if (ballInHandPos && !animating) {
            moverPos = ballInHandPos;
          } else if (!animating) {
            const cb = currentBalls.find(b => b.id === 0 && b.active);
            if (cb) { const [mx2, my2] = physToCanvas(cb.x, cb.y); moverPos = { cx: mx2, cy: my2 }; }
          }
        } else if (opponentCueBallPos) {
          const [ocx, ocy] = physToCanvas(opponentCueBallPos.x, opponentCueBallPos.y);
          moverPos = { cx: ocx, cy: ocy };
        }
        if (moverPos) {
          const size = BALL_R_PX * 5;
          ctx.save();
          ctx.globalAlpha = myTurn ? moverAlphaRef.current : 0.6;
          ctx.drawImage(assets.images.mover, moverPos.cx - size / 2, moverPos.cy - size / 2, size, size);
          ctx.restore();
        }
      }

      // === BALL GROUP MARKERS ===
      if (myTurn && !animating && myGroup !== 'ANY') {
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
      // Use the dragged/placed position as cue origin whenever one exists —
      // this covers both active dragging and after release (before shot commits).
      const effectiveCueOrigin = ballInHandPos ? 'ghost' : 'real';
      // Cue is visible whenever it's our turn — ball-in-hand no longer hides it.
      // Hide only while actively dragging or hovering the mover.
      const showCue = cueBall &&
        !isDraggingMover && !ballInHandHoverRef.current && cue.phase !== 'hidden' && (
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
        // guide also hidden during placement (original: guideCanvas.visible=false)
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
            // Commit the cue ball position at shot time: use the dragged position
            // if the player placed it, otherwise fall back to the physics ball.
            // ballInHandPosRef is kept (not nulled) so the cue stick animates from
            // the correct origin; it is cleared by useEffect when ballInHand prop
            // becomes false after the shot completes.
            if (ballInHandRef.current) {
              ballInHandRef.current = false;
              if (ballInHandPosRef.current) {
                const [phyX, phyY] = canvasToPhys(ballInHandPosRef.current.cx, ballInHandPosRef.current.cy);
                onPlaceCueBallRef.current(phyX, phyY);
              } else {
                const cb = ballsRef.current.find(b => b.id === 0 && b.active);
                if (cb) { onPlaceCueBallRef.current(cb.x, cb.y); }
              }
            }
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
              // bearing1: cue → contact point; bearing2: contact → target ball centre
              const bearing1 = Math.atan2(closestEnterY - originY, closestEnterX - originX);
              const bearing2 = Math.atan2(ndy, ndx);
              // Signed cut angle — matches original angleDiff(). The sign encodes
              // which side of the cue the target deflects to; using Math.abs here
              // (and then guessing direction) breaks near the ±π wrap boundary.
              const signedCut = Math.atan2(Math.sin(bearing2 - bearing1), Math.cos(bearing2 - bearing1));
              const absCut = Math.abs(signedCut);

              // Target ball line — longer on head-on hits, zero on grazing hits.
              const lineLen = BALL_RADIUS * 5 * ((Math.PI / 2 - absCut) / (Math.PI / 2));
              const targetEndX = closestBall.x + ndx * Math.max(lineLen, BALL_RADIUS);
              const targetEndY = closestBall.y + ndy * Math.max(lineLen, BALL_RADIUS);

              const [tbx, tby] = physToCanvas(closestBall.x, closestBall.y);
              const [tex, tey] = physToCanvas(targetEndX, targetEndY);
              ctx.beginPath();
              ctx.strokeStyle = 'rgba(255,255,255,0.7)';
              ctx.moveTo(tbx, tby);
              ctx.lineTo(tex, tey);
              ctx.stroke();

              // Cue deflection line — mirrors original: signed length + fixed angle.
              // A = bearing2 - 90°; S = signed so negative S flips to the right side.
              const cueLineLen = BALL_RADIUS * 5 * signedCut / (Math.PI / 2);
              const cueDeflectAngle = bearing2 - Math.PI / 2;
              if (Math.abs(cueLineLen) > BALL_RADIUS * 0.5) {
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
            // clip ray against the table rectangle (physical units). we know the
            // cue ball/ghost is always within these bounds, so the first positive
            // intersection is where the guide should terminate.
            const halfW = 138000 / 2 - BALL_RADIUS;
            const halfH = 69000 / 2 - BALL_RADIUS;
            let wallHitX = rayEndX;
            let wallHitY = rayEndY;
            let bestT = Infinity;

            // vertical walls
            if (dirX !== 0) {
              // choose left or right depending on ray direction
              const targetX = dirX > 0 ? halfW : -halfW;
              const t = (targetX - originX) / dirX;
              if (t > 0) {
                const yAtT = originY + t * dirY;
                if (Math.abs(yAtT) <= halfH && t < bestT) {
                  bestT = t;
                  wallHitX = targetX;
                  wallHitY = yAtT;
                }
              }
            }
            // horizontal walls
            if (dirY !== 0) {
              const targetY = dirY > 0 ? halfH : -halfH;
              const t = (targetY - originY) / dirY;
              if (t > 0) {
                const xAtT = originX + t * dirX;
                if (Math.abs(xAtT) <= halfW && t < bestT) {
                  bestT = t;
                  wallHitX = xAtT;
                  wallHitY = targetY;
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

      }

      // finally, undo the DPR scale we applied at the start of the frame
      ctx.restore();
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
    let mx: number, my: number;
    if (isPortraitRef.current) {
      // Parent is CSS-rotated 90° CW so the canvas AABB has swapped axes.
      // Invert the rotation: viewport-x → canvas-y, viewport-y → canvas-x (flipped).
      const vxFrac = (clientX - rect.left) / rect.width;
      const vyFrac = (clientY - rect.top) / rect.height;
      mx = vyFrac * canvas.width;
      my = (1 - vxFrac) * canvas.height;
    } else {
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      mx = (clientX - rect.left) * scaleX;
      my = (clientY - rect.top) * scaleY;
    }
    return { mx, my };
  }, []);

  // --- Event handlers (update refs, no setState, no re-renders) ---



  const startStrike = useCallback((shotAngle: number, shotPower: number) => {
    const cue = cueStateRef.current;
    let duration = 1 / (shotPower / 1000);
    duration = Math.max(80, Math.min(600, duration * 1000));

    // Use dragged position if ball-in-hand, otherwise live physics position.
    if (ballInHandPosRef.current) {
      cue.strikeCanvasX = ballInHandPosRef.current.cx;
      cue.strikeCanvasY = ballInHandPosRef.current.cy;
    } else {
      const cueBall = ballsRef.current.find((b) => b.id === 0 && b.active);
      if (cueBall) {
        const [scx, scy] = physToCanvas(cueBall.x, cueBall.y);
        cue.strikeCanvasX = scx;
        cue.strikeCanvasY = scy;
      }
    }

    cue.phase = 'striking';
    cue.strikeStartTime = performance.now();
    cue.strikeDuration = duration;
    cue.shotPower = shotPower;
    cue.shotAngle = shotAngle;
    cue.pullbackPx = dragDistRef.current * 0.5; // matches original: 0.5 * dragDistance
    shotFiredRef.current = false;
  }, []);

  useImperativeHandle(ref, () => ({
    fireShot: startStrike,
    get canvas() {
      return canvasRef.current;
    },
    beginPowerDrag,
    updatePowerFromDrag,
    endPowerDrag,
  }), [startStrike]);

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

    let { mx, my } = clientToCanvas(e.clientX, e.clientY);
    // offsetX/offsetY are in the element's pre-transform coordinate space and
    // give more precise coords for mouse events. Skip them in portrait mode
    // (parent is rotated 90°) since cross-browser behaviour is unreliable there;
    // clientToCanvas already applies the inverse rotation for that case.
    const evtAny = e as any;
    if (!isPortraitRef.current && evtAny.offsetX !== undefined && evtAny.offsetY !== undefined && canvasRef.current) {
      const canvas = canvasRef.current;
      const scaleX = canvas.width / canvas.clientWidth;
      const scaleY = canvas.height / canvas.clientHeight;
      mx = evtAny.offsetX * scaleX;
      my = evtAny.offsetY * scaleY;
    }
    // convert physical canvas buffer pixels → logical canvas coords (0..CANVAS_WIDTH)
    // physToCanvas and all table geometry are in logical units; dpr scaling is
    // only for the drawing buffer.
    mx /= dpr; my /= dpr;
    lastPointerRef.current = { mx, my };

    // If ball-in-hand, check if pointer is on the mover. Mover center = physics
    // ball 0 position (or current drag position if already dragging).
    if (ballInHandRef.current) {
      // Find the current mover position (last dragged or physics ball).
      const cueBall0 = ballsRef.current.find(b => b.id === 0 && b.active);
      let moverCX: number, moverCY: number;
      if (ballInHandPosRef.current) {
        moverCX = ballInHandPosRef.current.cx;
        moverCY = ballInHandPosRef.current.cy;
      } else if (cueBall0) {
        [moverCX, moverCY] = physToCanvas(cueBall0.x, cueBall0.y);
      } else {
        moverCX = TABLE_CX; moverCY = TABLE_CY;
      }
      // Touch: generous hit radius so it's easy to grab on mobile.
      // Mouse: standard radius. Both fall through to aim/shot if outside radius.
      const hitRadius = e.pointerType !== 'mouse' ? BALL_R_PX * 8 : BALL_R_PX * 5;
      if (Math.hypot(mx - moverCX, my - moverCY) <= hitRadius) {
        ballInHandDraggingRef.current = true;
        ballInHandPosRef.current = { cx: moverCX, cy: moverCY };
        try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
        return;
      }
      // Pointer not on mover — fall through to aim/shot handling.
    }

    // Aim setup: use dragged position if available, otherwise physics ball 0.
    {
      const cueBall = ballsRef.current.find((b) => b.id === 0 && b.active);
      let ox: number, oy: number;
      if (ballInHandPosRef.current) {
        ox = ballInHandPosRef.current.cx;
        oy = ballInHandPosRef.current.cy;
      } else if (cueBall) {
        [ox, oy] = physToCanvas(cueBall.x, cueBall.y);
      } else {
        ox = TABLE_CX; oy = TABLE_CY;
      }
      lastPointerTypeRef.current = e.pointerType;
      if (e.pointerType === 'mouse') {
        aimAngleRef.current = Math.atan2(my - oy, mx - ox);
        if (DEBUG_AIM) console.log('pointerDown aim reset', aimAngleRef.current.toFixed(3));
      } else {
        touchStartCueRef.current = aimAngleRef.current;
        touchStartAngRef.current = Math.atan2(my - oy, mx - ox);
        touchSensitivityRef.current = 1.0;
        touchAimActiveRef.current = true;
      }
    }

    // compute UI bar geometry
    // remember where the drag started so we can project against the aim
    draggingUIRef.current = false; // no UI in the canvas now
    mouseStartRef.current = { x: mx, y: my };
    // For mouse pointers, capture so we keep receiving pointermove/up
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch (err) {
      // ignore if capture not supported
    }
  }, [clientToCanvas]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    // allow movement if dragging the cue ball; otherwise respect animation state
    if ((animatingRef.current && !ballInHandRef.current) || !myTurnRef.current) return;

    let { mx, my } = clientToCanvas(e.clientX, e.clientY);
    const evtAny = e as any;
    if (!isPortraitRef.current && evtAny.offsetX !== undefined && evtAny.offsetY !== undefined && canvasRef.current) {
      const canvas = canvasRef.current;
      const scaleX = canvas.width / canvas.clientWidth;
      const scaleY = canvas.height / canvas.clientHeight;
      mx = evtAny.offsetX * scaleX;
      my = evtAny.offsetY * scaleY;
    }
    mx /= dpr; my /= dpr;
    lastPointerRef.current = { mx, my };

    // ball-in-hand interactions bypass the cue-phase guard — dragging must
    // work immediately after a shot (when the cue phase may still be 'hidden')
    if (ballInHandRef.current && ballInHandDraggingRef.current) {
      const { cx, cy } = constrainBallInHand(mx, my, isBreakShotRef.current);
      ballInHandPosRef.current = { cx, cy };
      onBallInHandPosChanged?.({ cx, cy });
      return;
    }

    // hover detection for mover — use dragged position if available.
    // Does NOT return early; aim and power drag still run below.
    if (ballInHandRef.current && !ballInHandDraggingRef.current) {
      let bx: number, by: number;
      if (ballInHandPosRef.current) {
        bx = ballInHandPosRef.current.cx;
        by = ballInHandPosRef.current.cy;
      } else {
        const cb0 = ballsRef.current.find(b => b.id === 0 && b.active);
        if (cb0) { [bx, by] = physToCanvas(cb0.x, cb0.y); } else { bx = TABLE_CX; by = TABLE_CY; }
      }
      ballInHandHoverRef.current = Math.hypot(mx - bx, my - by) <= BALL_R_PX * 5;
      moverAlphaRef.current = ballInHandHoverRef.current ? 1 : 0.8;
    }

    const cue = cueStateRef.current;
    if (cue.phase !== 'aiming') return;

    // begin a power drag when the user pulls *backward* along the aim
    // direction **and** the initial down was near the cue origin. this
    // prevents random table drags from firing shots. desktop use only;
    // mobile ignores backward drags altogether and relies on the UI bar.
    if (mouseDownRef.current && !draggingUIRef.current && mouseStartRef.current && !settingPowerRef.current && e.pointerType === 'mouse') {
      const ms = mouseStartRef.current;
      const dx = mx - ms.x;
      const dy = my - ms.y;
      // vector pointing from current pointer back toward start
      const backX = -dx;
      const backY = -dy;
      const dist = Math.hypot(backX, backY);
      // require the drag to be roughly opposite to the current aim
      const aimDirX = Math.cos(aimAngleRef.current);
      const aimDirY = Math.sin(aimAngleRef.current);
      const dot = backX * aimDirX + backY * aimDirY;
      if (dist > 10 && dot > 0) {
        draggingUIRef.current = true;
        settingPowerRef.current = true;
        // reset start point to measure power from the moment we decided
        mouseStartRef.current = { x: mx, y: my };
        powerRef.current = 0;
      }
    }


    // If we're currently pulling for power, compute strength based on the
    // drag distance and keep the aim fixed.
    if (settingPowerRef.current && mouseStartRef.current) {
      const ms = mouseStartRef.current;
      const dx = mx - ms.x;
      const dy = my - ms.y;
      // Project displacement onto the backward aim direction for signed pull distance.
      // Moving forward past the start reduces power back to 0.
      const backX = -Math.cos(aimAngleRef.current);
      const backY = -Math.sin(aimAngleRef.current);
      const pull = Math.max(0, dx * backX + dy * backY);
      const clamped = Math.min(barHConst, pull);
      updatePowerFromDrag(clamped);
      // keep aim fixed when pulling; it was set at drag start
      return;
    }

    if (settingPowerRef.current) return;

    // update aim continuously except when we are currently
    // manipulating a power control (mouse pullback or touch bar).
    // note: previously this only happened when the pointer was inside a
    // computed "table" rectangle; that made the aim freeze when the
    // canvas was letterboxed. now we update unconditionally, which is
    // fine because the wrapper enforces the canvas never extends beyond
    // the visible table.
    const pos = ballInHandPosRef.current;
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
    if (e.pointerType === 'mouse' && !mouseDownRef.current) {
      aimAngleRef.current = Math.atan2(my - cy, mx - cx);
    } else if (touchAimActiveRef.current) {
      const currentAng = Math.atan2(my - cy, mx - cx);
      let delta = currentAng - touchStartAngRef.current;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      aimAngleRef.current = touchStartCueRef.current + delta * touchSensitivityRef.current;
      if (Math.abs(delta) > 10 * Math.PI / 180) {
        touchStartCueRef.current = aimAngleRef.current;
        touchStartAngRef.current = currentAng;
        touchSensitivityRef.current = Math.min(1, touchSensitivityRef.current + 0.1);
      }
    }
  }, [clientToCanvas]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    mouseDownRef.current = false;
    touchAimActiveRef.current = false;

    if (ballInHandRef.current && ballInHandDraggingRef.current) {
      // Drop the ball without committing — player can pick it up again and
      // re-position before taking their shot. Position is committed at shot time.
      ballInHandDraggingRef.current = false;
      draggingUIRef.current = false;
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch (err) {}
      return;
    }

    endPowerDrag();
    ballInHandHoverRef.current = false;
    moverAlphaRef.current = 0.2;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch (err) {}
  }, [startStrike]);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    // Treat cancel similar to up
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch (err) {}
    mouseDownRef.current = false;
    touchAimActiveRef.current = false;
    endPowerDrag();
    ballInHandDraggingRef.current = false;
    ballInHandHoverRef.current = false;
  }, []);

  // wrap the canvas in a flex container that maintains the table's aspect
  // ratio. this ensures the actual <canvas> element only covers the table and
  // doesn't expand into the surrounding flex cell, which previously produced a
  // large invisible hit area where pointer events would be ignored by the
  // `inTable` check. we also remove `objectFit` (not applicable to canvas) and
  // let the canvas size itself via aspect-ratio / width=100% height=auto.
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH * dpr}
        height={CANVAS_HEIGHT * dpr}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          width: 'auto',
          height: 'auto',
          aspectRatio: `${CANVAS_WIDTH}/${CANVAS_HEIGHT}`,
          touchAction: 'none',
          cursor: 'default',
        }}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      />
    </div>
  );
});

export default PoolCanvas;
