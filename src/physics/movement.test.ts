import { describe, expect, it } from 'vitest';
import { boxBrush, brushFromPoints, type Brush } from './brush';
import { aFramePoints } from './shapes';
import { faceToward, hullPlaneGap, makeSim, rng, yOnPlane } from './testutil';
import { Vec3 } from './vec3';

const DEG = Math.PI / 180;
const TAN60 = Math.tan(60 * DEG);

describe('air strafing', () => {
  it('gains speed holding D while yawing right at 120 deg/s, and never loses any', () => {
    const { pc, s, input } = makeSim([], { gravity: 0 });
    pc.teleport(s, 0, 0, 0);
    input.yaw = 0;
    s.vel.set(0, 0, -250); // 250 u/s straight ahead (yaw 0 looks down -Z)
    input.side = 1; // D
    const yawRate = (120 * DEG) / 64;
    let prev = s.vel.horizontalLength();
    const start = prev;
    for (let t = 0; t < 2 * 64; t++) {
      input.yaw -= yawRate; // turning right decreases yaw
      pc.tick(s, input);
      const hs = s.vel.horizontalLength();
      expect(s.onGround).toBe(false);
      expect(hs).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = hs;
    }
    expect(prev).toBeGreaterThan(start + 25);
  });

  it('gains nothing holding W alone', () => {
    const { pc, s, input } = makeSim([], { gravity: 0 });
    pc.teleport(s, 0, 0, 0);
    input.yaw = 0;
    s.vel.set(0, 0, -250);
    input.forward = 1;
    for (let t = 0; t < 2 * 64; t++) {
      pc.tick(s, input);
      expect(s.vel.horizontalLength()).toBeCloseTo(250, 9);
    }
  });

  it('caps the added speed toward wishdir at 30 but accelerates with the full 250', () => {
    const { pc, s, input } = makeSim([], { gravity: 0 });
    pc.teleport(s, 0, 0, 0);
    s.vel.set(0, 0, 0);
    input.side = 1;
    pc.tick(s, input);
    // From rest, one tick adds min(150 * 250 / 64, 30) = 30 toward +X.
    expect(s.vel.x).toBeCloseTo(30, 9);
  });
});

/** Symmetric A-frame with exact 60-degree faces whose ridge runs along Z. */
function ramp60(height: number, length: number): { brush: Brush; halfWidth: number } {
  const halfWidth = height / TAN60;
  const brush = brushFromPoints(aFramePoints({ x: 0, y: height, z: length / 2 }, { x: 0, y: height, z: -length / 2 }, height, halfWidth));
  return { brush, halfWidth };
}

describe('sliding on a 60-degree ramp', () => {
  it('is never grounded and converts height to speed (energy within 2%)', () => {
    const h = 448;
    const { brush, halfWidth } = ramp60(h, 4000);
    const face = faceToward(brush, { x: 1, y: 0.2, z: 0 }); // the right (+X) face
    expect(face.normal.y).toBeCloseTo(0.5, 9);

    const { pc, s, input, cfg } = makeSim([brush]);
    const x0 = cfg.hullHalfWidth + 2; // inner corner 2 units right of the ridge line
    pc.teleport(s, x0, yOnPlane(face.normal, face.dist, x0, 0, cfg.distEpsilon, pc.standMins, pc.standMaxs), 0);
    const y0 = s.pos.y;
    let ticks = 0;
    let touchedTicks = 0;
    while (s.pos.x - cfg.hullHalfWidth < halfWidth - 4) {
      pc.tick(s, input);
      ticks++;
      if (s.touched) touchedTicks++;
      expect(s.onGround).toBe(false);
      expect(ticks).toBeLessThan(64 * 10);
    }
    const heightLost = y0 - s.pos.y;
    const gained = s.vel.lengthSq();
    const expected = 2 * cfg.gravity * heightLost;
    expect(heightLost).toBeGreaterThan(400);
    expect(touchedTicks).toBeGreaterThanOrEqual(ticks - 1);
    expect(Math.abs(gained - expected) / expected).toBeLessThan(0.02);
  });

  it('conserves energy on a long, rotated, descending ramp too', () => {
    const h = 448;
    const halfWidth = h / TAN60;
    const yaw = 0.7;
    const dir = new Vec3(-Math.sin(yaw), -0.08, -Math.cos(yaw));
    const a = new Vec3(1000, 3000, -500);
    const b = new Vec3(a.x + dir.x * 8000, a.y + dir.y * 8000, a.z + dir.z * 8000);
    const brush = brushFromPoints(aFramePoints(a, b, h, halfWidth));
    // Right face: normal points to the right of the ridge direction and up.
    const right = new Vec3(Math.cos(yaw), 0, -Math.sin(yaw));
    const face = faceToward(brush, { x: right.x, y: 0.6, z: right.z });
    const { pc, s, input } = makeSim([brush]);
    const along = 1000;
    const px = a.x + dir.x * along + right.x * 40;
    const pz = a.z + dir.z * along + right.z * 40;
    pc.teleport(s, px, yOnPlane(face.normal, face.dist, px, pz, 0.25, pc.standMins, pc.standMaxs), pz);
    const y0 = s.pos.y;
    for (let t = 0; t < 64; t++) {
      pc.tick(s, input);
      expect(s.onGround).toBe(false);
    }
    const expected = 2 * 800 * (y0 - s.pos.y);
    expect(Math.abs(s.vel.lengthSq() - expected) / expected).toBeLessThan(0.02);
  });
});

