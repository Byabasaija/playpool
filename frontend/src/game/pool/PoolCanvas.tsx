// Main pool table canvas component — Miniclip 8 Ball Pool style.
// Renders table, balls, cue stick, aiming guide, and handles input.

import { useRef, useEffect, useCallback, useState } from 'react';
import { BALL_RADIUS, N, MAX_POWER, POCKET_RADIUS } from './constants';
import { createStandard8BallTable, type Table } from './TableGeometry';

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
}

// Ball colors matching standard 8-ball set
const BALL_COLORS: Record<number, string> = {
  0: '#FFFFFF',  // cue
  1: '#FFD700',  // yellow
  2: '#0000FF',  // blue
  3: '#FF0000',  // red
  4: '#800080',  // purple
  5: '#FF6600',  // orange
  6: '#008000',  // green
  7: '#800000',  // maroon
  8: '#000000',  // eight ball
  9: '#FFD700',  // stripe yellow
  10: '#0000FF', // stripe blue
  11: '#FF0000', // stripe red
  12: '#800080', // stripe purple
  13: '#FF6600', // stripe orange
  14: '#008000', // stripe green
  15: '#800000', // stripe maroon
};

// Canvas dimensions
const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 500;

// Table rendering bounds (in canvas pixels)
const TABLE_LEFT = 50;
const TABLE_TOP = 50;
const TABLE_RIGHT = CANVAS_WIDTH - 50;
const TABLE_BOTTOM = CANVAS_HEIGHT - 50;
const TABLE_W = TABLE_RIGHT - TABLE_LEFT;
const TABLE_H = TABLE_BOTTOM - TABLE_TOP;

// Physics-to-canvas conversion
const TABLE_PHYS_W = 100 * N; // total width in physics units
const TABLE_PHYS_H = 50 * N;
const SCALE_X = TABLE_W / TABLE_PHYS_W;
const SCALE_Y = TABLE_H / TABLE_PHYS_H;
const BALL_R_PX = BALL_RADIUS * SCALE_X;
const POCKET_R_PX = POCKET_RADIUS * SCALE_X;

function physToCanvas(px: number, py: number): [number, number] {
  const cx = TABLE_LEFT + TABLE_W / 2 + px * SCALE_X;
  const cy = TABLE_TOP + TABLE_H / 2 + py * SCALE_Y;
  return [cx, cy];
}

function canvasToPhys(cx: number, cy: number): [number, number] {
  const px = (cx - TABLE_LEFT - TABLE_W / 2) / SCALE_X;
  const py = (cy - TABLE_TOP - TABLE_H / 2) / SCALE_Y;
  return [px, py];
}

