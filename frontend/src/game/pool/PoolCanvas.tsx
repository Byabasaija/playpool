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
  TABLE_CX, TABLE_CY, TABLE_H,
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
}

export default function PoolCanvas({
  balls, myTurn, ballInHand, isBreakShot, myGroup, opponentGroup: _opponentGroup,
  animating, onTakeShot, onPlaceCueBall, assets, showGuideLine = true, pocketingBalls = [],
}: PoolCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tableRef = useRef<Table | null>(null);

  // --- Canvas-only state as refs (no React re-renders) ---
  const aimAngleRef = useRef(0);
  const powerRef = useRef(0);
  const dragDistRef = useRef(0); // raw drag distance (0-180) for cue pullback visual
  const settingPowerRef = useRef(false);
  const mouseStartRef = useRef<{ x: number; y: number } | null>(null);
  const ballInHandPosRef = useRef<{ cx: number; cy: number } | null>(null);

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

  // When external animation starts, hide cue
  useEffect(() => {
    if (animating) {
      if (cueStateRef.current.phase === 'aiming') {
        cueStateRef.current.phase = 'hidden';
      }
    }
  }, [animating]);

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
        if (ball.id === 0 && ballInHand) continue; // Hide cue ball during ball-in-hand
        const [bx, by] = physToCanvas(ball.x, ball.y);
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.drawImage(assets.images.shadow, bx - shadowSize / 2, by - shadowSize / 2, shadowSize, shadowSize);
        ctx.restore();
      }

      // Draw balls
      for (const ball of sortedBalls) {
        if (!ball.active) continue;
        if (ball.id === 0 && ballInHand) continue; // Hide cue ball during ball-in-hand
        const [bx, by] = physToCanvas(ball.x, ball.y);
        drawBall(ctx, assets, ball.id, bx, by, BALL_R_PX);
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
      const showCue = cueBall && !ballInHand && cue.phase !== 'hidden' && (
        (myTurn && !animating && cue.phase === 'aiming') ||
        cue.phase === 'striking' ||
        cue.phase === 'followThrough'
      );

      if (showCue) {
        const [liveCx, liveCy] = physToCanvas(cueBall.x, cueBall.y);
        const cx = (cue.phase === 'striking' || cue.phase === 'followThrough') ? cue.strikeCanvasX : liveCx;
        const cy = (cue.phase === 'striking' || cue.phase === 'followThrough') ? cue.strikeCanvasY : liveCy;
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
          const rayEndX = cueBall.x + dirX * 500000;
          const rayEndY = cueBall.y + dirY * 500000;
          const collisionRadius = BALL_RADIUS * 2;

          let closestBall: BallState | null = null;
          let closestEnterX = 0, closestEnterY = 0;
          let closestDistSq = Infinity;

          for (const b of currentBalls) {
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
            const [fromX, fromY] = physToCanvas(cueBall.x, cueBall.y);
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

        // Power indicator bar
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

      // Ball-in-hand ghost + instruction
      if (myTurn && ballInHand && !animating) {
        if (ballInHandPos) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          drawBall(ctx, assets, 0, ballInHandPos.cx, ballInHandPos.cy, BALL_R_PX);
          ctx.restore();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Click to place cue ball', CANVAS_WIDTH / 2, TABLE_CY - TABLE_H / 2 - 10);
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
  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { mx: 0, my: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      mx: ((clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      my: ((clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  }, []);

  // --- Event handlers (update refs, no setState, no re-renders) ---

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (animatingRef.current || !myTurnRef.current) return;
    const cue = cueStateRef.current;
    if (cue.phase !== 'aiming') return;

    const { mx, my } = clientToCanvas(e.clientX, e.clientY);
    const currentBalls = ballsRef.current;
    const cueBall = currentBalls.find((b) => b.id === 0 && b.active);
    if (!cueBall) return;
    const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);

    if (ballInHandRef.current) {
      ballInHandPosRef.current = { cx: mx, cy: my };
      return;
    }

    // Power drag is handled by window-level listeners (see handleMouseDown)
    if (settingPowerRef.current) return;

    aimAngleRef.current = Math.atan2(my - cy, mx - cx);
  }, [clientToCanvas]);

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

  // Window-level drag handlers (attached on mousedown, removed on mouseup)
  // This ensures shooting works even when mouse leaves the canvas during drag.
  const windowDragHandlersRef = useRef<{ move: (e: MouseEvent) => void; up: (e: MouseEvent) => void } | null>(null);

  const removeWindowDragHandlers = useCallback(() => {
    if (windowDragHandlersRef.current) {
      window.removeEventListener('mousemove', windowDragHandlersRef.current.move);
      window.removeEventListener('mouseup', windowDragHandlersRef.current.up);
      windowDragHandlersRef.current = null;
    }
  }, []);

  // Clean up window listeners on unmount
  useEffect(() => removeWindowDragHandlers, [removeWindowDragHandlers]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!myTurnRef.current || animatingRef.current) return;
    const cue = cueStateRef.current;
    if (cue.phase !== 'aiming') return;

    const { mx, my } = clientToCanvas(e.clientX, e.clientY);

    if (ballInHandRef.current) {
      const [px, py] = canvasToPhys(mx, my);
      onPlaceCueBallRef.current(px, py);
      ballInHandPosRef.current = null;
      return;
    }

    settingPowerRef.current = true;
    mouseStartRef.current = { x: mx, y: my };
    powerRef.current = 0;

    // Attach window-level listeners so dragging outside canvas still works
    const onWindowMove = (ev: MouseEvent) => {
      if (!settingPowerRef.current || !mouseStartRef.current) return;
      const { mx: wmx, my: wmy } = clientToCanvas(ev.clientX, ev.clientY);
      const ms = mouseStartRef.current;
      const dx = -(wmx - ms.x);
      const dy = -(wmy - ms.y);
      const aimDirX = Math.cos(aimAngleRef.current);
      const aimDirY = Math.sin(aimAngleRef.current);
      let r = dx * aimDirX + dy * aimDirY;
      const maxDrag = 180;
      if (r < 0) r = 0;
      if (r > maxDrag) r = maxDrag;
      dragDistRef.current = r;
      powerRef.current = MAX_POWER * (Math.pow(r, 1.4) / Math.pow(maxDrag, 1.4));
    };

    const onWindowUp = () => {
      if (settingPowerRef.current && powerRef.current > 40) {
        startStrike(aimAngleRef.current, powerRef.current);
      }
      settingPowerRef.current = false;
      powerRef.current = 0;
      dragDistRef.current = 0;
      mouseStartRef.current = null;
      removeWindowDragHandlers();
    };

    removeWindowDragHandlers(); // clean up any stale listeners
    windowDragHandlersRef.current = { move: onWindowMove, up: onWindowUp };
    window.addEventListener('mousemove', onWindowMove);
    window.addEventListener('mouseup', onWindowUp);
  }, [clientToCanvas, startStrike, removeWindowDragHandlers]);

  const handleMouseUp = useCallback(() => {
    // Window-level handler takes care of firing the shot.
    // This is kept as a no-op fallback for safety.
  }, []);

  const handleMouseLeave = useCallback(() => {
    // Don't cancel drag on mouse leave — window listeners handle it.
  }, []);

  // --- Touch handlers ---

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!myTurnRef.current || animatingRef.current || !e.touches[0]) return;
    const cue = cueStateRef.current;
    if (cue.phase !== 'aiming') return;

    const { mx, my } = clientToCanvas(e.touches[0].clientX, e.touches[0].clientY);

    if (ballInHandRef.current) {
      const [px, py] = canvasToPhys(mx, my);
      onPlaceCueBallRef.current(px, py);
      ballInHandPosRef.current = null;
      return;
    }

    const cueBall = ballsRef.current.find((b) => b.id === 0 && b.active);
    if (cueBall) {
      const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);
      aimAngleRef.current = Math.atan2(my - cy, mx - cx);
    }

    settingPowerRef.current = true;
    mouseStartRef.current = { x: mx, y: my };
    powerRef.current = 0;
  }, [clientToCanvas]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (animatingRef.current || !myTurnRef.current || !e.touches[0]) return;
    const cue = cueStateRef.current;
    if (cue.phase !== 'aiming') return;

    const { mx, my } = clientToCanvas(e.touches[0].clientX, e.touches[0].clientY);

    if (ballInHandRef.current) {
      ballInHandPosRef.current = { cx: mx, cy: my };
      return;
    }

    const cueBall = ballsRef.current.find((b) => b.id === 0 && b.active);
    if (!cueBall) return;
    const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);

    const mouseStart = mouseStartRef.current;
    if (settingPowerRef.current && mouseStart) {
      const dy = my - mouseStart.y;
      const maxDrag = 500;
      let r = Math.max(0, Math.min(maxDrag, dy));
      powerRef.current = MAX_POWER * (Math.pow(r, 1.4) / Math.pow(maxDrag, 1.4));
      return;
    }

    aimAngleRef.current = Math.atan2(my - cy, mx - cx);
  }, [clientToCanvas]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!myTurnRef.current || animatingRef.current) return;
    if (ballInHandRef.current) return;

    if (settingPowerRef.current && powerRef.current > 40) {
      startStrike(aimAngleRef.current, powerRef.current);
    }

    settingPowerRef.current = false;
    powerRef.current = 0;
    mouseStartRef.current = null;
  }, [startStrike]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      style={{ width: '100%', height: '100%', objectFit: 'contain', touchAction: 'none', cursor: myTurn && !animating ? 'crosshair' : 'default' }}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    />
  );
}
