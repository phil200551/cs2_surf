import { describe, expect, it } from 'vitest';
import { boxBrush, brushFromPoints } from './brush';
import { aFramePoints, boxPoints } from './shapes';
import { hullOverlapsBrush, sweepEnterFraction } from './triggers';
import { CollisionWorld, TraceResult } from './world';
import { Vec3 } from './vec3';
import { makeSim } from './testutil';

const mins = new Vec3(-16, 0, -16);
const maxs = new Vec3(16, 72, 16);

describe('brushFromPoints', () => {
  it('builds a box with 6 faces and no extra bevels', () => {
    const b = boxBrush({ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 });
    expect(b.numFaces).toBe(6);
    expect(b.numPlanes).toBe(6);
    for (const f of b.faces) expect(f.vertices.length).toBe(4);
  });

  it('builds an A-frame with 5 faces plus a top bevel', () => {
    const b = brushFromPoints(aFramePoints({ x: 0, y: 448, z: 0 }, { x: 0, y: 448, z: -1000 }, 448, 256));
    expect(b.numFaces).toBe(5);
    // Top axial bevel at the ridge plus the vertical bevels along the base edges.
    const hasTop = Array.from({ length: b.numPlanes }, (_, i) => b.planes[i * 4 + 1]).some((ny) => ny > 0.999999);
    expect(hasTop).toBe(true);
  });

  it('winds face vertices counter-clockwise around the outward normal', () => {
    const b = brushFromPoints(aFramePoints({ x: 5, y: 448, z: 3 }, { x: 900, y: 300, z: -1000 }, 448, 256));
    for (const f of b.faces) {
      const [a, c, d] = f.vertices;
      const e1 = new Vec3(c.x - a.x, c.y - a.y, c.z - a.z);
      const e2 = new Vec3(d.x - a.x, d.y - a.y, d.z - a.z);
      const n = new Vec3(e1.y * e2.z - e1.z * e2.y, e1.z * e2.x - e1.x * e2.z, e1.x * e2.y - e1.y * e2.x);
      expect(n.dot(f.normal)).toBeGreaterThan(0);
    }
  });
});

describe('traceBox', () => {
  const floor = boxBrush({ x: -1000, y: -64, z: -1000 }, { x: 1000, y: 0, z: 1000 });
  const world = new CollisionWorld([floor]);
  const tr = new TraceResult();

  it('stops a falling hull epsilon above the floor', () => {
    world.traceBox({ x: 0, y: 100, z: 0 }, { x: 0, y: -100, z: 0 }, mins, maxs, tr);
    expect(tr.hit).toBe(true);
    expect(tr.normal.y).toBe(1);
    expect(tr.endPos.y).toBeCloseTo(0.03125, 9);
    expect(tr.startSolid).toBe(false);
  });

  it('reports startSolid / allSolid inside a brush', () => {
    world.traceBox({ x: 0, y: -10, z: 0 }, { x: 5, y: -10, z: 0 }, mins, maxs, tr);
    expect(tr.startSolid).toBe(true);
    expect(tr.allSolid).toBe(true);
    expect(tr.fraction).toBe(0);
  });

  it('ignores a brush it leaves when starting inside', () => {
    world.traceBox({ x: 0, y: -10, z: 0 }, { x: 0, y: 200, z: 0 }, mins, maxs, tr);
    expect(tr.startSolid).toBe(true);
    expect(tr.allSolid).toBe(false);
    expect(tr.fraction).toBe(1);
  });

  it('does not block a hull sliding parallel at epsilon', () => {
    world.traceBox({ x: 0, y: 0.03125, z: 0 }, { x: 500, y: 0.03125, z: 0 }, mins, maxs, tr);
    expect(tr.hit).toBe(false);
  });

  it('slides across a seam between two coplanar boxes', () => {
    const a = boxBrush({ x: -1000, y: -64, z: -100 }, { x: 0, y: 0, z: 100 });
    const b = boxBrush({ x: 0, y: -64, z: -100 }, { x: 1000, y: 0, z: 100 });
    const w = new CollisionWorld([a, b]);
    w.traceBox({ x: -300, y: 0.03125, z: 0 }, { x: 300, y: 0.03125, z: 0 }, mins, maxs, tr);
    expect(tr.hit).toBe(false);
  });

  it('lets the hull rest on the flat top of an A-frame ridge (axial bevel)', () => {
    const r = brushFromPoints(aFramePoints({ x: 0, y: 448, z: 500 }, { x: 0, y: 448, z: -500 }, 448, 256));
    const w = new CollisionWorld([r]);
    w.traceBox({ x: 10, y: 600, z: 0 }, { x: 10, y: 300, z: 0 }, mins, maxs, tr);
    expect(tr.hit).toBe(true);
    expect(tr.normal.y).toBeCloseTo(1, 9);
    expect(tr.endPos.y).toBeCloseTo(448.03125, 6);
  });

  it('hits the sloped face (not the ridge) when off the ridge', () => {
    const r = brushFromPoints(aFramePoints({ x: 0, y: 448, z: 500 }, { x: 0, y: 448, z: -500 }, 448, 256));
    const w = new CollisionWorld([r]);
    w.traceBox({ x: 120, y: 600, z: 0 }, { x: 120, y: 0, z: 0 }, mins, maxs, tr);
    expect(tr.hit).toBe(true);
    expect(tr.normal.y).toBeLessThan(0.7);
    expect(tr.normal.x).toBeGreaterThan(0.8);
  });

  it('broadphase finds the right brush among many', () => {
    const brushes = [];
    for (let i = 0; i < 200; i++) brushes.push(boxBrush({ x: i * 100, y: 0, z: 0 }, { x: i * 100 + 50, y: 50, z: 50 }));
    const w = new CollisionWorld(brushes);
    w.traceBox({ x: 13 * 100 + 25, y: 500, z: 25 }, { x: 13 * 100 + 25, y: -500, z: 25 }, mins, maxs, tr);
    expect(tr.brush).toBe(13);
    expect(tr.endPos.y).toBeCloseTo(50.03125, 9);
  });
});

