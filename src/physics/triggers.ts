import type { Brush } from './brush';
import type { Vec3Like } from './vec3';

/**
 * Trigger volumes are non-solid brushes. These helpers test a player hull
 * against one using the same plane-offset (Minkowski) logic as the solid
 * trace, without any epsilon.
 */

function planeDistance(brush: Brush, i: number, p: Readonly<Vec3Like>, mins: Readonly<Vec3Like>, maxs: Readonly<Vec3Like>): number {
  const pl = brush.planes;
  const o = i * 4;
  const nx = pl[o], ny = pl[o + 1], nz = pl[o + 2];
  const ofs = nx * (nx < 0 ? maxs.x : mins.x) + ny * (ny < 0 ? maxs.y : mins.y) + nz * (nz < 0 ? maxs.z : mins.z);
  return p.x * nx + p.y * ny + p.z * nz - (pl[o + 3] - ofs);
}

/** True when the hull at `pos` overlaps the brush. */
export function hullOverlapsBrush(brush: Brush, pos: Readonly<Vec3Like>, mins: Readonly<Vec3Like>, maxs: Readonly<Vec3Like>): boolean {
  for (let i = 0; i < brush.numPlanes; i++) {
    if (planeDistance(brush, i, pos, mins, maxs) > 0) return false;
  }
  return true;
}

/**
 * Fraction (0..1) along `start -> end` at which the hull first overlaps the
 * brush, 0 if it already overlaps at `start`, or -1 if it never does.
 * Swap the arguments and use `1 - f` to get the time a hull leaves.
 */
export function sweepEnterFraction(brush: Brush, start: Readonly<Vec3Like>, end: Readonly<Vec3Like>, mins: Readonly<Vec3Like>, maxs: Readonly<Vec3Like>): number {
  let enter = 0;
  let leave = 1;
  for (let i = 0; i < brush.numPlanes; i++) {
    const d1 = planeDistance(brush, i, start, mins, maxs);
    const d2 = planeDistance(brush, i, end, mins, maxs);
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
