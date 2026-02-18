// Main pool table canvas — sprite-based rendering with 8Ball-Pool-HTML5 assets.

import { useRef, useEffect, useCallback, useState } from 'react';
import { BALL_RADIUS, N, MAX_POWER } from './constants';
import { createStandard8BallTable, type Table } from './TableGeometry';
import { PoolAssets } from './AssetLoader';
import { drawBall, drawPocketingBall } from './BallRenderer';

interface PocketingAnim {
  ballId: number;
  startX: number; // canvas coords
  startY: number;
  targetX: number; // canvas coords
  targetY: number;
  startTime: number;
  duration: number; // ms
}

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

// Canvas dimensions (wider to accommodate wooden rail frame)
const CANVAS_WIDTH = 990;
const CANVAS_HEIGHT = 560;

// Table play area (inside the rails)
const RAIL_MARGIN = 55;
const TABLE_LEFT = RAIL_MARGIN + 40;
const TABLE_TOP = RAIL_MARGIN + 30;
const TABLE_W = CANVAS_WIDTH - TABLE_LEFT * 2;
const TABLE_H = CANVAS_HEIGHT - TABLE_TOP * 2;

// Physics-to-canvas conversion
const TABLE_PHYS_W = 100 * N;
const TABLE_PHYS_H = 50 * N;
const SCALE_X = TABLE_W / TABLE_PHYS_W;
const SCALE_Y = TABLE_H / TABLE_PHYS_H;
const BALL_R_PX = BALL_RADIUS * SCALE_X;

export function physToCanvas(px: number, py: number): [number, number] {
  const cx = TABLE_LEFT + TABLE_W / 2 + px * SCALE_X;
  const cy = TABLE_TOP + TABLE_H / 2 + py * SCALE_Y;
  return [cx, cy];
}

function canvasToPhys(cx: number, cy: number): [number, number] {
  const px = (cx - TABLE_LEFT - TABLE_W / 2) / SCALE_X;
  const py = (cy - TABLE_TOP - TABLE_H / 2) / SCALE_Y;
  return [px, py];
}

export { type PocketingAnim };

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

  if (!tableRef.current) {
    tableRef.current = createStandard8BallTable();
  }

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
    // Layer 1: Pockets (bottom — dark holes visible through cloth)
    ctx.drawImage(
      assets.images.pockets,
      TABLE_LEFT - RAIL_MARGIN, TABLE_TOP - RAIL_MARGIN,
      TABLE_W + RAIL_MARGIN * 2, TABLE_H + RAIL_MARGIN * 2,
    );

    // Layer 2: Cloth texture (felt surface)
    ctx.drawImage(
      assets.images.cloth,
      TABLE_LEFT, TABLE_TOP, TABLE_W, TABLE_H,
    );

    // Layer 3: Table top frame (wooden rails — transparent center)
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

      // Ease out: decelerating toward pocket
      const ease = 1 - (1 - progress) * (1 - progress);
      const cx = pa.startX + (pa.targetX - pa.startX) * ease;
      const cy = pa.startY + (pa.targetY - pa.startY) * ease;
      const scale = 1 - ease;

      drawPocketingBall(ctx, assets, pa.ballId, cx, cy, BALL_R_PX, scale);
    }

    // === AIMING GUIDE + CUE STICK ===
    const cueBall = balls.find((b) => b.id === 0 && b.active);
    if (myTurn && !animating && !ballInHand && cueBall) {
      const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);

      // Guide line (configurable)
      if (showGuideLine) {
        const guideLen = 300;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(aimAngle);

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

      // Cue stick (sprite-based)
      // Sprite: tip at left (x=0), butt at right. We draw behind the cue ball.
      const cueGap = BALL_R_PX * 1.5 + (settingPower ? power * 0.025 : 0);
      const cueDrawLen = BALL_R_PX * 16;
      const cueDrawThick = BALL_R_PX * 0.9;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(aimAngle + Math.PI); // point away from aim (behind ball)

      // Draw cue with tip closest to ball — sprite has tip at left (x=0),
      // so we flip horizontally to point tip toward the ball.

      // Shadow (flipped to match cue body)
      ctx.save();
      ctx.translate(3, 4);
      ctx.globalAlpha = 0.4;
      ctx.scale(-1, 1);
      ctx.drawImage(assets.images.cueShadow, -(cueGap + cueDrawLen), -cueDrawThick / 2, cueDrawLen, cueDrawThick);
      ctx.globalAlpha = 1;
      ctx.restore();

      // Cue body
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(assets.images.cue, -(cueGap + cueDrawLen), -cueDrawThick / 2, cueDrawLen, cueDrawThick);
      ctx.restore();

      ctx.restore();

      // Power indicator bar
      if (settingPower && power > 0) {
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
  }, [balls, myTurn, animating, ballInHand, isBreakShot, aimAngle, power, settingPower, showGuideLine, assets, pocketingBalls]);

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
    const { mx, my } = getCanvasCoords(e);

    const cueBall = balls.find((b) => b.id === 0 && b.active);
    if (!cueBall) return;
    const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);

    if (ballInHand && draggingCueBall) return;

    if (settingPower && mouseStart) {
      // While holding down, drag distance = power
      const dx = mx - mouseStart.x;
      const dy = my - mouseStart.y;
      setPower(Math.min(MAX_POWER, Math.sqrt(dx * dx + dy * dy) * 25));
      return;
    }

    // Free hover: cue follows cursor direction
    setAimAngle(Math.atan2(my - cy, mx - cx));
  }, [balls, myTurn, animating, ballInHand, settingPower, mouseStart, draggingCueBall, getCanvasCoords]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!myTurn || animating) return;
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
      onTakeShot({ angle: aimAngle, power, screw: 0, english: 0 });
    }

    setSettingPower(false);
    setPower(0);
    setMouseStart(null);
  }, [myTurn, animating, ballInHand, draggingCueBall, settingPower, power, aimAngle, onTakeShot, onPlaceCueBall, getCanvasCoords]);

  // Touch handlers for mobile
  const getTouchCoords = useCallback((touch: React.Touch) => {
    return clientToCanvas(touch.clientX, touch.clientY);
  }, [clientToCanvas]);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!myTurn || animating || !e.touches[0]) return;
    const { mx, my } = getTouchCoords(e.touches[0]);

    if (ballInHand) {
      setDraggingCueBall(true);
      return;
    }

    // Set aim angle on touch start
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
      onTakeShot({ angle: aimAngle, power, screw: 0, english: 0 });
    }

    setSettingPower(false);
    setPower(0);
    setMouseStart(null);
  }, [myTurn, animating, ballInHand, draggingCueBall, settingPower, power, aimAngle, onTakeShot, onPlaceCueBall, getTouchCoords]);

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
