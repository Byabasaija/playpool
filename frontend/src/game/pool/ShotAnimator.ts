// Animates a pool shot by stepping through client-side physics frame by frame.
// After animation, smoothly interpolates to the server's authoritative final positions.

import { Vec2, fix } from './Vec2';
import { PhysicsEngine, createBallsFromState, CollisionEvent } from './PhysicsEngine';
import { createStandard8BallTable } from './TableGeometry';

export interface BallFrame {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
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

export interface PocketEvent {
  ballId: number;
  pocketX: number; // physics coords
  pocketY: number;
}

export class ShotAnimator {
  private engine: PhysicsEngine | null = null;
  private animFrameId: number | null = null;
  private onFrame: (balls: BallFrame[]) => void;
  private onComplete: (serverPositions: ServerBallPosition[]) => void;
  private onCollision: ((event: CollisionEvent) => void) | null = null;
  private onPocket: ((event: PocketEvent) => void) | null = null;
  private serverPositions: ServerBallPosition[] = [];
  private running = false;
  private lastEventIndex = 0;

  constructor(
    onFrame: (balls: BallFrame[]) => void,
    onComplete: (serverPositions: ServerBallPosition[]) => void,
    onCollision?: (event: CollisionEvent) => void,
  ) {
    this.onFrame = onFrame;
    this.onComplete = onComplete;
    this.onCollision = onCollision || null;
  }

  /** Update the collision callback (e.g. when sound manager changes). */
  setOnCollision(cb: (event: CollisionEvent) => void): void {
    this.onCollision = cb;
  }

  /** Set callback for pocket events (ball entering pocket). */
  setOnPocket(cb: (event: PocketEvent) => void): void {
    this.onPocket = cb;
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
    this.lastEventIndex = 0;

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

  /** Stop animation. */
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

    // Sub-step: run 3 physics steps per visual frame for smoother motion
    for (let i = 0; i < 3; i++) {
      if (this.engine.allStopped()) {
        this.snapToServer();
        return;
      }
      this.engine['updatePhysics']();

      // Emit collision events for sound + pocket animation
      const newEvents = this.engine.events.slice(this.lastEventIndex);
      this.lastEventIndex = this.engine.events.length;
      for (const evt of newEvents) {
        if (this.onCollision) this.onCollision(evt);
        if (evt.type === 'pocket' && this.onPocket) {
          // Find the pocket position from the table
          const pocket = this.engine.table.pockets.find(p => p.id === evt.targetId);
          if (pocket) {
            this.onPocket({
              ballId: evt.ballId,
              pocketX: pocket.dropPosition.x,
              pocketY: pocket.dropPosition.y,
            });
          }
        }
      }
    }

    // Emit current ball positions with velocity for rotation tracking
    const frame: BallFrame[] = this.engine.balls.map((b) => ({
      id: b.id,
      x: b.position.x,
      y: b.position.y,
      vx: b.velocity.x,
      vy: b.velocity.y,
      active: b.active,
    }));
    this.onFrame(frame);

    this.animFrameId = requestAnimationFrame(this.tick);
  };

  /** Smoothly interpolate from client prediction to server positions over ~200ms. */
  private snapToServer(): void {
    this.running = false;
    if (!this.engine) {
      this.onComplete(this.serverPositions);
      return;
    }

    const clientPos = this.engine.balls.map(b => ({
      id: b.id, x: b.position.x, y: b.position.y, active: b.active,
    }));

    // Build a map for quick server position lookup
    const serverMap = new Map<number, ServerBallPosition>();
    for (const sp of this.serverPositions) serverMap.set(sp.id, sp);

    let t = 0;
    const STEPS = 8; // ~8 frames at 60fps = ~133ms

    const lerpTick = () => {
      t++;
      const frac = t / STEPS;

      if (frac >= 1) {
        // Final snap
        this.onFrame(this.serverPositions.map(sp => ({ ...sp, vx: 0, vy: 0 })));
        this.onComplete(this.serverPositions);
        return;
      }

      const interpolated: BallFrame[] = clientPos.map(cp => {
        const sp = serverMap.get(cp.id);
        if (!sp) return { ...cp, vx: 0, vy: 0 };
        return {
          id: cp.id,
          x: cp.x + (sp.x - cp.x) * frac,
          y: cp.y + (sp.y - cp.y) * frac,
          vx: 0,
          vy: 0,
          active: sp.active,
        };
      });
      this.onFrame(interpolated);
      requestAnimationFrame(lerpTick);
    };

    requestAnimationFrame(lerpTick);
  }

  isRunning(): boolean {
    return this.running;
  }
}
