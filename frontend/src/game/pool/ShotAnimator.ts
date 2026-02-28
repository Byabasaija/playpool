// Animates a pool shot using the deterministic PhysicsEngine.
// Steps physics frame by frame (3x collisions + 1x friction per rAF).
// No snap-to-server — PhysicsEngine mirrors Go server exactly.

import { PhysicsEngine, createBallsFromState, type CollisionEvent } from './PhysicsEngine';
import { createStandard8BallTable } from './TableGeometry';
import { Vec2 } from './Vec2';

export interface BallFrame {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  active: boolean;
  grip: number;
  ySpin: number;
}

export interface ShotAnimationParams {
  angle: number;
  power: number;
  screw: number;
  english: number;
}

export interface PocketEvent {
  ballId: number;
  ballX?: number; // physics coords at pocket time (optional, added later)
  ballY?: number;
  pocketX: number; // physics coords where ball falls through
  pocketY: number;
}

export class ShotAnimator {
  private physics: PhysicsEngine | null = null;
  private animFrameId: number | null = null;
  private onFrame: (balls: BallFrame[]) => void;
  private onComplete: (finalPositions: BallFrame[]) => void;
  private onCollision: ((event: CollisionEvent) => void) | null = null;
  private onPocket: ((event: PocketEvent) => void) | null = null;
  private running = false;
  private lastTime = 0;
  private accumulator = 0;
  private static readonly FIXED_DT = 1000 / 60; // Fixed 60fps physics timestep

  constructor(
    onFrame: (balls: BallFrame[]) => void,
    onComplete: (finalPositions: BallFrame[]) => void,
    onCollision?: (event: CollisionEvent) => void,
  ) {
    this.onFrame = onFrame;
    this.onComplete = onComplete;
    this.onCollision = onCollision || null;
  }

  setOnCollision(cb: (event: CollisionEvent) => void): void {
    this.onCollision = cb;
  }

  setOnPocket(cb: (event: PocketEvent) => void): void {
    this.onPocket = cb;
  }

  /** Start animating a shot using deterministic PhysicsEngine. */
  start(
    currentBalls: { id: number; x: number; y: number; active: boolean }[],
    shotParams: ShotAnimationParams,
  ): void {
    this.stop();
    this.running = true;

    const table = createStandard8BallTable();
    const balls = createBallsFromState(currentBalls);

    // Apply shot to cue ball
    const cueBall = balls[0];
    console.log('[ShotAnimator] start: cueBall=', cueBall ? { id: cueBall.id, x: cueBall.position.x.toFixed(0), y: cueBall.position.y.toFixed(0), active: cueBall.active } : null, 'totalBalls=', balls.length);
    if (cueBall && cueBall.active) {
      const vx = Math.cos(shotParams.angle) * shotParams.power;
      const vy = Math.sin(shotParams.angle) * shotParams.power;
      cueBall.velocity = new Vec2(vx, vy);
      cueBall.screw = shotParams.screw;
      cueBall.english = shotParams.english;

      // Apply initial ySpin from english (matches original game: applied immediately on shot)
      const speed = cueBall.velocity.magnitude();
      cueBall.ySpin = -cueBall.english * speed / 300;
      if (cueBall.ySpin > 20) cueBall.ySpin = 20;
      if (cueBall.ySpin < -20) cueBall.ySpin = -20;
    }

    this.physics = new PhysicsEngine(balls, table);
    this.lastTime = 0;
    this.accumulator = 0;
    this.tick();
  }

  /** Stop animation. */
  stop(): void {
    this.running = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.physics = null;
  }

  private tick = (): void => {
    if (!this.running || !this.physics) return;

    const now = performance.now();
    if (this.lastTime === 0) {
      this.lastTime = now;
      // Ensure first frame steps immediately
      this.accumulator = ShotAnimator.FIXED_DT;
    } else {
      this.accumulator += now - this.lastTime;
      this.lastTime = now;
    }

    // Cap accumulator to prevent spiral of death
    if (this.accumulator > ShotAnimator.FIXED_DT * 4) {
      this.accumulator = ShotAnimator.FIXED_DT * 4;
    }

    let stepped = false;
    while (this.accumulator >= ShotAnimator.FIXED_DT) {
      this.accumulator -= ShotAnimator.FIXED_DT;

      // Check if all balls stopped
      if (this.physics.allStopped()) {
        console.log('[ShotAnimator] allStopped — animation ended. Cue ball:', this.physics.balls[0] ? { id: this.physics.balls[0].id, active: this.physics.balls[0].active, vel: this.physics.balls[0].velocity.magnitude().toFixed(1) } : null);
        const finalFrame = this.buildFrame();
        this.onFrame(finalFrame);
        this.onComplete(finalFrame);
        this.physics = null;
        this.running = false;
        return;
      }

      // Clear events before stepping
      this.physics.events = [];

      // Step physics: 1x collisions + 1x friction per step (matches original 60fps game)
      this.physics.stepCollisions();
      this.physics.stepFriction();

      // Process collision events
      for (const evt of this.physics.events) {
        if (this.onCollision) this.onCollision(evt);
        if (evt.type === 'pocket' && this.onPocket) {
          const pocket = this.physics.table.pockets.find(p => p.id === evt.targetId);
          if (pocket) {
            // try to capture the ball's current position from physics
            const ball = this.physics?.balls.find(b => b.id === evt.ballId);
            const event: PocketEvent = {
              ballId: evt.ballId,
              pocketX: pocket.dropPosition.x,
              pocketY: pocket.dropPosition.y,
            };
            if (ball) {
              event.ballX = ball.position.x;
              event.ballY = ball.position.y;
            }
            this.onPocket(event);
          }
        }
      }

      stepped = true;
    }

    // Only emit frame when physics actually stepped (keeps rotation at 60fps too)
    if (stepped) {
      this.onFrame(this.buildFrame());
    }

    this.animFrameId = requestAnimationFrame(this.tick);
  };

  private buildFrame(): BallFrame[] {
    if (!this.physics) return [];
    return this.physics.balls.map(b => ({
      id: b.id,
      x: b.position.x,
      y: b.position.y,
      vx: b.velocity.x,
      vy: b.velocity.y,
      active: b.active,
      grip: b.grip,
      ySpin: b.ySpin,
    }));
  }

  isRunning(): boolean {
    return this.running;
  }
}
