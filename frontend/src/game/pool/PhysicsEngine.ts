// Physics engine — mirrors internal/game/pool_physics.go exactly.
// Used client-side for shot animation only (server is authoritative).

import { Vec2, fix } from './Vec2';
import {
  BALL_RADIUS, POCKET_RADIUS, FRICTION, MIN_VELOCITY,
  CUSHION_RESTITUTION, BALL_RESTITUTION, MAX_ITERATIONS, NUM_BALLS,
} from './constants';
import { type Table, type CushionLine, type Vertex, type Pocket } from './TableGeometry';
import {
  lineIntersectCircle, lineIntersectLine, checkObjectsConverging,
  createVectorFrom2Points, type Point,
} from './MathUtils';

export interface BallPhysics {
  id: number;
  position: Vec2;
  velocity: Vec2;
  active: boolean;
  screw: number;
  english: number;
  ySpin: number;
  grip: number;
  deltaScrew: Vec2;
  firstContactMade: boolean;
}

export interface CollisionEvent {
  type: 'ball' | 'line' | 'vertex' | 'pocket';
  ballId: number;
  targetId: number;
  speed: number;
}

interface CollisionCandidate {
  type: string;
  object: BallPhysics;
  target: BallPhysics | CushionLine | Vertex | Pocket;
  time: number;
  objectIntersectPoint: Vec2;
  targetIntersectPoint: Vec2;
}

export class PhysicsEngine {
  balls: BallPhysics[];
  table: Table;
  events: CollisionEvent[];
  private omissionArray: BallPhysics[];

  constructor(balls: BallPhysics[], table: Table) {
    this.balls = balls;
    this.table = table;
    this.events = [];
    this.omissionArray = [];
  }

  /** Run simulation until all balls stop. Returns collision events. */
  simulate(): CollisionEvent[] {
    this.events = [];
    while (!this.allStopped()) {
      this.updatePhysics();
    }
    return this.events;
  }

  allStopped(): boolean {
    for (const b of this.balls) {
      if (b.active && !b.velocity.isZero()) return false;
    }
    if (this.balls[0].active && !this.balls[0].deltaScrew.isZero()) return false;
    return true;
  }

  private updatePhysics(): void {
    this.predictCollisions();
    this.updateFriction();
  }

  /** Run collision detection + movement only (no friction). */
  stepCollisions(): void {
    this.predictCollisions();
  }

  /** Apply friction to all balls (call once per visual frame). */
  stepFriction(): void {
    this.updateFriction();
  }