export default function PoolCanvas({
  balls, myTurn, ballInHand, isBreakShot, myGroup: _myGroup, opponentGroup: _opponentGroup,
  animating, onTakeShot, onPlaceCueBall,
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

  // Draw everything
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Table felt
    ctx.fillStyle = '#0e6b0e';
    ctx.beginPath();
    ctx.roundRect(TABLE_LEFT, TABLE_TOP, TABLE_W, TABLE_H, 8);
    ctx.fill();

    // Cushion rails
    ctx.strokeStyle = '#5c3a1e';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.roundRect(TABLE_LEFT - 6, TABLE_TOP - 6, TABLE_W + 12, TABLE_H + 12, 12);
    ctx.stroke();

    // Outer rail
    ctx.strokeStyle = '#3d2510';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(TABLE_LEFT - 12, TABLE_TOP - 12, TABLE_W + 24, TABLE_H + 24, 16);
    ctx.stroke();

    // Pockets
    const table = tableRef.current!;
    for (const pocket of table.pockets) {
      const [px, py] = physToCanvas(pocket.position.x, pocket.position.y);
      ctx.beginPath();
      ctx.arc(px, py, POCKET_R_PX * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = '#000000';
      ctx.fill();
    }

    // Head string line (for break)
    if (isBreakShot && ballInHand) {
      const [lx] = physToCanvas(-15000 * 2.3, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(lx, TABLE_TOP);
      ctx.lineTo(lx, TABLE_BOTTOM);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Ball shadows
    for (const ball of balls) {
      if (!ball.active) continue;
      const [bx, by] = physToCanvas(ball.x, ball.y);
      ctx.beginPath();
      ctx.ellipse(bx + 2, by + 3, BALL_R_PX, BALL_R_PX * 0.85, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();
    }

    // Balls
    for (const ball of balls) {
      if (!ball.active) continue;
      const [bx, by] = physToCanvas(ball.x, ball.y);
      const isStripe = ball.id >= 9 && ball.id <= 15;
      const color = BALL_COLORS[ball.id] || '#FFFFFF';

      // Ball body
      ctx.beginPath();
      ctx.arc(bx, by, BALL_R_PX, 0, Math.PI * 2);

      if (isStripe) {
        // Stripe: white base with colored band
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, BALL_R_PX, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = color;
        ctx.fillRect(bx - BALL_R_PX, by - BALL_R_PX * 0.45, BALL_R_PX * 2, BALL_R_PX * 0.9);
        ctx.restore();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }

      // Ball outline
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Ball number
      if (ball.id > 0) {
        // White circle for number
        ctx.beginPath();
        ctx.arc(bx, by, BALL_R_PX * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();

        ctx.fillStyle = '#000000';
        ctx.font = `bold ${Math.round(BALL_R_PX * 0.55)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(ball.id), bx, by + 0.5);
      }

      // Highlight/sheen
      ctx.beginPath();
      ctx.arc(bx - BALL_R_PX * 0.25, by - BALL_R_PX * 0.25, BALL_R_PX * 0.3, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(
        bx - BALL_R_PX * 0.25, by - BALL_R_PX * 0.25, 0,
        bx - BALL_R_PX * 0.25, by - BALL_R_PX * 0.25, BALL_R_PX * 0.3,
      );
      grad.addColorStop(0, 'rgba(255,255,255,0.5)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Aiming guide + cue stick (when it's my turn and not animating)
    const cueBall = balls.find((b) => b.id === 0 && b.active);
    if (myTurn && !animating && !ballInHand && cueBall) {
      const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);
      const dirX = Math.cos(aimAngle);
      const dirY = Math.sin(aimAngle);

      // Aiming guide line (dotted)
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const guideLen = 300;
      ctx.lineTo(cx + dirX * guideLen, cy + dirY * guideLen);
      ctx.stroke();
      ctx.setLineDash([]);

      // Ghost cue ball at aim target
      ctx.beginPath();
      ctx.arc(cx + dirX * guideLen, cy + dirY * guideLen, BALL_R_PX, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // Cue stick
      const cueOffset = BALL_R_PX * 1.5 + (settingPower ? power * 0.02 : 0);
      const cueLen = 200;
      const cueX1 = cx - dirX * cueOffset;
      const cueY1 = cy - dirY * cueOffset;
      const cueX2 = cx - dirX * (cueOffset + cueLen);
      const cueY2 = cy - dirY * (cueOffset + cueLen);

      // Cue shadow
      ctx.beginPath();
      ctx.moveTo(cueX1 + 2, cueY1 + 2);
      ctx.lineTo(cueX2 + 2, cueY2 + 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 5;
      ctx.stroke();

      // Cue body
      const cueGrad = ctx.createLinearGradient(cueX1, cueY1, cueX2, cueY2);
      cueGrad.addColorStop(0, '#f5e6c8');  // tip
      cueGrad.addColorStop(0.15, '#d4a74a'); // ferrule
      cueGrad.addColorStop(0.2, '#5c3a1e');  // shaft
      cueGrad.addColorStop(1, '#2a1a0a');    // butt
      ctx.beginPath();
      ctx.moveTo(cueX1, cueY1);
      ctx.lineTo(cueX2, cueY2);
      ctx.strokeStyle = cueGrad;
      ctx.lineWidth = 4;
      ctx.stroke();

      // Power indicator
      if (settingPower && power > 0) {
        const powerPct = power / MAX_POWER;
        ctx.fillStyle = `rgba(255, ${Math.round(255 * (1 - powerPct))}, 0, 0.8)`;
        ctx.fillRect(CANVAS_WIDTH - 30, TABLE_TOP, 15, TABLE_H);
        ctx.fillStyle = `rgba(255, ${Math.round(255 * (1 - powerPct))}, 0, 1)`;
        ctx.fillRect(CANVAS_WIDTH - 30, TABLE_BOTTOM - TABLE_H * powerPct, 15, TABLE_H * powerPct);

        // Border
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1;
        ctx.strokeRect(CANVAS_WIDTH - 30, TABLE_TOP, 15, TABLE_H);
      }
    }

    // Ball-in-hand indicator
    if (myTurn && ballInHand && !animating) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Click to place cue ball', CANVAS_WIDTH / 2, TABLE_TOP - 15);
    }
  }, [balls, myTurn, animating, ballInHand, isBreakShot, aimAngle, power, settingPower]);

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

  // Mouse handlers
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || animating) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (CANVAS_WIDTH / rect.width);
    const my = (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height);

    const cueBall = balls.find((b) => b.id === 0 && b.active);
    if (!cueBall || !myTurn) return;
    const [cx, cy] = physToCanvas(cueBall.x, cueBall.y);

    if (ballInHand && draggingCueBall) {
      // Just track — placement happens on mouseUp
      return;
    }

    if (settingPower && mouseStart) {
      // Calculate power from drag distance
      const dx = mx - mouseStart.x;
      const dy = my - mouseStart.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const pwr = Math.min(MAX_POWER, dist * 25);
      setPower(pwr);
      return;
    }

    // Update aim angle
    const angle = Math.atan2(my - cy, mx - cx);
    setAimAngle(angle);
  }, [balls, myTurn, animating, ballInHand, settingPower, mouseStart, draggingCueBall]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !myTurn || animating) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (CANVAS_WIDTH / rect.width);
    const my = (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height);

    if (ballInHand) {
      setDraggingCueBall(true);
      return;
    }

    setSettingPower(true);
    setMouseStart({ x: mx, y: my });
    setPower(0);
  }, [myTurn, animating, ballInHand]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !myTurn || animating) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (CANVAS_WIDTH / rect.width);
    const my = (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height);

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
  }, [myTurn, animating, ballInHand, draggingCueBall, settingPower, power, aimAngle, onTakeShot, onPlaceCueBall]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      style={{ width: '100%', maxWidth: '900px', touchAction: 'none', cursor: myTurn && !animating ? 'crosshair' : 'default' }}
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
    />
  );
}
