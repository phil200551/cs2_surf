import type { BoostDef, BoxPrimitive, MaterialId, RampPrimitive, TriggerDef, TriggerKind, V3 } from './types';

const DEG = Math.PI / 180;

/** Horizontal unit vector for a heading in degrees (0 = -Z, + turns left). */
export function forward(headingDeg: number): V3 {
  const h = headingDeg * DEG;
  return { x: -Math.sin(h), y: 0, z: -Math.cos(h) };
}

/** Horizontal unit vector to the right of a heading. */
export function rightVec(headingDeg: number): V3 {
  const h = headingDeg * DEG;
  return { x: Math.cos(h), y: 0, z: -Math.sin(h) };
}

export function add(a: V3, b: V3, s = 1): V3 {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}

export function v3(x: number, y: number, z: number): V3 {
  return { x, y, z };
}

export interface RampSpec {
  name: string;
  /** Ridge start point. */
  start: V3;
  /** Heading in degrees. */
  heading: number;
  length: number;
  /** How much the ridge descends over the ramp's length. */
  drop?: number;
  material: MaterialId;
  ride: 'left' | 'right';
  height?: number;
  halfWidth?: number;
}

/** Straight (optionally descending) A-frame ramp. */
export function straightRamp(spec: RampSpec): RampPrimitive {
  const f = forward(spec.heading);
  const end = { x: spec.start.x + f.x * spec.length, y: spec.start.y - (spec.drop ?? 0), z: spec.start.z + f.z * spec.length };
  return {
    kind: 'ramp',
    name: spec.name,
    material: spec.material,
    trim: true,
    start: spec.start,
    end,
    height: spec.height,
    halfWidth: spec.halfWidth,
    ride: spec.ride,
  };
}

/** End of a straight ramp's ridge. */
export function rampEnd(r: RampPrimitive): V3 {
  return r.end;
}

export interface CurveSpec {
  name: string;
  start: V3;
  /** Heading at the start, degrees. */
  heading: number;
  /** Total turn in degrees (+ left, - right). */
  turn: number;
  /** Ridge radius of the arc. */
  radius: number;
  segments: number;
  drop?: number;
  material: MaterialId;
  ride: 'left' | 'right';
}

/**
 * A curved ramp built from straight segments. Each joint's cross-section is
 * perpendicular to the bisector of its two segments and shared exactly by
 * both, so the faces meet without gaps or ledges.
 */
export function curveRamp(spec: CurveSpec): { segments: RampPrimitive[]; end: V3; endHeading: number; exitHeading: number } {
  const n = spec.segments;
  const step = spec.turn / n;
  const chord = 2 * spec.radius * Math.sin(Math.abs(step * DEG) / 2);
  const dropPer = (spec.drop ?? 0) / n;
  const segments: RampPrimitive[] = [];
  let p = spec.start;
  let h = spec.heading;
  for (let i = 0; i < n; i++) {
    const f = forward(h + step / 2);
    const q = { x: p.x + f.x * chord, y: p.y - dropPer, z: p.z + f.z * chord };
    segments.push({
      kind: 'ramp',
      name: `${spec.name} ${i + 1}/${n}`,
      material: spec.material,
      trim: true,
      start: p,
      end: q,
      startHeading: h * DEG,
      endHeading: (h + step) * DEG,
      hideStartCap: i > 0,
      hideEndCap: i < n - 1,
      ride: spec.ride,
    });
    p = q;
    h += step;
  }
  // Riders leave along the last segment's chord, half a step short of the tangent.
  return { segments, end: p, endHeading: h, exitHeading: h - step / 2 };
}

/** Box whose top face is centred on `topCenter`. */
export function platform(name: string, topCenter: V3, sizeX: number, sizeZ: number, thickness: number, material: MaterialId = 'platform'): BoxPrimitive {
  return {
    kind: 'box',
    name,
    material,
    trim: true,
    min: { x: topCenter.x - sizeX / 2, y: topCenter.y - thickness, z: topCenter.z - sizeZ / 2 },
    max: { x: topCenter.x + sizeX / 2, y: topCenter.y, z: topCenter.z + sizeZ / 2 },
  };
}

/** The 8 corners of a box rotated about Y by `headingDeg`. */
export function orientedBoxPoints(center: V3, halfX: number, halfY: number, halfZ: number, headingDeg: number): V3[] {
  const r = rightVec(headingDeg);
  const f = forward(headingDeg);
  const out: V3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // local x = right, local z = -forward (so +z is "behind")
        out.push({
          x: center.x + r.x * halfX * sx - f.x * halfZ * sz,
          y: center.y + halfY * sy,
          z: center.z + r.z * halfX * sx - f.z * halfZ * sz,
        });
      }
    }
  }
  return out;
}

/** Trigger volume: oriented box centred on `center`. */
export function zone(kind: TriggerKind, stage: number, center: V3, halfX: number, halfY: number, halfZ: number, headingDeg = 0): TriggerDef {
  if (headingDeg === 0) {
    return { kind, stage, min: { x: center.x - halfX, y: center.y - halfY, z: center.z - halfZ }, max: { x: center.x + halfX, y: center.y + halfY, z: center.z + halfZ } };
  }
  return { kind, stage, points: orientedBoxPoints(center, halfX, halfY, halfZ, headingDeg), obb: { center, halfX, halfY, halfZ, heading: headingDeg } };
}

/** Booster volume: an oriented box (always stored as points, so it can be drawn rotated). */
export function boostZone(stage: number, center: V3, halfX: number, halfY: number, halfZ: number, boost: BoostDef): TriggerDef {
  const h = boost.heading;
  return { kind: 'boost', stage, points: orientedBoxPoints(center, halfX, halfY, halfZ, h), obb: { center, halfX, halfY, halfZ, heading: h }, boost };
}
