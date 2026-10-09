/**
 * Extra seam stress beyond the spec'd 1,000 crossings: several seeds,
 * misaligned brushes (Hammer-style 0.004 unit offsets), and curved ramps made
 * of rotated segments where the joints are not coplanar.
 */
import { describe, expect, it } from 'vitest';
import { brushFromPoints, type Brush } from './brush';
import { aFramePoints, aFrameSection } from './shapes';
import { faceToward, hullPlaneGap, makeSim, rng, yOnPlane } from './testutil';
import { Vec3 } from './vec3';

const DEG = Math.PI / 180;

describe('seam stress', () => {
  it('straight split ramps: many seeds, misaligned brushes, no tick loses 1%', () => {
    let worst = 0;
    let crossings = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const random = rng(seed * 7919);
      let episodeCrossings = 0;
      while (episodeCrossings < 1500) {
        const yaw = random() * Math.PI * 2;
        const slope = Math.tan(random() * 6 * DEG);
        const speed = 500 + random() * 2500;
        const hold = random() < 0.6;
        const dirH = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const right = new Vec3(Math.cos(yaw), 0, -Math.sin(yaw));
        const origin = new Vec3((random() - 0.5) * 40000, 4000 + random() * 8000, (random() - 0.5) * 40000);
        const along = (t: number) => new Vec3(origin.x + dirH.x * t, origin.y - slope * t, origin.z + dirH.z * t);
        const jitter = random() < 0.5 ? 0.004 : 0;
        const seams: number[] = [];
        const brushes: Brush[] = [];
        for (let t0 = 0; t0 < speed * 2.5 + 1200; ) {
          const t1 = t0 + 20 + random() * 300;
          const j = () => (random() * 2 - 1) * jitter;
          const jx = j(), jy = j(), jz = j();
          brushes.push(brushFromPoints(aFramePoints(along(t0), along(t1), 448, 256).map((p) => new Vec3(p.x + jx, p.y + jy, p.z + jz))));
          seams.push(t1);
          t0 = t1;
        }
        const sim = makeSim(brushes);
        const { pc, s, input } = sim;
        const face = faceToward(brushes[0], { x: right.x, y: 0.6, z: right.z });
        const lateral = 56 + random() * 160;
        const startT = 300;
        const px = origin.x + dirH.x * startT + right.x * lateral;
        const pz = origin.z + dirH.z * startT + right.z * lateral;
        pc.teleport(s, px, yOnPlane(face.normal, face.dist, px, pz, sim.cfg.distEpsilon, pc.standMins, pc.standMaxs), pz);
        s.touched = true;
        s.lastHitNormal.copy(face.normal);
        const axis = new Vec3(dirH.x, -slope, dirH.z);
        axis.normalize();
        s.vel.copy(axis).scale(speed);
        input.clear();
        input.yaw = yaw;
        input.side = hold ? -1 : 0;
        let idx = seams.findIndex((x) => x > startT);
        for (let tick = 0; tick < 160; tick++) {
          const before = s.vel.length();
          pc.tick(s, input);
          const loss = (before - s.vel.length()) / before;
          worst = Math.max(worst, loss);
          const proj = (s.pos.x - origin.x) * dirH.x + (s.pos.z - origin.z) * dirH.z;
          const gap = hullPlaneGap(face.normal, face.dist, s.pos, pc.standMins, pc.standMaxs);
          const onFace = gap < 2 && gap > -0.02;
          while (idx >= 0 && idx < seams.length && proj > seams[idx]) {
            if (onFace) episodeCrossings++;
            idx++;
          }
          if (!onFace || idx >= seams.length - 2 || s.onGround) break;
        }
      }
      crossings += episodeCrossings;
    }
    expect(crossings).toBeGreaterThanOrEqual(6000);
    expect(worst).toBeLessThan(0.01);
  });

  it('curved ramps: joint losses never exceed the geometric cost of the turn', () => {
    const random = rng(42);
    let joints = 0;
    let worst = 0;
    for (let ep = 0; ep < 120; ep++) {
      const segAngle = (2 + random() * 6) * DEG * (random() < 0.5 ? 1 : -1);
      const segLen = 150 + random() * 400;
      const n = 30;
      const pts: { p: Vec3; h: number }[] = [];
      let p = new Vec3(random() * 1000, 5000 + random() * 3000, random() * 1000);
      let h = random() * Math.PI * 2;
      pts.push({ p: p.clone(), h });
      for (let i = 0; i < n; i++) {
        const mid = h + segAngle / 2;
        p = new Vec3(p.x - Math.sin(mid) * segLen, p.y, p.z - Math.cos(mid) * segLen);
        h += segAngle;
        pts.push({ p: p.clone(), h });
      }
      // Each segment's end sections are perpendicular to the bisector at the joint.
      const brushes: Brush[] = [];
      for (let i = 0; i < n; i++) brushes.push(brushFromPoints([...aFrameSection(pts[i].p, pts[i].h, 448, 256), ...aFrameSection(pts[i + 1].p, pts[i + 1].h, 448, 256)]));
      const sim = makeSim(brushes);
      const { pc, s, input } = sim;
      const side = random() < 0.5 ? 1 : -1;
      const h0 = pts[1].h + segAngle / 2;
      const dir = new Vec3(-Math.sin(h0), 0, -Math.cos(h0));
      const right = new Vec3(Math.cos(h0), 0, -Math.sin(h0));
      const face = faceToward(brushes[1], { x: right.x * side, y: 0.6, z: right.z * side });
      const lateral = 60 + random() * 150;
      const px = pts[1].p.x + dir.x * 40 + right.x * side * lateral;
      const pz = pts[1].p.z + dir.z * 40 + right.z * side * lateral;
      pc.teleport(s, px, yOnPlane(face.normal, face.dist, px, pz, sim.cfg.distEpsilon, pc.standMins, pc.standMaxs), pz);
      s.touched = true;
      s.lastHitNormal.copy(face.normal);
      const speed = 600 + random() * 2400;
      s.vel.set(dir.x * speed, 0, dir.z * speed);
      input.clear();
      input.side = -side;
      let prevSeg = 1;
      for (let tick = 0; tick < 200; tick++) {
        let best = 0;
        let bd = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const d = Math.hypot(pts[i].p.x - s.pos.x, pts[i].p.z - s.pos.z);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        const seg = Math.min(best, n - 1);
        const hh = pts[seg].h + segAngle / 2;
        const lat = (s.pos.x - pts[seg].p.x) * Math.cos(hh) - (s.pos.z - pts[seg].p.z) * Math.sin(hh);
        // Stop before riding over the ridge: hitting the other face is a real collision.
        if (lat * side < 40 || pts[seg].p.y - s.pos.y < 60 || best >= n - 2) break;
        input.yaw = Math.atan2(-s.vel.x, -s.vel.z); // strafe perpendicular to velocity
        const y0 = s.pos.y;
        const before = s.vel.length();
        pc.tick(s, input);
        if (s.onGround) break;
        // Energy-equivalent loss: speed implied by the height change vs actual.
        const implied = Math.sqrt(Math.max(0, before * before + 2 * 800 * (y0 - s.pos.y)));
        worst = Math.max(worst, (implied - s.vel.length()) / before);
        if (best !== prevSeg) {
          joints++;
          prevSeg = best;
        }
      }
    }
    expect(joints).toBeGreaterThan(500);
    // An 8 degree joint on a 60 degree face costs about (sin 60 * sin 8)^2 / 2 = 0.73%.
    expect(worst).toBeLessThan(0.0125);
  });
});
