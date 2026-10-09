import { curveRamp, forward, orientedBoxPoints, platform, rightVec, straightRamp, v3, zone } from './builders';
import type { MapDef, Primitive, RampPrimitive, StageDef, TriggerDef, V3 } from './types';

/**
 * "Skyline" — an original three-stage linear beginner surf map floating in
 * open sky. Every number that shapes a gap lives in LAYOUT so the map can be
 * re-validated by the headless bot and ballistics tests (tests/map.test.ts).
 *
 * The course starts heading -Z, curves 60 degrees right in stage 2, and
 * finishes heading -60 degrees.
 */
export const LAYOUT = {
  /** Ridge height of the first ramp. */
  startHeight: 9000,
  /** Z of the first ramp's ridge start. Chosen to roughly centre the course. */
  startZ: 17000,
  rampHeight: 448,
  rampHalfWidth: 256,
  /** Lateral offset between alternating ramps (left face lands on right face). */
  alternateOffset: 256,
  stage1: { r1Length: 6400, r1Drop: 480, gap: 384, gapDrop: 320, r2Length: 4000, r2Drop: 300 },
  /** Same-face transition into a new stage. */
  stageEntry: { gap: 384, gapDrop: 320 },
  stage2: { rampLength: 3200, rampDrop: 260, altGap: 320, altGapDrop: 560, curveLeadIn: 1600, curveLeadInDrop: 120, curveRadius: 3600, curveTurn: -60, curveSegments: 12 },
  stage3: {
    /** Big drop: segment descent angles (degrees) steepening then flattening, so riders stay on it. */
    dropSlopes: [4, 10, 16, 22, 26, 22, 14, 6],
    dropSegmentLength: 600,
    longGap: 1500,
    longGapDrop: 900,
    landLength: 4400,
    landDrop: 0,
    endGap: 320,
    endDrop: 450,
    endLength: 3000,
    endWidth: 2048,
  },
  /** Stage pads float this far above the previous ramp's ridge end. */
  padClearance: 180,
} as const;

const L = LAYOUT;

