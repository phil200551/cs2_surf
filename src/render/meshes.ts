import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { CompiledMap } from '../map/compile';
import type { MaterialId } from '../map/types';
import { Vec3 } from '../physics';

/** Width of the glowing trim band along trimmed edges, in units. */
export const TRIM_WIDTH = 7;

interface Builder {
  positions: number[];
  normals: number[];
}

function builder(map: Map<MaterialId, Builder>, id: MaterialId): Builder {
  let b = map.get(id);
  if (!b) {
    b = { positions: [], normals: [] };
    map.set(id, b);
  }
  return b;
}

function emitPolygon(b: Builder, poly: Vec3[], n: Vec3): void {
  for (let i = 1; i + 1 < poly.length; i++) {
    for (const v of [poly[0], poly[i], poly[i + 1]]) {
      b.positions.push(v.x, v.y, v.z);
      b.normals.push(n.x, n.y, n.z);
    }
  }
}

/** Keeps the part of a planar polygon where dot(q - origin, dir) * sign >= offset * sign. */
function clipPolygon(poly: Vec3[], origin: Vec3, dir: Vec3, offset: number, keepInside: boolean): Vec3[] {
  const out: Vec3[] = [];
  const f = (q: Vec3) => {
    const d = (q.x - origin.x) * dir.x + (q.y - origin.y) * dir.y + (q.z - origin.z) * dir.z - offset;
    return keepInside ? d : -d;
  };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push(new Vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t));
    }
  }
  return out.length >= 3 ? out : [];
}

function polygonArea(poly: Vec3[]): number {
  let x = 0, y = 0, z = 0;
  for (let i = 1; i + 1 < poly.length; i++) {
    const a = poly[0], b = poly[i], c = poly[i + 1];
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    x += uy * vz - uz * vy;
    y += uz * vx - ux * vz;
    z += ux * vy - uy * vx;
  }
  return Math.sqrt(x * x + y * y + z * z) / 2;
}

export interface MapGeometry {
  /** Visible brush faces, merged per material. */
  faces: Map<MaterialId, BufferGeometry>;
  /** Emissive trim bands, merged per material. */
  trims: Map<MaterialId, BufferGeometry>;
}

/**
 * Builds render geometry from exactly the brushes the physics collides with.
 * Faces carrying trim are partitioned (not overlaid): the band along each
 * trimmed edge goes to the trim mesh and the rest to the face mesh, so the
 * two are coplanar without overlapping and can never z-fight.
 */
export function buildMapGeometry(map: CompiledMap, trimWidth = TRIM_WIDTH): MapGeometry {
  const faces = new Map<MaterialId, Builder>();
  const trims = new Map<MaterialId, Builder>();
  const inward = new Vec3();
  for (const cb of map.brushes) {
    cb.brush.faces.forEach((face, fi) => {
      if (!cb.faceVisible[fi]) return;
      let remaining: Vec3[] = face.vertices;
      const vs = face.vertices;
      for (const ei of cb.trimEdges[fi]) {
        const a = vs[ei];
        const b = vs[(ei + 1) % vs.length];
        const e = new Vec3(b.x - a.x, b.y - a.y, b.z - a.z);
        // Interior lies to the left of a CCW edge: normal x edge.
        inward.set(face.normal.y * e.z - face.normal.z * e.y, face.normal.z * e.x - face.normal.x * e.z, face.normal.x * e.y - face.normal.y * e.x);
        if (inward.normalize() === 0) continue;
        const band = clipPolygon(remaining, a, inward, trimWidth, false);
        remaining = clipPolygon(remaining, a, inward, trimWidth, true);
        if (band.length && polygonArea(band) > 1e-3) emitPolygon(builder(trims, cb.material), band, face.normal);
        if (!remaining.length) break;
      }
      if (remaining.length && polygonArea(remaining) > 1e-3) emitPolygon(builder(faces, cb.material), remaining, face.normal);
    });
  }
  const toGeometry = (m: Map<MaterialId, Builder>) => {
    const out = new Map<MaterialId, BufferGeometry>();
    for (const [id, b] of m) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(b.positions, 3));
      g.setAttribute('normal', new Float32BufferAttribute(b.normals, 3));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out.set(id, g);
    }
    return out;
  };
  return { faces: toGeometry(faces), trims: toGeometry(trims) };
}
