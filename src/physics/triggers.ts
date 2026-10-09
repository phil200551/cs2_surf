import type { Brush } from './brush';
import type { Vec3Like } from './vec3';

/**
 * Trigger volumes are non-solid brushes. These helpers test a player hull
 * against one using the same plane-offset (Minkowski) logic as the solid
 * trace, without any epsilon. They run every tick for every trigger, so the
 * plane distance is computed inline (no helper returning a double, which V8
 * would box when not inlined).
 */

/** True when the hull at `pos` overlaps the brush. */
export function hullOverlapsBrush(brush: Brush, pos: Readonly<Vec3Like>, mins: Readonly<Vec3Like>, maxs: Readonly<Vec3Like>): boolean {
  const pl = brush.planes;
  for (let i = 0, o = 0; i < brush.numPlanes; i++, o += 4) {
    const nx = pl[o], ny = pl[o + 1], nz = pl[o + 2];
    const ofs = nx * (nx < 0 ? maxs.x : mins.x) + ny * (ny < 0 ? maxs.y : mins.y) + nz * (nz < 0 ? maxs.z : mins.z);
    if (pos.x * nx + pos.y * ny + pos.z * nz - (pl[o + 3] - ofs) > 0) return false;
  }
  return true;
}

/**
 * Fraction (0..1) along `start -> end` at which the hull first overlaps the
 * brush, 0 if it already overlaps at `start`, or -1 if it never does.
 * Swap the arguments and use `1 - f` to get the time a hull leaves.
 */
export function sweepEnterFraction(brush: Brush, start: Readonly<Vec3Like>, end: Readonly<Vec3Like>, mins: Readonly<Vec3Like>, maxs: Readonly<Vec3Like>): number {
  const pl = brush.planes;
  let enter = 0;
  let leave = 1;
  for (let i = 0, o = 0; i < brush.numPlanes; i++, o += 4) {
    const nx = pl[o], ny = pl[o + 1], nz = pl[o + 2];
    const dist = pl[o + 3] - (nx * (nx < 0 ? maxs.x : mins.x) + ny * (ny < 0 ? maxs.y : mins.y) + nz * (nz < 0 ? maxs.z : mins.z));
    const d1 = start.x * nx + start.y * ny + start.z * nz - dist;
    const d2 = end.x * nx + end.y * ny + end.z * nz - dist;
    if (d1 > 0 && d2 > 0) return -1;
    if (d1 <= 0 && d2 <= 0) continue;
    const t = d1 / (d1 - d2);
    if (d1 > 0) {
      if (t > enter) enter = t;
    } else if (t < leave) {
      leave = t;
    }
  }
  return enter <= leave ? enter : -1;
}