describe('triggers', () => {
  const zone = brushFromPoints(boxPoints({ x: 0, y: 0, z: 0 }, { x: 100, y: 100, z: 100 }));

  it('detects overlap with the hull', () => {
    expect(hullOverlapsBrush(zone, { x: 50, y: 50, z: 50 }, mins, maxs)).toBe(true);
    expect(hullOverlapsBrush(zone, { x: 115, y: 50, z: 50 }, mins, maxs)).toBe(true);
    expect(hullOverlapsBrush(zone, { x: 117, y: 50, z: 50 }, mins, maxs)).toBe(false);
  });

  it('computes sub-tick entry and exit fractions', () => {
    // Hull's right side reaches x = 0 when the origin is at -16.
    const f = sweepEnterFraction(zone, { x: -66, y: 50, z: 50 }, { x: 34, y: 50, z: 50 }, mins, maxs);
    expect(f).toBeCloseTo(0.5, 9);
    const leave = 1 - sweepEnterFraction(zone, { x: 166, y: 50, z: 50 }, { x: 66, y: 50, z: 50 }, mins, maxs);
    expect(leave).toBeCloseTo(0.5, 9);
    expect(sweepEnterFraction(zone, { x: -300, y: 500, z: 50 }, { x: 300, y: 500, z: 50 }, mins, maxs)).toBe(-1);
  });
});

describe('ducking and stepping', () => {
  it('walks up an 18-unit step but not a 19-unit one', () => {
    for (const [height, expectUp] of [[18, true], [19, false]] as const) {
      const floor = boxBrush({ x: -1000, y: -64, z: -1000 }, { x: 1000, y: 0, z: 1000 });
      const step = boxBrush({ x: -1000, y: 0, z: -1000 }, { x: 1000, y: height, z: -100 });
      const { pc, s, input } = makeSim([floor, step]);
      pc.teleport(s, 0, 0.5, 0);
      input.forward = 1;
      for (let t = 0; t < 64; t++) pc.tick(s, input);
      if (expectUp) {
        expect(s.pos.z).toBeLessThan(-150);
        expect(s.pos.y).toBeCloseTo(height + 0.03125, 3);
      } else {
        expect(s.pos.z).toBeGreaterThan(-100);
      }
    }
  });

  it('tucks the feet up when ducking in the air and keeps the eye in place', () => {
    const { pc, s, input } = makeSim([], { gravity: 0 });
    pc.teleport(s, 0, 1000, 0);
    const eye = s.pos.y + s.eyeOffset;
    input.duck = true;
    pc.tick(s, input);
    expect(s.ducked).toBe(true);
    expect(s.pos.y + s.eyeOffset).toBeCloseTo(eye, 9);
    input.duck = false;
    pc.tick(s, input);
    expect(s.ducked).toBe(false);
    expect(s.pos.y + s.eyeOffset).toBeCloseTo(eye, 9);
  });

  it('jumps about 59 units high (impulse set after the first half of gravity, as specified)', () => {
    const floor = boxBrush({ x: -1000, y: -64, z: -1000 }, { x: 1000, y: 0, z: 1000 });
    const { pc, s, input } = makeSim([floor]);
    pc.teleport(s, 0, 0.5, 0);
    input.jump = true;
    pc.tick(s, input);
    input.jump = false;
    let top = 0;
    for (let t = 0; t < 64; t++) {
      pc.tick(s, input);
      top = Math.max(top, s.pos.y);
    }
    // pos.y starts 0.5 above the floor; sum of (301.993 - 12.5k) / 64 = 59.37.
    expect(top - 0.5).toBeCloseTo(59.37, 1);
  });
});