describe('surfing', () => {
  it('holds a ramp for 5 s at 800 u/s strafing into it, never grounded, not sinking, keeping speed', () => {
    const h = 448;
    const { brush, halfWidth } = ramp60(h, 12000);
    const face = faceToward(brush, { x: 1, y: 0.2, z: 0 });
    const { pc, s, input, cfg } = makeSim([brush]);
    // Mid-face: hull's inner corner halfway down the face.
    const x0 = cfg.hullHalfWidth + halfWidth / 2;
    pc.teleport(s, x0, yOnPlane(face.normal, face.dist, x0, 5000, cfg.distEpsilon, pc.standMins, pc.standMaxs), 5000);
    s.vel.set(0, 0, -800); // along the ramp
    input.yaw = 0; // view parallel to the ramp
    input.side = -1; // A: strafe into the ramp (the +X face's ramp body is to the left)
    const y0 = s.pos.y;
    for (let t = 0; t < 5 * 64; t++) {
      pc.tick(s, input);
      expect(s.onGround).toBe(false);
      expect(s.touched).toBe(true);
      const gap = hullPlaneGap(face.normal, face.dist, s.pos, pc.standMins, pc.standMaxs);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThan(1);
      expect(s.pos.y).toBeGreaterThan(y0 - 0.5);
      expect(Math.abs(-s.vel.z - 800) / 800).toBeLessThan(0.01);
    }
  });
});