  private predictCollisions(): void {
    let t = 0;
    let iterations = 0;

    while (true) {
      let bestTime = 1;
      let candidates: CollisionCandidate[] = [];
      const remaining = fix(1 - t);

      for (let a = 0; a < NUM_BALLS; a++) {
        const ball = this.balls[a];
        if (!ball.active) continue;

        const projectedPos = ball.position.plus(ball.velocity.times(remaining));

        // Ball-ball
        for (let p = a; p < NUM_BALLS; p++) {
          const other = this.balls[p];
          if (other === ball || !other.active) continue;
          if (ball.velocity.magnitudeSquared() === 0 && other.velocity.magnitudeSquared() === 0) continue;
          if (!checkObjectsConverging(ball.position, other.position, ball.velocity, other.velocity)) continue;

          const relVel = ball.velocity.minus(other.velocity);
          const projEnd = ball.position.plus(relVel.times(remaining));

          const result = lineIntersectCircle(
            { x: ball.position.x, y: ball.position.y },
            { x: projEnd.x, y: projEnd.y },
            { x: other.position.x, y: other.position.y },
            2 * BALL_RADIUS,
          );

          if (!result.intersects && !result.inside) continue;

          let collisionTime: number;

          if (result.intersects) {
            const hitPoint = result.enter || result.exit;
            if (!hitPoint) continue;
            const fullPath = createVectorFrom2Points(
              { x: ball.position.x, y: ball.position.y },
              { x: projEnd.x, y: projEnd.y },
            );
            const toHit = createVectorFrom2Points(
              { x: ball.position.x, y: ball.position.y },
              hitPoint,
            );
            collisionTime = fullPath.magnitude() > 0
              ? fix(t + (toHit.magnitude() / fullPath.magnitude()) * remaining)
              : t;
          } else {
            collisionTime = t;
          }

          if (collisionTime < bestTime) {
            bestTime = collisionTime;
            candidates = [{
              type: 'ball', object: ball, target: other, time: collisionTime,
              objectIntersectPoint: ball.position.plus(ball.velocity.times(collisionTime - t)),
              targetIntersectPoint: other.position.plus(other.velocity.times(collisionTime - t)),
            }];
          } else if (collisionTime === bestTime && collisionTime !== 1) {
            candidates.push({
              type: 'ball', object: ball, target: other, time: collisionTime,
              objectIntersectPoint: ball.position.plus(ball.velocity.times(collisionTime - t)),
              targetIntersectPoint: other.position.plus(other.velocity.times(collisionTime - t)),
            });
          }
        }

        if (ball.velocity.magnitudeSquared() === 0) continue;

        // Ball-line
        for (const line of this.table.lines) {
          let hit = lineIntersectLine(
            { x: ball.position.x, y: ball.position.y },
            { x: projectedPos.x, y: projectedPos.y },
            { x: line.p3.x, y: line.p3.y },
            { x: line.p4.x, y: line.p4.y },
          );

          if (!hit) {
            hit = lineIntersectLine(
              { x: ball.position.x, y: ball.position.y },
              { x: projectedPos.x, y: projectedPos.y },
              { x: line.p5.x, y: line.p5.y },
              { x: line.p6.x, y: line.p6.y },
            );
            if (hit) {
              const offset = line.normal.times(0.2 * BALL_RADIUS);
              const adjusted = new Vec2(hit.x, hit.y).plus(offset);
              hit = { x: adjusted.x, y: adjusted.y };
            }
          }

          if (!hit) continue;

          const hitVec = new Vec2(hit.x, hit.y);
          const fullPath = createVectorFrom2Points(
            { x: ball.position.x, y: ball.position.y },
            { x: projectedPos.x, y: projectedPos.y },
          );
          const toHit = createVectorFrom2Points(
            { x: ball.position.x, y: ball.position.y },
            hit,
          );
          const collisionTime = fullPath.magnitude() > 0
            ? fix(t + (toHit.magnitude() / fullPath.magnitude()) * remaining)
            : t;

          if (collisionTime < bestTime) {
            bestTime = collisionTime;
            candidates = [{
              type: 'line', object: ball, target: line, time: collisionTime,
              objectIntersectPoint: hitVec, targetIntersectPoint: new Vec2(0, 0),
            }];
          } else if (collisionTime === bestTime && collisionTime !== 1) {
            candidates.push({
              type: 'line', object: ball, target: line, time: collisionTime,
              objectIntersectPoint: hitVec, targetIntersectPoint: new Vec2(0, 0),
            });
          }
        }

        // Ball-vertex
        for (const vtx of this.table.vertices) {
          if (Math.abs(ball.position.x - vtx.position.x) > 8000 ||
              Math.abs(ball.position.y - vtx.position.y) > 8000) continue;

          const result = lineIntersectCircle(
            { x: ball.position.x, y: ball.position.y },
            { x: projectedPos.x, y: projectedPos.y },
            { x: vtx.position.x, y: vtx.position.y },
            BALL_RADIUS,
          );

          if (!result.intersects && !result.inside) continue;

          let hitPoint: Point | null = null;
          let collisionTime: number;

          if (result.intersects) {
            hitPoint = result.enter || result.exit;
            if (!hitPoint) continue;
            const fullPath = createVectorFrom2Points(
              { x: ball.position.x, y: ball.position.y },
              { x: projectedPos.x, y: projectedPos.y },
            );
            const toHit = createVectorFrom2Points(
              { x: ball.position.x, y: ball.position.y },
              hitPoint,
            );
            collisionTime = fullPath.magnitude() > 0
              ? fix(t + (toHit.magnitude() / fullPath.magnitude()) * remaining)
              : t;
          } else {
            collisionTime = t;
            hitPoint = { x: ball.position.x, y: ball.position.y };
          }

          const hitVec = new Vec2(hitPoint.x, hitPoint.y);

          if (collisionTime < bestTime) {
            bestTime = collisionTime;
            candidates = [{
              type: 'vertex', object: ball, target: vtx, time: collisionTime,
              objectIntersectPoint: hitVec, targetIntersectPoint: new Vec2(0, 0),
            }];
          } else if (collisionTime === bestTime && collisionTime !== 1) {
            candidates.push({
              type: 'vertex', object: ball, target: vtx, time: collisionTime,
              objectIntersectPoint: hitVec, targetIntersectPoint: new Vec2(0, 0),
            });
          }
        }

        // Ball-pocket
        for (const pocket of this.table.pockets) {
          if (Math.abs(ball.position.x - pocket.position.x) > 8000 ||
              Math.abs(ball.position.y - pocket.position.y) > 8000) continue;

          const dir = pocket.position.minus(ball.position).normalize();
          if (ball.velocity.dot(dir) <= 0) continue;

          const result = lineIntersectCircle(
            { x: ball.position.x, y: ball.position.y },
            { x: projectedPos.x, y: projectedPos.y },
            { x: pocket.position.x, y: pocket.position.y },
            POCKET_RADIUS,
          );

          if (!result.intersects && !result.inside) continue;

          let hitPoint: Point | null = null;
          let collisionTime: number;

          if (result.intersects) {
            hitPoint = result.enter || result.exit;
            if (!hitPoint) continue;
            const fullPath = createVectorFrom2Points(
              { x: ball.position.x, y: ball.position.y },
              { x: projectedPos.x, y: projectedPos.y },
            );
            const toHit = createVectorFrom2Points(
              { x: ball.position.x, y: ball.position.y },
              hitPoint,
            );
            collisionTime = fullPath.magnitude() > 0
              ? fix(t + (toHit.magnitude() / fullPath.magnitude()) * remaining)
              : t;
          } else {
            collisionTime = t;
            hitPoint = { x: ball.position.x, y: ball.position.y };
          }

          const hitVec = new Vec2(hitPoint.x, hitPoint.y);

          if (collisionTime < bestTime) {
            bestTime = collisionTime;
            candidates = [{
              type: 'pocket', object: ball, target: pocket, time: collisionTime,
              objectIntersectPoint: hitVec, targetIntersectPoint: new Vec2(0, 0),
            }];
          } else if (collisionTime === bestTime && collisionTime !== 1) {
            candidates.push({
              type: 'pocket', object: ball, target: pocket, time: collisionTime,
              objectIntersectPoint: hitVec, targetIntersectPoint: new Vec2(0, 0),
            });
          }
        }
      }

      if (candidates.length > 0) {
        this.resolveCollisions(candidates);
      }

      const dt = fix(bestTime - t);
      this.moveBalls(dt);
      t = bestTime;
      iterations++;

      if (candidates.length === 0 || iterations >= MAX_ITERATIONS) break;
    }
  }

