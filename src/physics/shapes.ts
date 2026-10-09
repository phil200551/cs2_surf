import { Vec3, type Vec3Like } from './vec3';

/** The 8 corners of an axis-aligned box. */
export function boxPoints(min: Vec3Like, max: Vec3Like): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) out.push(new Vec3(x, y, z));
  return out;
}

/** Horizontal unit vector pointing to the right of the horizontal direction (dx, dz). */
export function rightOf(dx: number, dz: number): Vec3 {
  const len = Math.hypot(dx, dz);
  // right = dir x up = (-dz, 0, dx)
  return new Vec3(-dz / len, 0, dx / len);
}

/**
 * Triangular-prism "A-frame" ramp. `start` and `end` are the two ends of the
 * ridge line; the cross-section is perpendicular to the ridge's horizontal
 * direction, `2 * halfWidth` wide at the base and `height` tall. A sloped
 * ridge makes a descending ramp.
 *
 * `leftHalfWidth`/`rightHalfWidth` allow asymmetric prisms (a one-sided wedge
 * uses 0 on one side).
 */
export function aFramePoints(start: Vec3Like, end: Vec3Like, height: number, leftHalfWidth: number, rightHalfWidth = leftHalfWidth): Vec3[] {
  const r = rightOf(end.x - start.x, end.z - start.z);
  const out: Vec3[] = [];
  for (const p of [start, end]) {
    out.push(new Vec3(p.x, p.y, p.z));
    out.push(new Vec3(p.x + r.x * rightHalfWidth, p.y - height, p.z + r.z * rightHalfWidth));
    out.push(new Vec3(p.x - r.x * leftHalfWidth, p.y - height, p.z - r.z * leftHalfWidth));
  }
  return out;
}

/**
 * Points of an A-frame cross-section placed at ridge point `p` facing the
 * horizontal direction `heading` (radians, 0 = -Z, positive turns left).
 */
export function aFrameSection(p: Vec3Like, heading: number, height: number, halfWidth: number): Vec3[] {
  const dx = -Math.sin(heading);
  const dz = -Math.cos(heading);
  const r = rightOf(dx, dz);
  return [
    new Vec3(p.x, p.y, p.z),
    new Vec3(p.x + r.x * halfWidth, p.y - height, p.z + r.z * halfWidth),
    new Vec3(p.x - r.x * halfWidth, p.y - height, p.z - r.z * halfWidth),
  ];
}
