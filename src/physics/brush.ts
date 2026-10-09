import { Vec3, cross, dot, type Vec3Like } from './vec3';

/**
 * One visible face of a brush: a convex polygon wound counter-clockwise when
 * seen from outside (i.e. right-handed around `normal`).
 */
export interface BrushFace {
  normal: Vec3;
  dist: number;
  vertices: Vec3[];
}

/**
 * A convex brush: the intersection of half-spaces `n . p <= d`.
 *
 * `planes` holds the real faces first (`numFaces` of them, matching `faces`)
 * followed by bevel planes. Bevels are the axial planes and edge-cross-axis
 * planes that make "offset every plane by the box support" an exact
 * Minkowski sum of the brush and an axis-aligned box, so swept-box traces
 * never catch on phantom corners past a brush's real edges.
 */
export class Brush {
  /** Packed [nx, ny, nz, dist] per plane. */
  readonly planes: Float64Array;
  readonly numPlanes: number = 0;
  readonly numFaces: number = 0;
  readonly faces: BrushFace[];
  readonly mins: Vec3;
  readonly maxs: Vec3;
  readonly points: Vec3[];
  /** Index in the owning collision world (assigned on insertion). */
  index = -1;

  constructor(faces: BrushFace[], extraPlanes: number[], points: Vec3[]) {
    this.faces = faces;
    this.numFaces = faces.length;
    this.numPlanes = faces.length + extraPlanes.length / 4;
    this.planes = new Float64Array(this.numPlanes * 4);
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      this.planes[i * 4] = f.normal.x;
      this.planes[i * 4 + 1] = f.normal.y;
      this.planes[i * 4 + 2] = f.normal.z;
      this.planes[i * 4 + 3] = f.dist;
    }
    this.planes.set(extraPlanes, faces.length * 4);
    this.points = points;
    this.mins = new Vec3(Infinity, Infinity, Infinity);
    this.maxs = new Vec3(-Infinity, -Infinity, -Infinity);
    for (const p of points) {
      this.mins.set(Math.min(this.mins.x, p.x), Math.min(this.mins.y, p.y), Math.min(this.mins.z, p.z));
      this.maxs.set(Math.max(this.maxs.x, p.x), Math.max(this.maxs.y, p.y), Math.max(this.maxs.z, p.z));
    }
  }
}

const AXES: readonly Vec3[] = [new Vec3(1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, 0, 1)];

/**
 * Builds a convex brush from a point cloud (the "convex-from-points"
 * primitive; boxes and A-frame prisms are point clouds too). Points strictly
 * inside the hull are ignored.
 *
 * @param tolerance distance under which points count as coplanar/coincident.
 */
export function brushFromPoints(input: readonly Vec3Like[], tolerance = 1e-3): Brush {
  const points: Vec3[] = [];
  for (const p of input) {
    if (!points.some((q) => Math.abs(q.x - p.x) <= tolerance && Math.abs(q.y - p.y) <= tolerance && Math.abs(q.z - p.z) <= tolerance)) {
      points.push(new Vec3(p.x, p.y, p.z));
    }
  }
  if (points.length < 4) throw new Error('brushFromPoints: need at least 4 distinct points');

  const n = points.length;
  const seen = new Set<string>();
  const faces: BrushFace[] = [];
  const e1 = new Vec3();
  const e2 = new Vec3();
  const nrm = new Vec3();

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = points[i];
        e1.set(points[j].x - a.x, points[j].y - a.y, points[j].z - a.z);
        e2.set(points[k].x - a.x, points[k].y - a.y, points[k].z - a.z);
        cross(e1, e2, nrm);
        const len = nrm.length();
        // Reject (near-)collinear triples: area too small relative to edge lengths.
        if (len <= 1e-9 * Math.max(1, e1.lengthSq(), e2.lengthSq())) continue;
        nrm.scale(1 / len);
        let d = dot(nrm, a);
        let front = 0;
        let back = 0;
        for (const p of points) {
          const s = dot(nrm, p) - d;
          if (s > tolerance) front++;
          else if (s < -tolerance) back++;
        }
        if (front > 0 && back > 0) continue; // not a supporting plane
        if (front > 0) {
          nrm.scale(-1);
          d = -d;
        }
        const onPlane: number[] = [];
        for (let m = 0; m < n; m++) {
          if (Math.abs(dot(nrm, points[m]) - d) <= tolerance) onPlane.push(m);
        }
        const key = onPlane.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const face = buildFace(points, onPlane, nrm, tolerance);
        if (face) faces.push(face);
      }
    }
  }
  if (faces.length < 4) throw new Error('brushFromPoints: degenerate (flat) point set');

  return new Brush(faces, buildBevels(faces, points, tolerance), points);
}

