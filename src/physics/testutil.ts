/**
 * Helpers shared by the headless physics tests. Pure TypeScript.
 */
import { brushFromPoints, type Brush } from './brush';
import { makeMovementConfig, type MovementConfig } from './config';
import { MoveInput, PlayerController, PlayerState } from './movement';
import { CollisionWorld } from './world';
import { Vec3, type Vec3Like } from './vec3';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Sim {
  cfg: MovementConfig;
  world: CollisionWorld;
  pc: PlayerController;
  s: PlayerState;
  input: MoveInput;
}

export function makeSim(brushes: Brush[], overrides: Partial<MovementConfig> = {}): Sim {
  const cfg = makeMovementConfig(overrides);
  const world = new CollisionWorld(brushes, cfg.distEpsilon);
  const pc = new PlayerController(world, cfg);
  return { cfg, world, pc, s: new PlayerState(), input: new MoveInput() };
}

/**
 * Y coordinate that puts the hull at (x, z) exactly `gap` units outside the
 * plane `n . p = d` (measured along n, using the hull's support corner).
 */
export function yOnPlane(n: Vec3Like, d: number, x: number, z: number, gap: number, mins: Vec3Like, maxs: Vec3Like): number {
  const cx = n.x < 0 ? maxs.x : mins.x;
  const cy = n.y < 0 ? maxs.y : mins.y;
  const cz = n.z < 0 ? maxs.z : mins.z;
  return (d + gap - n.x * (x + cx) - n.z * (z + cz)) / n.y - cy;
}

/** Signed distance of the hull at `pos` from the plane (support corner). */
export function hullPlaneGap(n: Vec3Like, d: number, pos: Vec3Like, mins: Vec3Like, maxs: Vec3Like): number {
  const cx = n.x < 0 ? maxs.x : mins.x;
  const cy = n.y < 0 ? maxs.y : mins.y;
  const cz = n.z < 0 ? maxs.z : mins.z;
  return n.x * (pos.x + cx) + n.y * (pos.y + cy) + n.z * (pos.z + cz) - d;
}

/** Finds the face of a brush whose normal best matches `dir`. */
export function faceToward(b: Brush, dir: Vec3Like): { normal: Vec3; dist: number } {
  let best = b.faces[0];
  let bestDot = -Infinity;
  for (const f of b.faces) {
    const d = f.normal.x * dir.x + f.normal.y * dir.y + f.normal.z * dir.z;
    if (d > bestDot) {
      bestDot = d;
      best = f;
    }
  }
  return { normal: best.normal, dist: best.dist };
}

export { brushFromPoints };
