import type { MapDef } from '../map/types';
import type { Vec3Like } from '../physics';

const DEFAULT_HALF_WIDTH = 256;
const DEFAULT_HEIGHT = 448;

/**
 * The ridge line of every ramp in a map, for working out which ramp face the
 * player is riding and how far down it they are. Flat arrays, no allocation
 * per query.
 */
export class RampIndex {
  readonly count: number;
  readonly startX: Float64Array;
  readonly startY: Float64Array;
  readonly startZ: Float64Array;
  /** Horizontal unit direction from the ridge's start to its end. */
  readonly dirX: Float64Array;
  readonly dirZ: Float64Array;
  /** Horizontal length of the ridge. */
  readonly length: Float64Array;
  /** Ridge descent per unit of horizontal distance. */
  readonly slope: Float64Array;
  readonly halfWidth: Float64Array;
  readonly height: Float64Array;
  /** Heading in radians (0 = -Z, + turns left), the yaw of looking along the ramp. */
  readonly heading: Float64Array;

  constructor(map: MapDef) {
    const ramps = map.primitives.filter((p) => p.kind === 'ramp');
    const n = ramps.length;
    this.count = n;
    this.startX = new Float64Array(n);
    this.startY = new Float64Array(n);
    this.startZ = new Float64Array(n);
    this.dirX = new Float64Array(n);
    this.dirZ = new Float64Array(n);
    this.length = new Float64Array(n);
    this.slope = new Float64Array(n);
    this.halfWidth = new Float64Array(n);
    this.height = new Float64Array(n);
    this.heading = new Float64Array(n);
    ramps.forEach((r, i) => {
      const dx = r.end.x - r.start.x;
      const dz = r.end.z - r.start.z;
      const len = Math.hypot(dx, dz);
      this.startX[i] = r.start.x;
      this.startY[i] = r.start.y;
      this.startZ[i] = r.start.z;
      this.dirX[i] = dx / len;
      this.dirZ[i] = dz / len;
      this.length[i] = len;
      this.slope[i] = (r.start.y - r.end.y) / len;
      this.halfWidth[i] = r.halfWidth ?? DEFAULT_HALF_WIDTH;
      this.height[i] = r.height ?? DEFAULT_HEIGHT;
      this.heading[i] = Math.atan2(-dx, -dz);
    });
  }

  /** Ridge height of ramp `i` at `along` units from its start (clamped to the ramp). */
  ridgeY(i: number, along: number): number {
    const a = along < 0 ? 0 : along > this.length[i] ? this.length[i] : along;
    return this.startY[i] - this.slope[i] * a;
  }

  /**
   * The ramp whose face the player at `pos` is resting on, given the normal
   * of the face they touched, or -1. `side` receives which face (+1 right of
   * the ridge, -1 left) and `depth` how far down it they are (0 at the ridge,
   * 1 at the base), both through `out`.
   */
  find(pos: Readonly<Vec3Like>, nx: number, nz: number, out: { side: number; depth: number }): number {
    let best = -1;
    let bestErr = Infinity;
    for (let i = 0; i < this.count; i++) {
      const px = pos.x - this.startX[i];
      const pz = pos.z - this.startZ[i];
      const along = px * this.dirX[i] + pz * this.dirZ[i];
      if (along < -64 || along > this.length[i] + 64) continue;
      // Right of the ridge is (-dirZ, dirX); the face's normal points away from the ridge.
      const rx = -this.dirZ[i];
      const rz = this.dirX[i];
      const side = nx * rx + nz * rz >= 0 ? 1 : -1;
      const lateral = (px * rx + pz * rz) * side;
      const hw = this.halfWidth[i];
      if (lateral < -40 || lateral > hw + 64) continue;
      // A hull resting on a 60 degree face has its feet about 28 units above
      // the face line under its centre (its inner bottom edge touches it).
      const k = this.height[i] / hw;
      const faceY = this.ridgeY(i, along) - k * (lateral > 0 ? lateral : 0);
      const err = Math.abs(pos.y - faceY - 28);
      if (err < 140 && err < bestErr) {
        bestErr = err;
        best = i;
        out.side = side;
        out.depth = lateral / hw;
      }
    }
    return best;
  }
}
