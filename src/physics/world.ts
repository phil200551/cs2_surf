import type { Brush } from './brush';
import { Vec3, type Vec3Like } from './vec3';

/** Result of a swept-box trace (Source's trace_t, trimmed to what movement needs). */
export class TraceResult {
  /** 0..1 along the sweep where the box stopped. */
  fraction = 1;
  /** start + (end - start) * fraction. */
  readonly endPos = new Vec3();
  /** Normal of the plane that stopped the box (zero if nothing was hit). */
  readonly normal = new Vec3();
  /** Brush that stopped the box, -1 if none. */
  brush = -1;
  /** The box started inside a brush. */
  startSolid = false;
  /** The box was inside a brush for the whole sweep. */
  allSolid = false;

  reset(): void {
    this.fraction = 1;
    this.normal.zero();
    this.brush = -1;
    this.startSolid = false;
    this.allSolid = false;
  }

  copy(o: TraceResult): this {
    this.fraction = o.fraction;
    this.endPos.copy(o.endPos);
    this.normal.copy(o.normal);
    this.brush = o.brush;
    this.startSolid = o.startSolid;
    this.allSolid = o.allSolid;
    return this;
  }

  get hit(): boolean {
    return this.fraction < 1;
  }
}

/** Output of {@link CollisionWorld.findPenetration}. */
export class Penetration {
  brush = -1;
  /** Outward normal of the shallowest plane of the penetrated brush. */
  readonly normal = new Vec3();
  /** How far inside that plane the box is (>= 0). */
  depth = 0;
}

const LEAF_SIZE = 2;
const STACK_SIZE = 128;

/**
 * Static collision world: convex brushes plus a BVH over their bounds.
 *
 * Swept-AABB tracing follows Quake 3 / Source CM_ClipBoxToBrush: every brush
 * plane is pushed out by the box's support along the plane normal (which is a
 * Minkowski sum once bevel planes are present), the trace segment is clipped
 * against the resulting half-spaces, and the box stops `epsilon` short of the
 * entering plane.
 */
export class CollisionWorld {
  readonly brushes: Brush[];
  readonly epsilon: number;

  // Flattened plane data for cache-friendly access.
  private readonly planeData: Float64Array;
  private readonly planeStart: Int32Array;
  private readonly planeCount: Int32Array;
  private readonly brushBounds: Float64Array;

  // BVH: per node bounds (6), and child/leaf info.
  private readonly nodeBounds: Float64Array;
  private readonly nodeLeft: Int32Array; // -1 => leaf
  private readonly nodeRight: Int32Array;
  private readonly nodeStart: Int32Array; // leaf: start into leafBrushes
  private readonly nodeCount: Int32Array; // leaf: number of brushes
  private readonly leafBrushes: Int32Array;
  private nodeTotal = 0;
  private readonly stack = new Int32Array(STACK_SIZE);

  constructor(brushes: Brush[], epsilon = 0.03125) {
    this.brushes = brushes;
    this.epsilon = epsilon;
    let total = 0;
    for (const b of brushes) total += b.numPlanes;
    this.planeData = new Float64Array(total * 4);
    this.planeStart = new Int32Array(brushes.length);
    this.planeCount = new Int32Array(brushes.length);
    this.brushBounds = new Float64Array(brushes.length * 6);
    let offset = 0;
    brushes.forEach((b, i) => {
      b.index = i;
      this.planeStart[i] = offset;
      this.planeCount[i] = b.numPlanes;
      this.planeData.set(b.planes, offset * 4);
      offset += b.numPlanes;
      const bb = this.brushBounds;
      bb[i * 6] = b.mins.x;
      bb[i * 6 + 1] = b.mins.y;
      bb[i * 6 + 2] = b.mins.z;
      bb[i * 6 + 3] = b.maxs.x;
      bb[i * 6 + 4] = b.maxs.y;
      bb[i * 6 + 5] = b.maxs.z;
    });

    const maxNodes = Math.max(1, brushes.length * 2);
    this.nodeBounds = new Float64Array(maxNodes * 6);
    this.nodeLeft = new Int32Array(maxNodes);
    this.nodeRight = new Int32Array(maxNodes);
    this.nodeStart = new Int32Array(maxNodes);
    this.nodeCount = new Int32Array(maxNodes);
    this.leafBrushes = new Int32Array(brushes.length);
    const order = brushes.map((_, i) => i);
    if (brushes.length > 0) this.buildNode(order, 0, order.length);
  }

