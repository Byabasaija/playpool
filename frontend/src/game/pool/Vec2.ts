// 2D vector with fixed-precision arithmetic to match server-side physics.
// This MUST match the Go Vec2 in internal/game/vector2d.go exactly.

/** Round to 4 decimal places, matching Maths.fixNumber in the JS reference. */
export function fix(n: number): number {
  if (isNaN(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

export class Vec2 {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = fix(x);
    this.y = fix(y);
  }

  plus(o: Vec2): Vec2 {
    return new Vec2(this.x + o.x, this.y + o.y);
  }

  minus(o: Vec2): Vec2 {
    return new Vec2(this.x - o.x, this.y - o.y);
  }

  times(s: number): Vec2 {
    return new Vec2(this.x * s, this.y * s);
  }

  timesVec(o: Vec2): Vec2 {
    return new Vec2(this.x * o.x, this.y * o.y);
  }

  dot(o: Vec2): number {
    return fix(this.x * o.x + this.y * o.y);
  }

  cross(o: Vec2): number {
    return Math.abs(fix(this.x * o.y - this.y * o.x));
  }

  magnitude(): number {
    return fix(Math.sqrt(this.x * this.x + this.y * this.y));
  }

  magnitudeSquared(): number {
    return fix(this.x * this.x + this.y * this.y);
  }

  normalize(): Vec2 {
    const m = this.magnitude();
    if (m === 0) return new Vec2(0, 0);
    return this.times(1 / m);
  }

  rightNormal(): Vec2 {
    return new Vec2(this.y, -this.x);
  }

  leftNormal(): Vec2 {
    return new Vec2(-this.y, this.x);
  }

  rotate(degrees: number): Vec2 {
    const rad = (degrees * Math.PI) / 180;
    const mag = Math.sqrt(this.x * this.x + this.y * this.y);
    const currentAngle = Math.atan2(this.y, this.x);
    const newAngle = currentAngle + rad;
    return new Vec2(mag * Math.cos(newAngle), mag * Math.sin(newAngle));
  }

  invert(): Vec2 {
    return new Vec2(-this.x, -this.y);
  }

  angleBetween(o: Vec2): number {
    const denom = this.magnitude() * o.magnitude();
    if (denom === 0) return 0;
    let cos = this.dot(o) / denom;
    if (cos > 1) cos = 1;
    if (cos < -1) cos = -1;
    return fix(Math.acos(cos) * (180 / Math.PI));
  }

  angleBetweenCos(o: Vec2): number {
    const denom = this.magnitude() * o.magnitude();
    if (denom === 0) return 0;
    return fix(this.dot(o) / denom);
  }

  isZero(): boolean {
    return this.x === 0 && this.y === 0;
  }

  isEqualTo(o: Vec2): boolean {
    return this.x === o.x && this.y === o.y;
  }
}
