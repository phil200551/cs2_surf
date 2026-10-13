/**
 * Skyline: an original three-stage beginner surf map built for speed.
 *
 * The course is a "downhill chain": every ramp descends, and after each gap
 * the next ramp starts a little (`dip`) below the line the previous ridge was
 * descending along. A rider leaves a ramp travelling along that line and falls
 * away from it only by gravity, so the same gap works at almost any speed: a
 * slow rider drops `0.5 g (gap / speed)^2` before the next ramp (the dip
 * covers that), and a fast one lands a little further along it.
 *
 * Boosters (the surf map trigger_push) do the rest: a launcher on every
 * spawn platform gets you moving at once, and a boost gate in every gap adds
 * speed as you fly through it.
 *
 * Everything that shapes a gap is in LAYOUT, and `npm test` re-validates the
 * whole course with a bot whenever it changes.
 */
import { boostZone, curveRamp, forward, orientedBoxPoints, rightVec, straightRamp, v3, zone } from './builders';
import type { MapDef, MaterialId, Primitive, RampPrimitive, StageDef, TriggerDef, V3 } from './types';

const DEG = Math.PI / 180;

export const LAYOUT = {
  rampHeight: 448,
  rampHalfWidth: 256,
  /** Left-face ramps sit this far to the right, so one lane lands on the facing side. */
  alternateOffset: 256,
  /** Ridge start of the first ramp. */
  start: { x: -13000, y: 15500, z: 61500 },
  stage1: {
    /** Stepping off the start platform raises the along-course speed to this. */
    launchSpeed: 2000,
    ramp1: { length: 9000, slope: 7 },
    gap: { length: 800, dip: 200, boost: 350 },
    ramp2: { length: 7000, slope: 7 },
  },
  stage2: {
    entry: { length: 700, dip: 200, boost: 250 },
    launchSpeed: 2600,
    ramp1: { length: 7000, slope: 4 },
    /** Faces of the alternating ramps after the first; the last one leads into the curve. */
    sides: ['left', 'right', 'left', 'right'] as const,
    alternate: { length: 8000, slope: 4, gap: 400, dip: 420, boost: 150 },
    /**
     * Level, and ridden on its inner face, which can only hold a rider while
     * v^2 / R <= g tan 60 (about 1386 u/s^2): this radius holds 7800 u/s.
     */
    curve: { radius: 44000, turn: -26, segments: 13, boostSegment: 6, boost: 300 },
  },
  stage3: {
    entry: { length: 600, dip: 150, boost: 400 },
    launchSpeed: 3600,
    /**
     * The big drop: straight segments steepening 2 degrees at a time. A rider
     * only stays on a convex profile whose curvature is below g / v^2, so it
     * steepens slowly enough to be ridden at stage 3 speeds.
     */
    drop: { segmentLength: 1100, slopes: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
    /** Then a long straight at the steepest slope, with a booster halfway down. */
    steep: { length: 5000, slope: 20, boost: 600 },
    /**
     * Flattening out again before the long gap. Each concave joint nudges a
     * rider outward a little (more the faster they go), so the joints come
     * before the long gap's booster rather than after it.
     */
    flatten: { segmentLength: 900, slopes: [18, 16, 14, 12, 10, 8, 6] },
    longGap: { length: 2500, dip: 330, boost: 800 },
    /** One long straight landing ramp: no joints at top speed. */
    landing: { length: 8000, slope: 6 },
    end: { gap: 400, drop: 520, zoneLength: 3000, length: 16000, width: 2600 },
  },
  /** Spawn pads float this far above the highest incoming rider. */
  padClearance: 100,
} as const;

const L = LAYOUT;

/** `p` moved `side` to the right, `along` forward and `up` up for a heading. */
function offset(p: V3, headingDeg: number, side: number, along: number, up = 0): V3 {
  const f = forward(headingDeg);
  const r = rightVec(headingDeg);
  return { x: p.x + r.x * side + f.x * along, y: p.y + up, z: p.z + r.z * side + f.z * along };
}

/** Heading of a straight ramp in degrees. */
function headingOf(r: RampPrimitive): number {
  return (Math.atan2(-(r.end.x - r.start.x), -(r.end.z - r.start.z)) * 180) / Math.PI;
}

function lengthOf(r: RampPrimitive): number {
  return Math.hypot(r.end.x - r.start.x, r.end.z - r.start.z);
}

/** Descent of a ramp's ridge per unit of horizontal distance. */
function slopeOf(r: RampPrimitive): number {
  return (r.start.y - r.end.y) / lengthOf(r);
}

/** Lateral offset (to the right of the ridge) of the middle of a ramp's riding lane. */
function laneOf(r: RampPrimitive): number {
  return r.ride === 'left' ? -L.rampHalfWidth / 2 : L.rampHalfWidth / 2;
}

function build(): MapDef {
  const prims: Primitive[] = [];
  const triggers: TriggerDef[] = [];
  const stages: StageDef[] = [];
  const route: RampPrimitive[] = [];
  const ramp = (r: RampPrimitive) => {
    prims.push(r);
    route.push(r);
    return r;
  };

  /**
   * Start of a ramp across a `gap` after `prev`: `dip` below the line its
   * ridge descends along, shifted `side` to the right.
   */
  const across = (prev: RampPrimitive, gap: number, dip: number, side = 0): V3 => {
    const p = offset(prev.end, headingOf(prev), side, gap);
    p.y = prev.end.y - gap * slopeOf(prev) - dip;
    return p;
  };

  const straight = (name: string, start: V3, heading: number, length: number, slopeDeg: number, material: MaterialId, ride: 'left' | 'right') =>
    straightRamp({ name, start, heading, length, drop: length * Math.tan(slopeDeg * DEG), material, ride });

  /** Thin boost gate across a ramp's face, halfway along it. */
  const faceBoost = (stage: number, r: RampPrimitive, add: number) => {
    const h = headingOf(r);
    const c = offset(r.start, h, laneOf(r), lengthOf(r) / 2);
    c.y = (r.start.y + r.end.y) / 2 - L.rampHeight / 2;
    triggers.push(boostZone(stage, c, 420, L.rampHeight / 2 + 360, 40, { heading: h, add, min: 0 }));
  };

  /** Thin boost gate across the middle of the gap from `prev` to `next`. */
  const gapBoost = (stage: number, prev: RampPrimitive, next: RampPrimitive, add: number) => {
    const h = headingOf(prev);
    const gap = Math.hypot(next.start.x - prev.end.x, next.start.z - prev.end.z);
    const top = prev.end.y + 220;
    const bottom = next.start.y - L.rampHeight - 260;
    const c = offset(prev.end, h, laneOf(prev), gap / 2);
    c.y = (top + bottom) / 2;
    triggers.push(boostZone(stage, c, 540, (top - bottom) / 2, 40, { heading: h, add, min: 0 }));
  };

  // ---------------------------------------------------------------- Stage 1
  const s1 = L.stage1;
  const start = v3(L.start.x, L.start.y, L.start.z);
  const r1 = ramp(straight('S1 ramp 1', start, 0, s1.ramp1.length, s1.ramp1.slope, 'stage1', 'right'));
  // Start platform over the top of the first ramp, inside the start zone.
  const padTop = start.y + 216;
  const startCenter = offset(start, 0, 0, 256);
  startCenter.y = padTop;
  prims.push({ kind: 'convex', name: 'Start', material: 'platform', trim: true, points: orientedBoxPoints(v3(startCenter.x, padTop - 24, startCenter.z), 256, 24, 256, 0) });
  const spawn1 = offset(start, 0, 112, 400);
  spawn1.y = padTop + 1;
  stages.push({ index: 1, name: 'Stage 1', spawn: spawn1, yaw: 0, pitch: -14 });
  triggers.push(zone('start', 1, v3(startCenter.x, padTop + 88, startCenter.z), 256, 88, 256));
  launcher(1, r1, startCenter, padTop, 256, s1.launchSpeed);

  const r2 = ramp(straight('S1 ramp 2', across(r1, s1.gap.length, s1.gap.dip), 0, s1.ramp2.length, s1.ramp2.slope, 'stage1', 'right'));
  gapBoost(1, r1, r2, s1.gap.boost);

  // ---------------------------------------------------------------- Stage 2
  const s2 = L.stage2;
  const r3 = ramp(straight('S2 ramp 1', across(r2, s2.entry.length, s2.entry.dip), 0, s2.ramp1.length, s2.ramp1.slope, 'stage2', 'right'));
  stageStart(2, r2, r3, s2.launchSpeed, s2.entry.boost);

  // Alternating faces. A left-face ramp sits one half-width to the right, so
  // the lane over the right face of one ramp is over the left face of the next.
  let prev = r3;
  s2.sides.forEach((ride, i) => {
    const side = ride === 'left' ? L.alternateOffset : -L.alternateOffset;
    const next = ramp(straight(`S2 ramp ${i + 2}`, across(prev, s2.alternate.gap, s2.alternate.dip, side), 0, s2.alternate.length, s2.alternate.slope, 'stage2', ride));
    gapBoost(2, prev, next, s2.alternate.boost);
    prev = next;
  });
  // The last alternating ramp leads straight into a long, level right-hand
  // curve ridden on its inner face.
  prev.hideEndCap = true;
  const curve = curveRamp({ name: 'S2 curve', start: prev.end, heading: 0, turn: s2.curve.turn, radius: s2.curve.radius, segments: s2.curve.segments, material: 'stage2', ride: 'right' });
  curve.segments[0].hideStartCap = true;
  curve.segments.forEach(ramp);
  const curveLast = curve.segments[curve.segments.length - 1];
  faceBoost(2, curve.segments[s2.curve.boostSegment], s2.curve.boost);

  // ---------------------------------------------------------------- Stage 3
  const s3 = L.stage3;
  // Continue along the direction riders actually leave the curve: its last chord.
  const h3 = curve.exitHeading;
  let point = across(curveLast, s3.entry.length, s3.entry.dip);
  // Every segment from the top of the big drop to the long gap.
  const drop = s3.drop.slopes.map((deg, i, all) => {
    const seg = ramp({
      ...straight(`S3 big drop ${i + 1}/${all.length}`, point, h3, s3.drop.segmentLength, deg, 'stage3', 'right'),
      hideStartCap: i > 0,
      hideEndCap: true,
    });
    point = seg.end;
    return seg;
  });
  stageStart(3, curveLast, drop[0], s3.launchSpeed, s3.entry.boost);
  const steep = ramp({ ...straight('S3 steep', point, h3, s3.steep.length, s3.steep.slope, 'stage3', 'right'), hideStartCap: true, hideEndCap: true });
  drop.push(steep);
  point = steep.end;
  faceBoost(3, steep, s3.steep.boost);
  for (const [i, deg] of s3.flatten.slopes.entries()) {
    const seg = ramp({
      ...straight(`S3 flatten ${i + 1}/${s3.flatten.slopes.length}`, point, h3, s3.flatten.segmentLength, deg, 'stage3', 'right'),
      hideStartCap: true,
      hideEndCap: i < s3.flatten.slopes.length - 1,
    });
    point = seg.end;
    drop.push(seg);
  }
  const lastDrop = drop[drop.length - 1];
  const land = ramp(straight('S3 landing', across(lastDrop, s3.longGap.length, s3.longGap.dip), h3, s3.landing.length, s3.landing.slope, 'stage3', 'right'));
  gapBoost(3, lastDrop, land, s3.longGap.boost);

  // End runway (rotated with the course) with the end zone over its start.
  const endTop = land.end.y - s3.end.drop;
  const endCenter = offset(land.end, h3, 128, s3.end.gap + s3.end.length / 2);
  endCenter.y = endTop;
  prims.push({ kind: 'convex', name: 'End platform', material: 'platform', trim: true, points: orientedBoxPoints(v3(endCenter.x, endTop - 32, endCenter.z), s3.end.width / 2, 32, s3.end.length / 2, h3) });
  const endZone = offset(land.end, h3, 128, s3.end.gap + s3.end.zoneLength / 2);
  triggers.push(zone('end', 3, v3(endZone.x, endTop + 320, endZone.z), s3.end.width / 2, 320, s3.end.zoneLength / 2, h3));

  // ---------------------------------------------------------------- Fail volumes
  // A sloped volume under each ramp and the gap leading to it (so a fall is
  // short wherever you are), always below the flight paths that land on that
  // ramp, plus a catch-all under everything.
  route.forEach((r, i) => {
    const prevRamp = route[i - 1];
    const last = i === route.length - 1;
    const heading = headingOf(r);
    const len = lengthOf(r);
    const gapBefore = prevRamp ? Math.hypot(r.start.x - prevRamp.end.x, r.start.z - prevRamp.end.z) : 0;
    const a0 = prevRamp ? -gapBefore - 160 : -800;
    const a1 = len + (last ? s3.end.gap + s3.end.length + 400 : 160);
    const ridgeAt = (a: number) => r.start.y + ((r.end.y - r.start.y) * Math.max(0, Math.min(len, a))) / len;
    const pts: V3[] = [];
    for (const a of [a0, a1]) {
      const top = ridgeAt(a) - L.rampHeight - 700;
      for (const side of [-2400, 2400]) {
        for (const dy of [0, -2500]) pts.push(offset(v3(r.start.x, top + dy, r.start.z), heading, side, a));
      }
    }
    triggers.push({ kind: 'fail', stage: 0, points: pts });
  });
  const all = [...route.flatMap((r) => [r.start, r.end]), endCenter];
  const span = 30000;
  triggers.push({
    kind: 'fail',
    stage: 0,
    min: v3(Math.min(...all.map((p) => p.x)) - span, endTop - 6000, Math.min(...all.map((p) => p.z)) - span),
    max: v3(Math.max(...all.map((p) => p.x)) + span, endTop - 2200, Math.max(...all.map((p) => p.z)) + span),
  });

  return {
    id: 'skyline',
    name: 'Skyline',
    sun: { azimuth: -50, elevation: 38 },
    primitives: prims,
    triggers,
    stages,
  };

  /**
   * Launcher for a spawn platform. A gate on the front edge launches you the
   * moment you step off it, with a little lift so the platform's friction
   * never bites, and a hidden volume under the platform catches stepping off
   * a side or the back, once you are clear below it. Riders already faster
   * than `speed` pass through both untouched.
   */
  function launcher(stage: number, first: RampPrimitive, padCenter: V3, top: number, half: number, speed: number): void {
    const h = headingOf(first);
    // A low strip: a hull walking off the edge always overlaps it (jumping
    // over it is caught by the volume underneath). It is drawn as a boost
    // pad on the front of the platform.
    const gate = offset(padCenter, h, 0, half + 40);
    gate.y = top + 28;
    const pad = offset(padCenter, h, 0, half - 112);
    pad.y = top + 2;
    triggers.push({
      ...boostZone(stage, gate, half + 32, 36, 40, { heading: h, add: 0, min: speed, up: 160 }),
      display: { center: pad, halfX: half - 40, halfY: 1, halfZ: 112, heading: h, decal: true },
    });
    const hi = top - 48 - 72 - 8;
    const lo = first.start.y - L.rampHeight - 120;
    const under = v3(padCenter.x, (hi + lo) / 2, padCenter.z);
    triggers.push({ ...boostZone(stage, under, half + 160, (hi - lo) / 2, half + 160, { heading: h, add: 0, min: speed }), hidden: true });
  }

  /**
   * Stage start: a checkpoint gate spanning the gap into `first`, a boost
   * gate in that gap, and a respawn pad with a launcher, floating just above
   * the incoming flight band (so it never blocks the line).
   */
  function stageStart(stage: number, before: RampPrimitive, first: RampPrimitive, launchSpeed: number, boost: number): void {
    const h = headingOf(first);
    const gapLen = Math.hypot(first.start.x - before.end.x, first.start.z - before.end.z);
    // Highest incoming hull top over the pad: the shallowest lane (20 units
    // from the ridge) on the line the previous ridge descends along.
    const padBack = -32;
    const line = before.end.y - (gapLen - padBack) * slopeOf(before);
    const top = line - 35 + 72 + L.padClearance + 48;
    const padCenter = offset(first.start, h, 128, 160);
    padCenter.y = top;
    prims.push({ kind: 'convex', name: `Stage ${stage} pad`, material: 'platform', trim: true, points: orientedBoxPoints(v3(padCenter.x, top - 24, padCenter.z), 192, 24, 192, h) });
    const spawn = offset(first.start, h, 112, 240);
    spawn.y = top + 1;
    stages.push({ index: stage, name: `Stage ${stage}`, spawn, yaw: h, pitch: -14 });
    launcher(stage, first, padCenter, top, 192, launchSpeed);
    gapBoost(stage, before, first, boost);
    // Gate: from the previous ramp's end to just past the new ramp's start.
    const gateCenter = offset(first.start, h, 64, -gapLen / 2 + 48);
    const yLow = first.start.y - L.rampHeight - 200;
    const yHigh = top + 400;
    gateCenter.y = (yLow + yHigh) / 2;
    triggers.push(zone('checkpoint', stage, gateCenter, 520, (yHigh - yLow) / 2, gapLen / 2 + 48, h));
  }
}

export const BEGINNER_MAP: MapDef = build();

/** The ramps of the intended line, in order (the ones with a ridden face). */
export function routeOf(map: MapDef): RampPrimitive[] {
  return map.primitives.filter((p): p is RampPrimitive => p.kind === 'ramp' && p.ride !== undefined);
}
