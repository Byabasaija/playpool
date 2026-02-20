// Main pool table canvas — sprite-based rendering with 8Ball-Pool-HTML5 assets.
// Includes animated cue stick with pull-back, strike, and follow-through.

import { useRef, useEffect, useCallback, useState } from 'react';
import { MAX_POWER } from './constants';
import { createStandard8BallTable, type Table } from './TableGeometry';
import { PoolAssets } from './AssetLoader';
import { drawBall, drawPocketingBall } from './BallRenderer';
import {
  CANVAS_WIDTH, CANVAS_HEIGHT, RAIL_MARGIN, TABLE_LEFT, TABLE_TOP,
  TABLE_W, TABLE_H, BALL_R_PX, physToCanvas, canvasToPhys,
} from './canvasLayout';
import { type BallState, type BallGroup, type ShotParams, type PocketingAnim } from './types';

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
  balls, myTurn, ballInHand, isBreakShot, myGroup: _myGroup, opponentGroup: _opponentGroup,
  animating, onTakeShot, onPlaceCueBall, assets, showGuideLine = true, pocketingBalls = [],
}: PoolCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [aimAngle, setAimAngle] = useState(0);
  const [power, setPower] = useState(0);
  const [settingPower, setSettingPower] = useState(false);
  const [mouseStart, setMouseStart] = useState<{ x: number; y: number } | null>(null);
  const [draggingCueBall, setDraggingCueBall] = useState(false);
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

    // === TABLE LAYERS ===
    ctx.drawImage(
      assets.images.pockets,
      TABLE_LEFT - RAIL_MARGIN, TABLE_TOP - RAIL_MARGIN,
      TABLE_W + RAIL_MARGIN * 2, TABLE_H + RAIL_MARGIN * 2,
    );
    ctx.drawImage(
      assets.images.cloth,
      TABLE_LEFT, TABLE_TOP, TABLE_W, TABLE_H,
    );
    ctx.drawImage(
      assets.images.tableTop,
      TABLE_LEFT - RAIL_MARGIN, TABLE_TOP - RAIL_MARGIN,
      TABLE_W + RAIL_MARGIN * 2, TABLE_H + RAIL_MARGIN * 2,
    );

    // Head string line (for break shot ball placement)
    if (isBreakShot && ballInHand) {
      const [lx] = physToCanvas(-15000 * 2.3, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(lx, TABLE_TOP);
      ctx.lineTo(lx, TABLE_TOP + TABLE_H);
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

    // === POCKETING ANIMATIONS ===
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
      const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);
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
          cueOffset = baseGap + power * 0.025;
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

      // Draw guide line (only during aiming)
      if (showGuide && cueBall) {
        const guideLen = 300;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(drawAngle);

        const dImg = assets.images.dottedLine;
        const segLen = dImg.naturalWidth * 0.5;
        for (let d = BALL_R_PX * 1.5; d < guideLen; d += segLen) {
          ctx.globalAlpha = 0.6 * (1 - d / guideLen);
          ctx.drawImage(dImg, d, -dImg.naturalHeight / 2);
        }
        ctx.globalAlpha = 1;

        // Ghost target circle
        ctx.beginPath();
        ctx.arc(guideLen, 0, BALL_R_PX, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
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
        const barH = TABLE_H;
        const barW = 12;
        const powerPct = power / MAX_POWER;

        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(barX, TABLE_TOP, barW, barH);

        const g = Math.round(255 * (1 - powerPct));
        ctx.fillStyle = `rgb(255, ${g}, 0)`;
        ctx.fillRect(barX, TABLE_TOP + barH * (1 - powerPct), barW, barH * powerPct);

        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, TABLE_TOP, barW, barH);
      }
    }

    // Ball-in-hand text
    if (myTurn && ballInHand && !animating) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '13px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Tap to place cue ball', CANVAS_WIDTH / 2, TABLE_TOP - 10);
    }
  }, [balls, myTurn, animating, ballInHand, isBreakShot, aimAngle, power, settingPower, showGuideLine, assets, pocketingBalls, onTakeShot]);

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

    cue.phase = 'striking';
    cue.strikeStartTime = performance.now();
    cue.strikeDuration = duration;
    cue.shotPower = shotPower;
    cue.shotAngle = shotAngle;
    cue.pullbackPx = shotPower * 0.025; // matches the charging pullback
    shotFiredRef.current = false;
  }, []);

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

    if (ballInHand && draggingCueBall) return;

    if (settingPower && mouseStart) {
      const dx = mx - mouseStart.x;
      const dy = my - mouseStart.y;
      setPower(Math.min(MAX_POWER, Math.sqrt(dx * dx + dy * dy) * 25));
      return;
    }

    setAimAngle(Math.atan2(my - cy, mx - cx));
  }, [balls, myTurn, animating, ballInHand, settingPower, mouseStart, draggingCueBall, getCanvasCoords]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!myTurn || animating) return;
    const cue = cueStateRef.current;
    if (cue.phase !== 'aiming') return;

    const { mx, my } = getCanvasCoords(e);

    if (ballInHand) {
      setDraggingCueBall(true);
      return;
    }

    setSettingPower(true);
    setMouseStart({ x: mx, y: my });
    setPower(0);
  }, [myTurn, animating, ballInHand, getCanvasCoords]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!myTurn || animating) return;
    const { mx, my } = getCanvasCoords(e);

    if (ballInHand && draggingCueBall) {
      const [px, py] = canvasToPhys(mx, my);
      onPlaceCueBall(px, py);
      setDraggingCueBall(false);
      return;
    }

    if (settingPower && power > 40) {
      // Start cue strike animation instead of immediately firing
      startStrike(aimAngle, power);
    }

    setSettingPower(false);
    setPower(0);
    setMouseStart(null);
  }, [myTurn, animating, ballInHand, draggingCueBall, settingPower, power, aimAngle, startStrike, onPlaceCueBall, getCanvasCoords]);

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
      setDraggingCueBall(true);
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
  }, [myTurn, animating, ballInHand, balls, getTouchCoords]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (animating || !myTurn || !e.touches[0]) return;
    const cue = cueStateRef.current;
    if (cue.phase !== 'aiming') return;

    const { mx, my } = getTouchCoords(e.touches[0]);

    const cueBall = balls.find((b) => b.id === 0 && b.active);
    if (!cueBall) return;
    const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);

    if (settingPower && mouseStart) {
      const dx = mx - mouseStart.x;
      const dy = my - mouseStart.y;
      setPower(Math.min(MAX_POWER, Math.sqrt(dx * dx + dy * dy) * 25));
      return;
    }

    setAimAngle(Math.atan2(my - cy, mx - cx));
  }, [balls, myTurn, animating, settingPower, mouseStart, getTouchCoords]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!myTurn || animating) return;

    if (ballInHand && draggingCueBall) {
      const touch = e.changedTouches[0];
      if (touch) {
        const { mx, my } = getTouchCoords(touch);
        const [px, py] = canvasToPhys(mx, my);
        onPlaceCueBall(px, py);
      }
      setDraggingCueBall(false);
      return;
    }

    if (settingPower && power > 40) {
      // Start cue strike animation instead of immediately firing
      startStrike(aimAngle, power);
    }

    setSettingPower(false);
    setPower(0);
    setMouseStart(null);
  }, [myTurn, animating, ballInHand, draggingCueBall, settingPower, power, aimAngle, startStrike, onPlaceCueBall, getTouchCoords]);

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