  private resolveCollisions(candidates: CollisionCandidate[]): void {
    this.omissionArray = [];
    for (const c of candidates) {
      switch (c.type) {
        case 'ball': this.resolveBallBall(c); break;
        case 'line': this.resolveBallLine(c); break;
        case 'vertex': this.resolveBallVertex(c); break;
        case 'pocket': this.resolveBallPocket(c); break;
      }
    }
  }

  private resolveBallBall(c: CollisionCandidate): void {
    const ball = c.object;
    const target = c.target as BallPhysics;

    ball.position = c.objectIntersectPoint;
    target.position = c.targetIntersectPoint;
    this.omissionArray.push(ball, target);

    const n = target.position.minus(ball.position).normalize();
    const r = n.rightNormal();

    const ballNormal = n.times(ball.velocity.dot(n));
    const ballTangent = r.times(ball.velocity.dot(r));
    const targetNormal = n.times(target.velocity.dot(n));
    const targetTangent = r.times(target.velocity.dot(r));

    if (Math.abs(target.ySpin) < Math.abs(ball.ySpin)) {
      target.ySpin = -0.5 * ball.ySpin;
    }

    if (ball.id === 0 && !ball.firstContactMade) {
      ball.deltaScrew = ballNormal.times(0.17 * -ball.screw);
      ball.firstContactMade = true;
    }

    const newBallNormal = targetNormal.times(BALL_RESTITUTION).plus(ballNormal.times(1 - BALL_RESTITUTION));
    const newTargetNormal = ballNormal.times(BALL_RESTITUTION).plus(targetNormal.times(1 - BALL_RESTITUTION));

    ball.velocity = ballTangent.plus(newBallNormal);
    target.velocity = targetTangent.plus(newTargetNormal);

    if (newTargetNormal.magnitude() > 450) {
      target.grip = 0;
    }

    this.events.push(
      { type: 'ball', ballId: ball.id, targetId: target.id, speed: ball.velocity.magnitude() },
      { type: 'ball', ballId: target.id, targetId: ball.id, speed: target.velocity.magnitude() },
    );
  }

