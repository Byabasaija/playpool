// Collision math utilities — mirrors internal/game/pool_math.go exactly.

import { Vec2, fix } from './Vec2';

export interface Point {
  x: number;
  y: number;
}

export interface IntersectResult {
  inside: boolean;
  tangent: boolean;
  intersects: boolean;
  enter: Point | null;
  exit: Point | null;
}

function pointInterpolate(a: Point, b: Point, t: number): Point {
  return {
    x: fix((1 - t) * a.x + t * b.x),
    y: fix((1 - t) * a.y + t * b.y),
  };
}

/** Test if line segment p1→p2 intersects a circle. */
export function lineIntersectCircle(
  p1: Point, p2: Point, center: Point, radius: number
): IntersectResult {
  const r: IntersectResult = {
    inside: false, tangent: false, intersects: false, enter: null, exit: null,
  };

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const fx = p1.x - center.x;
  const fy = p1.y - center.y;

  const a = fix(dx * dx + dy * dy);
  const b = fix(2 * (dx * fx + dy * fy));
  const c = fix(
    center.x * center.x + center.y * center.y +
    p1.x * p1.x + p1.y * p1.y -
    2 * (center.x * p1.x + center.y * p1.y) -
    radius * radius
  );

  const discriminant = fix(b * b - 4 * a * c);
  if (discriminant <= 0) return r;

  const sqrtDisc = fix(Math.sqrt(discriminant));
  const t1 = fix((-b + sqrtDisc) / (2 * a)); // exit
  const t2 = fix((-b - sqrtDisc) / (2 * a)); // enter

  if ((t1 < 0 || t1 > 1) && (t2 < 0 || t2 > 1)) {
    r.inside = !((t1 < 0 && t2 < 0) || (t1 > 1 && t2 > 1));
    return r;
  }

  if (t2 >= 0 && t2 <= 1) {
    const pt = pointInterpolate(p1, p2, t2);
    r.enter = { x: fix(pt.x), y: fix(pt.y) };
  }

  if (t1 >= 0 && t1 <= 1) {
    const pt = pointInterpolate(p1, p2, t1);
    r.exit = { x: fix(pt.x), y: fix(pt.y) };
  }

  r.intersects = true;

  if (r.exit && r.enter && r.exit.x === r.enter.x && r.exit.y === r.enter.y) {
    r.tangent = true;
  }

  return r;
}

/** Test if two line segments intersect. Returns intersection point or null. */
export function lineIntersectLine(
  p1: Point, p2: Point, p3: Point, p4: Point
): Point | null {
  const a1 = p2.y - p1.y;
  const b1 = p1.x - p2.x;
  const c1 = p2.x * p1.y - p1.x * p2.y;

  const a2 = p4.y - p3.y;
  const b2 = p3.x - p4.x;
  const c2 = p4.x * p3.y - p3.x * p4.y;

  const denom = a1 * b2 - a2 * b1;
  if (denom === 0) return null;

  const x = fix((b1 * c2 - b2 * c1) / denom);
  const y = fix((a2 * c1 - a1 * c2) / denom);

  if (
    (x - p1.x) * (x - p2.x) > 0 || (y - p1.y) * (y - p2.y) > 0 ||
    (x - p3.x) * (x - p4.x) > 0 || (y - p3.y) * (y - p4.y) > 0
  ) {
    return null;
  }

  return { x, y };
}

/** Check if two objects are moving toward each other. */
export function checkObjectsConverging(
  posA: Vec2, posB: Vec2, velA: Vec2, velB: Vec2
): boolean {
  const relVel = velB.minus(velA);
  const direction = posB.minus(posA).normalize();
  return relVel.angleBetween(direction) > 90;
}

/** Create a Vec2 from point a to point b. */
export function createVectorFrom2Points(a: Point, b: Point): Vec2 {
  return new Vec2(b.x - a.x, b.y - a.y);
}