/** Unit offsets of a point in a ramp's frame: `side` along the right vector, `along` the heading. */
function offset(p: V3, headingDeg: number, side: number, along: number, up = 0): V3 {
  const f = forward(headingDeg);
  const r = rightVec(headingDeg);
  return { x: p.x + r.x * side + f.x * along, y: p.y + up, z: p.z + r.z * side + f.z * along };
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

  // ---------------------------------------------------------------- Stage 1
  const r1 = ramp(straightRamp({ name: 'S1 ramp 1', start: v3(0, L.startHeight, L.startZ), heading: 0, length: L.stage1.r1Length, drop: L.stage1.r1Drop, material: 'stage1', ride: 'right' }));
  // Spawn platform floats over the start of ramp 1; walk off its front edge to drop in.
  const padTop = L.startHeight + 216;
  const spawnCenter = v3(0, padTop, L.startZ - 256);
  prims.push(platform('Start', spawnCenter, 512, 512, 48));
  stages.push({ index: 1, name: 'Stage 1', spawn: v3(112, padTop + 1, L.startZ - 240), yaw: 0, pitch: -14 });
  triggers.push(zone('start', 1, v3(0, padTop + 88, spawnCenter.z), 256, 88, 256));

  const r2 = ramp(
    straightRamp({
      name: 'S1 ramp 2',
      start: v3(0, r1.end.y - L.stage1.gapDrop, r1.end.z - L.stage1.gap),
      heading: 0,
      length: L.stage1.r2Length,
      drop: L.stage1.r2Drop,
      material: 'stage1',
      ride: 'right',
    }),
  );

  // ---------------------------------------------------------------- Stage 2
  const r3 = ramp(
    straightRamp({
      name: 'S2 ramp 1',
      start: v3(0, r2.end.y - L.stageEntry.gapDrop, r2.end.z - L.stageEntry.gap),
      heading: 0,
      length: L.stage2.rampLength,
      drop: L.stage2.rampDrop,
      material: 'stage2',
      ride: 'right',
    }),
  );
  stagePad(2, r2, r3, 0);

  // Alternating faces: right, left, right, left. Left-face ramps sit one
  // half-width to the right so the same lane lands on the facing side.
  let prev = r3;
  const sides: Array<'left' | 'right'> = ['left', 'right', 'left'];
  sides.forEach((ride, i) => {
    const x = ride === 'left' ? L.alternateOffset : 0;
    prev = ramp(
      straightRamp({
        name: `S2 ramp ${i + 2}`,
        start: v3(x, prev.end.y - L.stage2.altGapDrop, prev.end.z - L.stage2.altGap),
        heading: 0,
        length: L.stage2.rampLength,
        drop: L.stage2.rampDrop,
        material: 'stage2',
        ride,
      }),
    );
  });

  // Gentle 60 degree right-hand curve ridden on its inner (right) face, with
  // a straight lead-in so riders touch down before it starts turning.
  const leadIn = ramp({
    ...straightRamp({
      name: 'S2 curve lead-in',
      start: v3(0, prev.end.y - L.stage2.altGapDrop, prev.end.z - L.stage2.altGap),
      heading: 0,
      length: L.stage2.curveLeadIn,
      drop: L.stage2.curveLeadInDrop,
      material: 'stage2',
      ride: 'right',
    }),
    hideEndCap: true,
  });
  const curve = curveRamp({
    name: 'S2 curve',
    start: leadIn.end,
    heading: 0,
    turn: L.stage2.curveTurn,
    radius: L.stage2.curveRadius,
    segments: L.stage2.curveSegments,
    // Level: rotated sections at equal heights keep every segment face an
    // exact planar trapezoid (a descending arc would twist them).
    material: 'stage2',
    ride: 'right',
  });
  curve.segments[0].hideStartCap = true;
  curve.segments.forEach(ramp);
  const curveLast = curve.segments[curve.segments.length - 1];

  // ---------------------------------------------------------------- Stage 3
  // Continue along the direction riders actually leave the curve: its last chord.
  const h3 = curve.exitHeading;
  // The big drop: straight segments whose descent steepens (convex, gentler
  // than a ballistic arc so riders keep contact) and then flattens again
  // (concave, turning height into horizontal speed for the long gap).
  let dropPoint = offset(curve.end, h3, 0, L.stageEntry.gap, -L.stageEntry.gapDrop);
  const slopes = L.stage3.dropSlopes;
  const dropSegments = slopes.map((deg, i) => {
    const seg = ramp({
      ...straightRamp({
        name: `S3 big drop ${i + 1}/${slopes.length}`,
        start: dropPoint,
        heading: h3,
        length: L.stage3.dropSegmentLength,
        drop: L.stage3.dropSegmentLength * Math.tan((deg * Math.PI) / 180),
        material: 'stage3',
        ride: 'right',
      }),
      hideStartCap: i > 0,
      hideEndCap: i < slopes.length - 1,
    });
    dropPoint = seg.end;
    return seg;
  });
  const drop = dropSegments[dropSegments.length - 1];
  stagePad(3, curveLast, dropSegments[0], h3);

  const landStart = offset(drop.end, h3, 0, L.stage3.longGap, -L.stage3.longGapDrop);
  const land = ramp(straightRamp({ name: 'S3 landing', start: landStart, heading: h3, length: L.stage3.landLength, drop: L.stage3.landDrop, material: 'stage3', ride: 'right' }));

  // End platform (rotated with the course) and the end zone over it.
  const endTop = land.end.y - L.stage3.endDrop;
  const endCenter = offset(land.end, h3, 128, L.stage3.endGap + L.stage3.endLength / 2);
  endCenter.y = endTop;
  const endPts = orientedBoxPoints(v3(endCenter.x, endTop - 32, endCenter.z), L.stage3.endWidth / 2, 32, L.stage3.endLength / 2, h3);
  prims.push({ kind: 'convex', name: 'End platform', material: 'platform', trim: true, points: endPts });
  triggers.push(zone('end', 3, v3(endCenter.x, endTop + 320, endCenter.z), L.stage3.endWidth / 2, 320, L.stage3.endLength / 2, h3));

  // ---------------------------------------------------------------- Fail volumes
  // A sloped volume under each ramp and the gap leading to it (so a fall is
  // short wherever you are), always below the flight paths that land on that
  // ramp, plus a catch-all under everything.
  route.forEach((r, i) => {
    const prevRamp = route[i - 1];
    const last = i === route.length - 1;
    const heading = (Math.atan2(-(r.end.x - r.start.x), -(r.end.z - r.start.z)) * 180) / Math.PI;
    const len = Math.hypot(r.end.x - r.start.x, r.end.z - r.start.z);
    const gapBefore = prevRamp ? Math.hypot(r.start.x - prevRamp.end.x, r.start.z - prevRamp.end.z) : 0;
    const a0 = prevRamp ? -gapBefore - 160 : -800;
    const a1 = len + (last ? L.stage3.endGap + L.stage3.endLength + 400 : 160);
    const ridgeAt = (a: number) => r.start.y + ((r.end.y - r.start.y) * Math.max(0, Math.min(len, a))) / len;
    const pts: V3[] = [];
    for (const a of [a0, a1]) {
      const top = ridgeAt(a) - L.rampHeight - 700;
      for (const side of [-1600, 1600]) {
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
   * Stage start: a checkpoint gate spanning the gap into `first`, and a
   * respawn pad floating above the incoming flight band (so it never blocks
   * the line) over the start of the stage's first ramp.
   */
  function stagePad(stage: number, before: RampPrimitive, first: RampPrimitive, headingDeg: number): void {
    const top = before.end.y + L.padClearance + 48;
    const padCenter = offset(first.start, headingDeg, 128, 160);
    padCenter.y = top;
    const pts = orientedBoxPoints(v3(padCenter.x, top - 24, padCenter.z), 192, 24, 192, headingDeg);
    prims.push({ kind: 'convex', name: `Stage ${stage} pad`, material: 'platform', trim: true, points: pts });
    const spawn = offset(first.start, headingDeg, 112, 64);
    spawn.y = top + 1;
    stages.push({ index: stage, name: `Stage ${stage}`, spawn, yaw: headingDeg, pitch: -14 });
    // Gate: from the previous ramp's end to just past the new ramp's start.
    const gapLen = Math.hypot(first.start.x - before.end.x, first.start.z - before.end.z);
    const gateCenter = offset(first.start, headingDeg, 64, -gapLen / 2 + 48);
    const yLow = first.start.y - L.rampHeight - 200;
    const yHigh = top + 400;
    gateCenter.y = (yLow + yHigh) / 2;
    triggers.push(zone('checkpoint', stage, gateCenter, 520, (yHigh - yLow) / 2, gapLen / 2 + 48, headingDeg));
  }
}

export const BEGINNER_MAP: MapDef = build();

/** Ramps in riding order, for validation tools. */
export function routeOf(map: MapDef): RampPrimitive[] {
  return map.primitives.filter((p): p is RampPrimitive => p.kind === 'ramp' && p.ride !== undefined);
}