describe('ramp seams', () => {
  it('1000 seam crossings at 500-3000 u/s never lose more than 1% speed in a tick', () => {
    const random = rng(1337);
    const cfg = { h: 448, w: 256 };
    let crossings = 0;
    let episodes = 0;
    let worstLoss = 0;
    while (crossings < 1000) {
      episodes++;
      expect(episodes).toBeLessThan(400);
      const yaw = random() * Math.PI * 2;
      const descent = random() * 6 * DEG;
      const speed = 500 + random() * 2500;
      const hold = random() < 0.6;
      const dirH = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new Vec3(Math.cos(yaw), 0, -Math.sin(yaw));
      const slope = Math.tan(descent);
      const origin = new Vec3((random() - 0.5) * 20000, 4000 + random() * 4000, (random() - 0.5) * 20000);
      const along = (t: number) => new Vec3(origin.x + dirH.x * t, origin.y - slope * t, origin.z + dirH.z * t);
      // Split the ramp into brushes at irregular positions. Half the episodes
      // also shift each brush by up to 0.002 units, like misaligned Hammer
      // brushes, so neighbouring faces are not exactly coplanar.
      const jitter = random() < 0.5 ? 0.002 : 0;
      const seams: number[] = [];
      const total = speed * 2.5 + 1200;
      const brushes: Brush[] = [];
      let t0 = 0;
      while (t0 < total) {
        const len = 40 + random() * 360;
        const t1 = t0 + len;
        const jx = (random() * 2 - 1) * jitter, jy = (random() * 2 - 1) * jitter, jz = (random() * 2 - 1) * jitter;
        const pts = aFramePoints(along(t0), along(t1), cfg.h, cfg.w).map((p) => new Vec3(p.x + jx, p.y + jy, p.z + jz));
        brushes.push(brushFromPoints(pts));
        seams.push(t1);
        t0 = t1;
      }
      const sim = makeSim(brushes);
      const { pc, s, input } = sim;
      const face = faceToward(brushes[0], { x: right.x, y: 0.6, z: right.z });
      // Keep clear of the ridge: holding into the ramp slowly climbs, and the
      // flat ridge top is (correctly) ground.
      const lateral = 56 + random() * 160;
      const startT = 300;
      const px = origin.x + dirH.x * startT + right.x * lateral;
      const pz = origin.z + dirH.z * startT + right.z * lateral;
      pc.teleport(s, px, yOnPlane(face.normal, face.dist, px, pz, sim.cfg.distEpsilon, pc.standMins, pc.standMaxs), pz);
      // Already riding the face (as mid-run), so contact history is set.
      s.touched = true;
      s.lastHitNormal.copy(face.normal);
      // Velocity along the (possibly descending) ramp axis plus a little cross-slope motion.
      const axis = new Vec3(dirH.x, -slope, dirH.z);
      axis.normalize();
      const downSlope = new Vec3();
      downSlope.set(face.normal.x * face.normal.y, face.normal.y * face.normal.y - 1, face.normal.z * face.normal.y).normalize();
      const cross = (random() - 0.5) * 80;
      s.vel.set(axis.x * speed + downSlope.x * cross, axis.y * speed + downSlope.y * cross, axis.z * speed + downSlope.z * cross);
      input.clear();
      input.yaw = yaw;
      input.side = hold ? -1 : 0;
      let lastProj = (s.pos.x - origin.x) * dirH.x + (s.pos.z - origin.z) * dirH.z;
      let seamIdx = seams.findIndex((x) => x > lastProj);
      for (let tick = 0; tick < 64 * 2; tick++) {
        const before = s.vel.length();
        pc.tick(s, input);
        const after = s.vel.length();
        expect(s.onGround).toBe(false);
        const loss = (before - after) / before;
        worstLoss = Math.max(worstLoss, loss);
        expect(loss).toBeLessThan(0.01);
        const proj = (s.pos.x - origin.x) * dirH.x + (s.pos.z - origin.z) * dirH.z;
        const gap = hullPlaneGap(face.normal, face.dist, s.pos, pc.standMins, pc.standMaxs);
        const onFace = gap < 2 && gap > -0.01;
        while (seamIdx >= 0 && seamIdx < seams.length && proj > seams[seamIdx]) {
          if (onFace) crossings++;
          seamIdx++;
        }
        lastProj = proj;
        if (!onFace || seamIdx >= seams.length - 2) break;
      }
    }
    expect(crossings).toBeGreaterThanOrEqual(1000);
    expect(worstLoss).toBeLessThan(0.01);
  });
});

describe('bunny hopping', () => {
  it('holding jump across flat ground at 600 u/s loses no horizontal speed', () => {
    const floor = boxBrush({ x: -20000, y: -64, z: -20000 }, { x: 20000, y: 0, z: 20000 });
    const { pc, s, input } = makeSim([floor]);
    pc.teleport(s, 0, 0.5, 15000);
    expect(s.onGround).toBe(true);
    s.vel.set(0, 0, -600);
    input.jump = true;
    let jumps = 0;
    let landings = 0;
    for (let t = 0; t < 5 * 64; t++) {
      pc.tick(s, input);
      if (s.jumped) jumps++;
      if (s.landed) landings++;
      expect(s.vel.horizontalLength()).toBeGreaterThanOrEqual(600 - 1e-9);
    }
    expect(jumps).toBeGreaterThanOrEqual(6);
    expect(landings).toBeGreaterThanOrEqual(5);
    expect(s.vel.horizontalLength()).toBeCloseTo(600, 9);
  });

  it('friction does slow a grounded player who is not jumping', () => {
    const floor = boxBrush({ x: -20000, y: -64, z: -20000 }, { x: 20000, y: 0, z: 20000 });
    const { pc, s, input } = makeSim([floor]);
    pc.teleport(s, 0, 0.5, 0);
    s.vel.set(0, 0, -600);
    pc.tick(s, input);
    expect(s.vel.horizontalLength()).toBeCloseTo(600 * (1 - 5.2 / 64), 6);
  });
});

describe('velocity cap', () => {
  it('clamps each axis to sv_maxvelocity (10,000), far above CS2\'s 3500', () => {
    const { pc, s, input, cfg } = makeSim([], { gravity: 0 });
    expect(cfg.maxVelocity).toBe(10000);
    pc.teleport(s, 0, 0, 0);
    s.vel.set(9000, 0, -9000);
    pc.tick(s, input);
    // Under the cap on both axes: untouched, 12,728 u/s horizontally.
    expect(s.vel.x).toBe(9000);
    expect(s.vel.z).toBe(-9000);
    s.vel.set(14000, -12000, -10500);
    pc.tick(s, input);
    expect(s.vel.x).toBe(10000);
    expect(s.vel.y).toBe(-10000);
    expect(s.vel.z).toBe(-10000);
  });
});
