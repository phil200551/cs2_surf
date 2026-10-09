import { aFrameSection, boxPoints, brushFromPoints, CollisionWorld, Vec3, type Brush } from '../physics';
import type { MapDef, MaterialId, Primitive, RampPrimitive, TriggerDef } from './types';

/** One solid brush plus what the renderer needs to draw it. */
export interface CompiledBrush {
  brush: Brush;
  primitive: Primitive;
  material: MaterialId;
  /** Per face (index into brush.faces): draw it? */
  faceVisible: boolean[];
  /** Per face: indices i of edges (vertex i -> i+1) that carry glowing trim. */
  trimEdges: number[][];
}

export interface CompiledTrigger {
  def: TriggerDef;
  brush: Brush;
}

export interface CompiledMap {
  def: MapDef;
  brushes: CompiledBrush[];
  world: CollisionWorld;
  triggers: CompiledTrigger[];
  min: Vec3;
  max: Vec3;
}

const DEFAULT_RAMP_HEIGHT = 448;
const DEFAULT_RAMP_HALF_WIDTH = 256;

export function headingOf(dx: number, dz: number): number {
  // forward(heading) = (-sin h, 0, -cos h)
  return Math.atan2(-dx, -dz);
}

function rampPoints(p: RampPrimitive): Vec3[] {
  const h = p.height ?? DEFAULT_RAMP_HEIGHT;
  const w = p.halfWidth ?? DEFAULT_RAMP_HALF_WIDTH;
  const heading = headingOf(p.end.x - p.start.x, p.end.z - p.start.z);
  return [...aFrameSection(p.start, p.startHeading ?? heading, h, w), ...aFrameSection(p.end, p.endHeading ?? heading, h, w)];
}

export function primitivePoints(p: Primitive): Vec3[] {
  switch (p.kind) {
    case 'box':
      return boxPoints(p.min, p.max);
    case 'ramp':
      return rampPoints(p);
    case 'convex':
      return p.points.map((q) => new Vec3(q.x, q.y, q.z));
  }
}

function faceVisibility(p: Primitive, brush: Brush): boolean[] {
  if (p.kind !== 'ramp' || (!p.hideStartCap && !p.hideEndCap)) return brush.faces.map(() => true);
  const heading = headingOf(p.end.x - p.start.x, p.end.z - p.start.z);
  const hs = p.startHeading ?? heading;
  const he = p.endHeading ?? heading;
  return brush.faces.map((f) => {
    const n = f.normal;
    // Start cap faces backwards (against forward(hs)); end cap faces forward(he).
    const back = n.x * Math.sin(hs) + n.z * Math.cos(hs);
    const fwd = -n.x * Math.sin(he) - n.z * Math.cos(he);
    if (p.hideStartCap && back > 0.9) return false;
    if (p.hideEndCap && fwd > 0.9) return false;
    return true;
  });
}

function samePoint(a: Vec3, b: Vec3): boolean {
  return Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3 && Math.abs(a.z - b.z) < 1e-3;
}

function trimEdges(p: Primitive, brush: Brush, visible: boolean[]): number[][] {
  const out: number[][] = brush.faces.map(() => []);
  if (!p.trim) return out;
  brush.faces.forEach((f, fi) => {
    if (!visible[fi]) return;
    const vs = f.vertices;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      // The neighbouring face shares this edge (with opposite winding).
      const gi = brush.faces.findIndex((g, k) => k !== fi && g.vertices.some((v) => samePoint(v, a)) && g.vertices.some((v) => samePoint(v, b)));
      if (gi < 0 || !visible[gi]) continue;
      if (Math.max(f.normal.y, brush.faces[gi].normal.y) > 0.1) out[fi].push(i);
    }
  });
  return out;
}

function triggerBrush(t: TriggerDef): Brush {
  if (t.points) return brushFromPoints(t.points);
  if (t.min && t.max) return brushFromPoints(boxPoints(t.min, t.max));
  throw new Error(`trigger ${t.kind}/${t.stage} needs min/max or points`);
}

export function compileMap(def: MapDef, epsilon = 0.03125): CompiledMap {
  const brushes: CompiledBrush[] = def.primitives.map((p, i) => {
    let brush: Brush;
    try {
      brush = brushFromPoints(primitivePoints(p));
    } catch (e) {
      throw new Error(`primitive ${i} (${p.name ?? p.kind}): ${(e as Error).message}`);
    }
    const faceVisible = faceVisibility(p, brush);
    return { brush, primitive: p, material: p.material, faceVisible, trimEdges: trimEdges(p, brush, faceVisible) };
  });
  const world = new CollisionWorld(
    brushes.map((b) => b.brush),
    epsilon,
  );
  const min = new Vec3(Infinity, Infinity, Infinity);
  const max = new Vec3(-Infinity, -Infinity, -Infinity);
  for (const { brush } of brushes) {
    min.set(Math.min(min.x, brush.mins.x), Math.min(min.y, brush.mins.y), Math.min(min.z, brush.mins.z));
    max.set(Math.max(max.x, brush.maxs.x), Math.max(max.y, brush.maxs.y), Math.max(max.z, brush.maxs.z));
  }
  const triggers = def.triggers.map((t) => ({ def: t, brush: triggerBrush(t) }));
  return { def, brushes, world, triggers, min, max };
}