  private resolveBallLine(c: CollisionCandidate): void {
    const ball = c.object;
    const line = c.target as CushionLine;

    ball.position = c.objectIntersectPoint;
    this.omissionArray.push(ball);

    ball.ySpin += -ball.velocity.dot(line.direction) / 100;
    if (ball.ySpin > 50) ball.ySpin = 50;
    if (ball.ySpin < -50) ball.ySpin = -50;

    const normalComp = line.normal.times(ball.velocity.dot(line.normal));
    let tangentComp = line.direction.times(ball.velocity.dot(line.direction));

    if (ball.id === 0) {
      tangentComp = tangentComp.plus(line.direction.times(fix(0.2 * ball.english * ball.velocity.magnitude())));
      ball.english = fix(0.5 * ball.english);
      if (ball.english > -0.1 && ball.english < 0.1) ball.english = 0;
    }

    ball.velocity = normalComp.times(-CUSHION_RESTITUTION).plus(tangentComp);

    if (normalComp.magnitude() > 700) ball.grip = 0;

    ball.position = ball.position.plus(line.normal.times(200));

    if (ball.id === 0) {
      ball.deltaScrew = ball.deltaScrew.times(0.8);
    }

    this.events.push({ type: 'line', ballId: ball.id, targetId: 0, speed: normalComp.magnitude() });
  }

  private resolveBallVertex(c: CollisionCandidate): void {
    const ball = c.object;
    const vtx = c.target as Vertex;

    ball.position = c.objectIntersectPoint;
    this.omissionArray.push(ball);

    const n = vtx.position.minus(ball.position).normalize();
    const r = n.rightNormal();

    const normalComp = n.times(ball.velocity.dot(n));
    const tangentComp = r.times(ball.velocity.dot(r));

    ball.velocity = normalComp.times(-CUSHION_RESTITUTION).plus(tangentComp);
    ball.position = ball.position.minus(n.times(200));

    if (ball.id === 0) ball.deltaScrew = new Vec2(0, 0);

    this.events.push({ type: 'vertex', ballId: ball.id, targetId: 0, speed: normalComp.magnitude() });
  }

  private resolveBallPocket(c: CollisionCandidate): void {
    const ball = c.object;
    const pocket = c.target as Pocket;

    ball.position = c.objectIntersectPoint;
    this.omissionArray.push(ball);

    const speed = ball.velocity.magnitude();
    ball.active = false;
    ball.velocity = new Vec2(0, 0);

    this.events.push({ type: 'pocket', ballId: ball.id, targetId: pocket.id, speed });
  }

  private moveBalls(dt: number): void {
    for (const ball of this.balls) {
      if (!ball.active) continue;
      if (this.omissionArray.includes(ball)) continue;
      ball.position = ball.position.plus(ball.velocity.times(dt));
    }
    this.omissionArray = [];
  }

  private updateFriction(): void {
    for (const ball of this.balls) {
      if (!ball.active) continue;

      if (ball.id === 0) {
        ball.velocity = ball.velocity.plus(ball.deltaScrew);
        if (ball.deltaScrew.magnitude() > 0) {
          ball.deltaScrew = ball.deltaScrew.times(0.8);
          if (ball.deltaScrew.magnitude() < 1) ball.deltaScrew = new Vec2(0, 0);
        }
      }

      let speed = ball.velocity.magnitude();
      speed -= FRICTION;
      const dir = ball.velocity.normalize();

      if (speed < MIN_VELOCITY) {
        ball.velocity = new Vec2(0, 0);
      } else {
        ball.velocity = dir.times(speed);
      }

      if (ball.grip < 1) {
        ball.grip += 0.02;
        if (ball.grip > 1) ball.grip = 1;
      }

      if (ball.ySpin >= 0.2) ball.ySpin -= 0.2;
      else if (ball.ySpin <= -0.2) ball.ySpin += 0.2;
      else ball.ySpin = 0;

      if (ball.ySpin !== 0) {
        const leftNorm = ball.velocity.leftNormal().normalize();
        const spinEffect = leftNorm.times(0.3 * ball.ySpin * ball.velocity.magnitude() / 800);
        ball.velocity = ball.velocity.plus(spinEffect);
      }
    }
  }
}

/** Create BallPhysics array from ball state (positions + active flags). */
export function createBallsFromState(
  balls: { id: number; x: number; y: number; active: boolean }[]
): BallPhysics[] {
  return balls.map((b) => ({
    id: b.id,
    position: new Vec2(b.x, b.y),
    velocity: new Vec2(0, 0),
    active: b.active,
    screw: 0,
    english: 0,
    ySpin: 0,
    grip: 1,
    deltaScrew: new Vec2(0, 0),
    firstContactMade: false,
  }));
}