  private buildNode(order: number[], start: number, end: number): number {
    const node = this.nodeTotal++;
    const bb = this.brushBounds;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = start; i < end; i++) {
      const b = order[i] * 6;
      x0 = Math.min(x0, bb[b]); y0 = Math.min(y0, bb[b + 1]); z0 = Math.min(z0, bb[b + 2]);
      x1 = Math.max(x1, bb[b + 3]); y1 = Math.max(y1, bb[b + 4]); z1 = Math.max(z1, bb[b + 5]);
    }
    const nb = this.nodeBounds;
    nb[node * 6] = x0; nb[node * 6 + 1] = y0; nb[node * 6 + 2] = z0;
    nb[node * 6 + 3] = x1; nb[node * 6 + 4] = y1; nb[node * 6 + 5] = z1;

    if (end - start <= LEAF_SIZE) {
      this.nodeLeft[node] = -1;
      this.nodeRight[node] = -1;
      this.nodeStart[node] = start;
      this.nodeCount[node] = end - start;
      for (let i = start; i < end; i++) this.leafBrushes[i] = order[i];
      return node;
    }
    // Median split along the longest axis of the centroid spread.
    const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const slice = order.slice(start, end).sort((a, b) => bb[a * 6 + axis] + bb[a * 6 + axis + 3] - (bb[b * 6 + axis] + bb[b * 6 + axis + 3]));
    for (let i = start; i < end; i++) order[i] = slice[i - start];
    const mid = (start + end) >> 1;
    this.nodeStart[node] = 0;
    this.nodeCount[node] = 0;
    this.nodeLeft[node] = this.buildNode(order, start, mid);
    this.nodeRight[node] = this.buildNode(order, mid, end);
    return node;
  }

  /**
   * Sweeps the box [mins, maxs] (relative to the origin) from `start` to
   * `end`. Never allocates.
   */
  traceBox(start: Readonly<Vec3Like>, end: Readonly<Vec3Like>, mins: Readonly<Vec3Like>, maxs: Readonly<Vec3Like>, out: TraceResult): TraceResult {
    out.reset();
    if (this.nodeTotal > 0) {
      const pad = this.epsilon * 2;
      const qx0 = Math.min(start.x, end.x) + mins.x - pad;
      const qy0 = Math.min(start.y, end.y) + mins.y - pad;
      const qz0 = Math.min(start.z, end.z) + mins.z - pad;
      const qx1 = Math.max(start.x, end.x) + maxs.x + pad;
      const qy1 = Math.max(start.y, end.y) + maxs.y + pad;
      const qz1 = Math.max(start.z, end.z) + maxs.z + pad;
      const nb = this.nodeBounds;
      const stack = this.stack;
      let sp = 0;
      stack[sp++] = 0;
      while (sp > 0) {
        const node = stack[--sp];
        const o = node * 6;
        if (nb[o] > qx1 || nb[o + 3] < qx0 || nb[o + 1] > qy1 || nb[o + 4] < qy0 || nb[o + 2] > qz1 || nb[o + 5] < qz0) continue;
        const left = this.nodeLeft[node];
        if (left < 0) {
          const s = this.nodeStart[node];
          const c = this.nodeCount[node];
          for (let i = 0; i < c; i++) {
            this.clipBoxToBrush(this.leafBrushes[s + i], start, end, mins, maxs, out);
            if (out.allSolid) break;
          }
          if (out.allSolid) break;
        } else if (sp + 2 <= STACK_SIZE) {
          stack[sp++] = this.nodeRight[node];
          stack[sp++] = left;
        }
      }
    }
    const f = out.fraction;
    out.endPos.x = start.x + (end.x - start.x) * f;
    out.endPos.y = start.y + (end.y - start.y) * f;
    out.endPos.z = start.z + (end.z - start.z) * f;
    return out;
  }

  /**
   * CM_ClipBoxToBrush, with one deliberate change to how DIST_EPSILON is used.
   *
   * Source inflates every plane by epsilon before deciding whether the sweep
   * enters the brush. Offsetting planes is not a true offset of a polytope:
   * at convex edges the inflated planes meet in sharp corners that bulge past
   * the brush. A hull that rides a ramp face at exactly epsilon is then
   * "inside" the bulge of the next segment's end cap and gets stopped by it,
   * which is the classic ramp bug at brush seams.
   *
   * Here the entry test is exact (Cyrus-Beck against the Minkowski sum, which
   * the bevel planes make exact), and only then is the stop point backed off
   * so the hull rests epsilon off the plane it entered through.
   */
  private clipBoxToBrush(b: number, start: Readonly<Vec3Like>, end: Readonly<Vec3Like>, mins: Readonly<Vec3Like>, maxs: Readonly<Vec3Like>, out: TraceResult): void {
    const pd = this.planeData;
    const first = this.planeStart[b];
    const count = this.planeCount[b];
    let enterT = -Infinity;
    let leaveT = Infinity;
    let enterPlane = -1;
    let enterD1 = 0;
    let enterD2 = 0;
    let getOut = false;
    let startOut = false;

    for (let i = 0; i < count; i++) {
      const o = (first + i) * 4;
      const nx = pd[o], ny = pd[o + 1], nz = pd[o + 2];
      // Push the plane out by the box support along its normal.
      const ofs = nx * (nx < 0 ? maxs.x : mins.x) + ny * (ny < 0 ? maxs.y : mins.y) + nz * (nz < 0 ? maxs.z : mins.z);
      const dist = pd[o + 3] - ofs;
      const d1 = start.x * nx + start.y * ny + start.z * nz - dist;
      const d2 = end.x * nx + end.y * ny + end.z * nz - dist;
      // Entirely in front of one plane: the sweep never touches this brush.
      if (d1 > 0 && d2 > 0) return;
      if (d1 > 0) startOut = true;
      if (d2 > 0) getOut = true;
      if (d1 <= 0 && d2 <= 0) continue;
      const t = d1 / (d1 - d2);
      if (d1 > 0) {
        if (t > enterT) {
          enterT = t;
          enterPlane = o;
          enterD1 = d1;
          enterD2 = d2;
        }
      } else if (t < leaveT) {
        leaveT = t;
      }
    }

    if (!startOut) {
      out.startSolid = true;
      if (!getOut) {
        out.allSolid = true;
        out.fraction = 0;
        out.brush = b;
        out.normal.zero();
      }
      return;
    }
    if (enterPlane >= 0 && enterT <= leaveT) {
      let f = (enterD1 - this.epsilon) / (enterD1 - enterD2);
      if (f < 0) f = 0;
      if (f < out.fraction) {
        out.fraction = f;
        out.brush = b;
        out.normal.x = pd[enterPlane];
        out.normal.y = pd[enterPlane + 1];
        out.normal.z = pd[enterPlane + 2];
      }
    }
  }

  /**
   * Finds a brush the box at `pos` is embedded in (all expanded planes have
   * the origin on or behind them) and reports the shallowest way out.
   * Returns false when the box is free. Never allocates.
   */
  findPenetration(pos: Readonly<Vec3Like>, mins: Readonly<Vec3Like>, maxs: Readonly<Vec3Like>, out: Penetration): boolean {
    out.brush = -1;
    if (this.nodeTotal === 0) return false;
    const qx0 = pos.x + mins.x, qy0 = pos.y + mins.y, qz0 = pos.z + mins.z;
    const qx1 = pos.x + maxs.x, qy1 = pos.y + maxs.y, qz1 = pos.z + maxs.z;
    const nb = this.nodeBounds;
    const pd = this.planeData;
    const stack = this.stack;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const node = stack[--sp];
      const o = node * 6;
      if (nb[o] > qx1 || nb[o + 3] < qx0 || nb[o + 1] > qy1 || nb[o + 4] < qy0 || nb[o + 2] > qz1 || nb[o + 5] < qz0) continue;
      const left = this.nodeLeft[node];
      if (left >= 0) {
        if (sp + 2 <= STACK_SIZE) {
          stack[sp++] = this.nodeRight[node];
          stack[sp++] = left;
        }
        continue;
      }
      const s = this.nodeStart[node];
      const c = this.nodeCount[node];
      for (let k = 0; k < c; k++) {
        const b = this.leafBrushes[s + k];
        const first = this.planeStart[b];
        const count = this.planeCount[b];
        let best = -Infinity;
        let bestPlane = -1;
        let inside = true;
        for (let i = 0; i < count; i++) {
          const p = (first + i) * 4;
          const nx = pd[p], ny = pd[p + 1], nz = pd[p + 2];
          const ofs = nx * (nx < 0 ? maxs.x : mins.x) + ny * (ny < 0 ? maxs.y : mins.y) + nz * (nz < 0 ? maxs.z : mins.z);
          const d = pos.x * nx + pos.y * ny + pos.z * nz - (pd[p + 3] - ofs);
          if (d > 0) {
            inside = false;
            break;
          }
          if (d > best) {
            best = d;
            bestPlane = p;
          }
        }
        if (inside && bestPlane >= 0) {
          out.brush = b;
          out.normal.set(pd[bestPlane], pd[bestPlane + 1], pd[bestPlane + 2]);
          out.depth = -best;
          return true;
        }
      }
    }
    return false;
  }
}