function buildFace(points: Vec3[], indices: number[], normal: Vec3, tolerance: number): BrushFace | null {
  // Centroid and an in-plane basis (u, v, normal) that is right-handed.
  const c = new Vec3();
  for (const i of indices) c.addScaled(points[i], 1 / indices.length);
  const u = new Vec3();
  const ref = Math.abs(normal.y) < 0.9 ? AXES[1] : AXES[0];
  cross(ref, normal, u);
  u.normalize();
  const v = cross(normal, u, new Vec3());
  const ordered = indices
    .map((i) => {
      const p = points[i];
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const dz = p.z - c.z;
      return { p, a: Math.atan2(dx * v.x + dy * v.y + dz * v.z, dx * u.x + dy * u.y + dz * u.z) };
    })
    .sort((A, B) => A.a - B.a)
    .map((e) => e.p.clone());

  // Drop vertices that sit on the straight line between their neighbours.
  const verts: Vec3[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const prev = ordered[(i + ordered.length - 1) % ordered.length];
    const cur = ordered[i];
    const next = ordered[(i + 1) % ordered.length];
    const ax = cur.x - prev.x, ay = cur.y - prev.y, az = cur.z - prev.z;
    const bx = next.x - prev.x, by = next.y - prev.y, bz = next.z - prev.z;
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const blen = Math.sqrt(bx * bx + by * by + bz * bz);
    const dist = blen > 0 ? Math.sqrt(cx * cx + cy * cy + cz * cz) / blen : 0;
    if (dist > tolerance) verts.push(cur);
  }
  if (verts.length < 3) return null;

  // Newell's method gives a normal that uses every vertex, not one triple.
  const nn = new Vec3();
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    nn.x += (a.y - b.y) * (a.z + b.z);
    nn.y += (a.z - b.z) * (a.x + b.x);
    nn.z += (a.x - b.x) * (a.y + b.y);
  }
  if (nn.normalize() === 0) return null;
  if (dot(nn, normal) < 0) nn.scale(-1);
  let dist = 0;
  for (const p of verts) dist += dot(nn, p);
  dist /= verts.length;
  return { normal: nn, dist, vertices: verts };
}

function buildBevels(faces: BrushFace[], points: Vec3[], tolerance: number): number[] {
  const out: number[] = [];
  const normals: Vec3[] = faces.map((f) => f.normal);

  const hasNormal = (m: Vec3) => normals.some((q) => dot(q, m) > 1 - 1e-9);
  const addPlane = (m: Vec3, d: number) => {
    normals.push(m.clone());
    out.push(m.x, m.y, m.z, d);
  };

  // Axial bevels: the brush's bounding box planes.
  for (const axis of AXES) {
    for (const sign of [1, -1]) {
      const m = axis.clone().scale(sign);
      if (hasNormal(m)) continue;
      let d = -Infinity;
      for (const p of points) d = Math.max(d, dot(m, p));
      addPlane(m, d);
    }
  }

  // Edge bevels: planes containing a non-axial edge and an axis direction,
  // kept only when the whole brush lies behind them.
  const e = new Vec3();
  const m = new Vec3();
  for (const f of faces) {
    const vs = f.vertices;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      e.set(b.x - a.x, b.y - a.y, b.z - a.z);
      if (e.normalize() === 0) continue;
      for (const axis of AXES) {
        if (Math.abs(dot(e, axis)) > 1 - 1e-6) continue;
        cross(e, axis, m);
        if (m.normalize() < 1e-6) continue;
        for (const sign of [1, -1]) {
          const mm = m.clone().scale(sign);
          if (hasNormal(mm)) continue;
          const d = dot(mm, a);
          let ok = true;
          for (const p of points) {
            if (dot(mm, p) > d + tolerance) {
              ok = false;
              break;
            }
          }
          if (ok) addPlane(mm, d);
        }
      }
    }
  }
  return out;
}

/** Convenience: axis-aligned box brush. */
export function boxBrush(min: Vec3Like, max: Vec3Like): Brush {
  const pts: Vec3[] = [];
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) pts.push(new Vec3(x, y, z));
  return brushFromPoints(pts);
}
