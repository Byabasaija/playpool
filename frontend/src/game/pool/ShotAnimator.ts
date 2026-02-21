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
  pocketX: number; // physics coords
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
    if (cueBall && cueBall.active) {
      const vx = Math.cos(shotParams.angle) * shotParams.power;
      const vy = Math.sin(shotParams.angle) * shotParams.power;
      cueBall.velocity = new Vec2(vx, vy);
      cueBall.screw = shotParams.screw;
      cueBall.english = shotParams.english;
    }

    this.physics = new PhysicsEngine(balls, table);
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

    // Check if all balls stopped
    if (this.physics.allStopped()) {
      const finalFrame = this.buildFrame();
      this.onFrame(finalFrame);
      this.onComplete(finalFrame);
      this.physics = null;
      this.running = false;
      return;
    }

    // Clear events before stepping
    this.physics.events = [];

    // Step physics: 1x collisions + 1x friction per frame (matches original game exactly)
    this.physics.stepCollisions();
    this.physics.stepFriction();

    // Process collision events
    for (const evt of this.physics.events) {
      if (this.onCollision) this.onCollision(evt);
      if (evt.type === 'pocket' && this.onPocket) {
        const pocket = this.physics.table.pockets.find(p => p.id === evt.targetId);
        if (pocket) {
          this.onPocket({
            ballId: evt.ballId,
            pocketX: pocket.dropPosition.x,
            pocketY: pocket.dropPosition.y,
          });
        }
      }
    }

    // Emit current ball positions
    this.onFrame(this.buildFrame());

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
