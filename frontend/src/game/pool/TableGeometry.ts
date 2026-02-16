// Table geometry — mirrors internal/game/pool_table.go exactly.

import { Vec2 } from './Vec2';
import { N, BALL_RADIUS, POCKET_RADIUS } from './constants';

export interface CushionLine {
  name: string;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2; // offset by ballRadius * normal
  p4: Vec2;
  p5: Vec2; // offset by 0.8 * ballRadius * normal
  p6: Vec2;
  direction: Vec2;
  normal: Vec2;
}

export interface Vertex {
  name: string;
  position: Vec2;
}

export interface Pocket {
  id: number;
  position: Vec2;
  dropPosition: Vec2;
}

export interface Table {
  lines: CushionLine[];
  vertices: Vertex[];
  pockets: Pocket[];
}

export function createStandard8BallTable(): Table {
  const n = N;
  const pr = POCKET_RADIUS;
  const br = BALL_RADIUS;

  const pockets: Pocket[] = [
    { id: 0, position: new Vec2(-50 * n - pr / 2, -25 * n - pr / 4), dropPosition: new Vec2(-51 * n - pr / 2, -26 * n - pr / 4) },
    { id: 1, position: new Vec2(0, -25 * n - pr), dropPosition: new Vec2(0, -25.5 * n - pr) },
    { id: 2, position: new Vec2(50 * n + pr / 2, -25 * n - pr / 4), dropPosition: new Vec2(51 * n + pr / 2, -26 * n - pr / 4) },
    { id: 3, position: new Vec2(-50 * n - pr / 2, 25 * n + pr / 4), dropPosition: new Vec2(-51 * n - pr / 2, 26 * n + pr / 4) },
    { id: 4, position: new Vec2(0, 25 * n + pr), dropPosition: new Vec2(0, 25.5 * n + pr) },
    { id: 5, position: new Vec2(50 * n + pr / 2, 25 * n + pr / 4), dropPosition: new Vec2(51 * n + pr / 2, 26 * n + pr / 4) },
  ];

  const rawLines: { name: string; p1: Vec2; p2: Vec2 }[] = [
    { name: 'AB', p1: new Vec2(-50 * n, -29 * n), p2: new Vec2(-46 * n, -25 * n) },
    { name: 'BC', p1: new Vec2(-46 * n, -25 * n), p2: new Vec2(-4 * n, -25 * n) },
    { name: 'CD', p1: new Vec2(-4 * n, -25 * n), p2: new Vec2(-2 * n, -29 * n) },
    { name: 'EF', p1: new Vec2(2 * n, -29 * n), p2: new Vec2(4 * n, -25 * n) },
    { name: 'FG', p1: new Vec2(4 * n, -25 * n), p2: new Vec2(46 * n, -25 * n) },
    { name: 'GH', p1: new Vec2(46 * n, -25 * n), p2: new Vec2(50 * n, -29 * n) },
    { name: 'IJ', p1: new Vec2(54 * n, -25 * n), p2: new Vec2(50 * n, -21 * n) },
    { name: 'JK', p1: new Vec2(50 * n, -21 * n), p2: new Vec2(50 * n, 21 * n) },
    { name: 'KL', p1: new Vec2(50 * n, 21 * n), p2: new Vec2(54 * n, 25 * n) },
    { name: 'MN', p1: new Vec2(50 * n, 29 * n), p2: new Vec2(46 * n, 25 * n) },
    { name: 'NO', p1: new Vec2(46 * n, 25 * n), p2: new Vec2(4 * n, 25 * n) },
    { name: 'OP', p1: new Vec2(4 * n, 25 * n), p2: new Vec2(2 * n, 29 * n) },
    { name: 'QR', p1: new Vec2(-2 * n, 29 * n), p2: new Vec2(-4 * n, 25 * n) },
    { name: 'RS', p1: new Vec2(-4 * n, 25 * n), p2: new Vec2(-46 * n, 25 * n) },
    { name: 'ST', p1: new Vec2(-46 * n, 25 * n), p2: new Vec2(-50 * n, 29 * n) },
    { name: 'UV', p1: new Vec2(-54 * n, 25 * n), p2: new Vec2(-50 * n, 21 * n) },
    { name: 'VW', p1: new Vec2(-50 * n, 21 * n), p2: new Vec2(-50 * n, -21 * n) },
    { name: 'WX', p1: new Vec2(-50 * n, -21 * n), p2: new Vec2(-54 * n, -25 * n) },
  ];

  const lines: CushionLine[] = rawLines.map((rl) => {
    const dir = rl.p2.minus(rl.p1).normalize();
    const normal = dir.leftNormal();
    const offset1 = normal.times(br);
    const offset2 = normal.times(0.8 * br);
    return {
      name: rl.name,
      p1: rl.p1,
      p2: rl.p2,
      direction: dir,
      normal,
      p3: rl.p1.plus(offset1),
      p4: rl.p2.plus(offset1),
      p5: rl.p1.plus(offset2),
      p6: rl.p2.plus(offset2),
    };
  });

  const vertices: Vertex[] = [
    { name: 'B', position: new Vec2(-46 * n, -25 * n) },
    { name: 'C', position: new Vec2(-4 * n, -25 * n) },
    { name: 'F', position: new Vec2(4 * n, -25 * n) },
    { name: 'G', position: new Vec2(46 * n, -25 * n) },
    { name: 'J', position: new Vec2(50 * n, -21 * n) },
    { name: 'K', position: new Vec2(50 * n, 21 * n) },
    { name: 'N', position: new Vec2(46 * n, 25 * n) },
    { name: 'O', position: new Vec2(4 * n, 25 * n) },
    { name: 'R', position: new Vec2(-4 * n, 25 * n) },
    { name: 'S', position: new Vec2(-46 * n, 25 * n) },
    { name: 'V', position: new Vec2(-50 * n, 21 * n) },
    { name: 'W', position: new Vec2(-50 * n, -21 * n) },
  ];

  return { lines, vertices, pockets };
}

/** Standard 8-ball rack positions (case 15 from levelData). Fixed offsets for determinism. */
export function standard8BallRack(): Vec2[] {
  const i = 15000 * 2.3; // 34500
  const e = 1.782;       // 1.732 + 0.05 (fixed)
  const s = 1.05;        // 1.0 + 0.05 (fixed)
  const br = BALL_RADIUS;

  const pos: Vec2[] = new Array(16);

  pos[0] = new Vec2(-i, 0);
  pos[1] = new Vec2(i, 0);
  pos[2] = new Vec2(i + e * br, br * s);
  pos[15] = new Vec2(i + e * br, -br * s);
  pos[8] = new Vec2(i + 2 * e * br, 0);
  pos[5] = new Vec2(i + 2 * e * br, 2 * br * s);
  pos[10] = new Vec2(i + 2 * e * br, -2 * br * s);
  pos[7] = new Vec2(i + 3 * e * br, 1 * br * s);
  pos[4] = new Vec2(i + 3 * e * br, 3 * br * s);
  pos[9] = new Vec2(i + 3 * e * br, -1 * br * s);
  pos[6] = new Vec2(i + 3 * e * br, -3 * br * s);
  pos[11] = new Vec2(i + 4 * e * br, 0);
  pos[12] = new Vec2(i + 4 * e * br, 2 * br * s);
  pos[13] = new Vec2(i + 4 * e * br, -2 * br * s);
  pos[14] = new Vec2(i + 4 * e * br, 4 * br * s);
  pos[3] = new Vec2(i + 4 * e * br, -4 * br * s);

  return pos;
}
