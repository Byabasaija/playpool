// Animates a pool shot by stepping through client-side physics frame by frame.
// After animation, snaps to the server's authoritative final positions.

import { Vec2, fix } from './Vec2';
import { PhysicsEngine, createBallsFromState } from './PhysicsEngine';
import { createStandard8BallTable } from './TableGeometry';

export interface BallFrame {
  id: number;
  x: number;
  y: number;
  active: boolean;
}

export interface ShotAnimationParams {
  angle: number;
  power: number;
  screw: number;
  english: number;
}

export interface ServerBallPosition {
  id: number;
  x: number;
  y: number;
  active: boolean;
}

export class ShotAnimator {
  private engine: PhysicsEngine | null = null;
  private animFrameId: number | null = null;
  private onFrame: (balls: BallFrame[]) => void;
  private onComplete: (serverPositions: ServerBallPosition[]) => void;
  private serverPositions: ServerBallPosition[] = [];
  private running = false;

  constructor(
    onFrame: (balls: BallFrame[]) => void,
    onComplete: (serverPositions: ServerBallPosition[]) => void,
  ) {
    this.onFrame = onFrame;
    this.onComplete = onComplete;
  }

  /** Start animating a shot. */
  start(
    currentBalls: { id: number; x: number; y: number; active: boolean }[],
    shotParams: ShotAnimationParams,
    serverFinalPositions: ServerBallPosition[],
  ): void {
    this.stop();
    this.serverPositions = serverFinalPositions;
    this.running = true;

    const table = createStandard8BallTable();
    const balls = createBallsFromState(currentBalls);

    // Apply shot to cue ball
    const vx = fix(Math.cos(shotParams.angle) * shotParams.power);
    const vy = fix(Math.sin(shotParams.angle) * shotParams.power);
    balls[0].velocity = new Vec2(vx, vy);
    balls[0].screw = shotParams.screw;
    balls[0].english = shotParams.english;

    this.engine = new PhysicsEngine(balls, table);
    this.tick();
  }

  /** Stop animation and snap to server positions. */
  stop(): void {
    this.running = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.engine = null;
  }

  private tick = (): void => {
    if (!this.running || !this.engine) return;

    // Step one physics frame
    this.engine['updatePhysics']();

    // Emit current ball positions
    const frame: BallFrame[] = this.engine.balls.map((b) => ({
      id: b.id,
      x: b.position.x,
      y: b.position.y,
      active: b.active,
    }));
    this.onFrame(frame);

    // Check if all balls stopped
    if (this.engine.allStopped()) {
      this.running = false;
      this.onComplete(this.serverPositions);
      return;
    }

    this.animFrameId = requestAnimationFrame(this.tick);
  };

  isRunning(): boolean {
    return this.running;
  }
}
