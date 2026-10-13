import type { MapDef } from '../map/types';
import type { MoveInput, PlayerState } from '../physics';
import { RampIndex } from './ramps';

/**
 * Where on a face (0 at the ridge, 1 at the base) the assist holds a player
 * who isn't strafing: it pushes into the face below HOLD_LOW and eases off it
 * above HOLD_HIGH. The middle is the line the map is validated for.
 */
const HOLD_LOW = 0.56;
const HOLD_HIGH = 0.34;
/**
 * A strafe that would carry the player past these is overridden. They keep
 * well inside the face: climbing or sliding leaves up to ~35 u/s of sideways
 * drift as you leave a ramp, about 45 units over the longest gap.
 */
const SAFE_TOP = 0.26;
const SAFE_BOTTOM = 0.7;
/** In the air above this horizontal speed (u/s), movement keys are ignored. */
const HANDS_OFF_SPEED = 600;

/**
 * The surf assist (Easy difficulty). It never touches the physics: it only
 * rewrites the movement keys (and the yaw they are taken relative to) before
 * each tick.
 *
 * - On a ramp face, movement is always square to the ramp, whatever the view,
 *   so strafing can't bleed speed. With no strafe key held, it holds the
 *   middle of the face; A and D move you up and down the face, but never off
 *   the bottom or over the top. W and S do nothing on a face.
 * - In the air at speed, movement keys are ignored: every gap is built so the
 *   line you leave a ramp on lands on the next one, and an air strafe held
 *   through a long gap can drift you onto the next ridge, or into a strafe that
 *   brakes you.
 *
 * It also remembers the last ramp ridden and the speed you had on it, so a
 * fall can put you back there.
 */
export class SurfAssist {
  readonly ramps: RampIndex;
  /** Ramp face the player rode last tick (-1: none), which face, and how far down it. */
  ramp = -1;
  side = 0;
  depth = 0;
  /** The last ramp ridden, which face, and the horizontal speed on first touching it. */
  lastRamp = -1;
  lastSide = 0;
  lastSpeed = 0;
  /** Falls from `lastRamp` in a row. */
  falls = 0;
  private readonly hit = { side: 0, depth: 0 };

  constructor(map: MapDef) {
    this.ramps = new RampIndex(map);
  }

  /** Forget the last ramp (after a respawn at a stage start). */
  forget(): void {
    this.ramp = -1;
    this.lastRamp = -1;
    this.falls = 0;
  }

  /** After a tick: note the ramp face the player is riding, if any. */
  observe(p: PlayerState, groundNormalMinY: number): void {
    this.ramp = -1;
    if (p.onGround || !p.touched) return;
    const n = p.lastHitNormal;
    if (n.y <= 0.05 || n.y >= groundNormalMinY) return;
    const i = this.ramps.find(p.pos, n.x, n.z, this.hit);
    if (i < 0) return;
    this.ramp = i;
    this.side = this.hit.side;
    this.depth = this.hit.depth;
    if (i !== this.lastRamp) {
      this.lastRamp = i;
      this.lastSide = this.side;
      this.lastSpeed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
      this.falls = 0;
    }
  }

  /** Before a tick: rewrite the movement keys. The view itself is never changed. */
  steer(p: PlayerState, input: MoveInput): void {
    if (p.onGround) return;
    if (this.ramp >= 0) {
      // Looking along the ramp, this strafe key pushes into the face.
      const into = -this.side;
      let s = input.side > 0 ? 1 : input.side < 0 ? -1 : 0;
      if (s === 0) s = this.depth > HOLD_LOW ? into : this.depth < HOLD_HIGH ? -into : 0;
      else if (s === into && this.depth < SAFE_TOP) s = 0;
      else if (s === -into && this.depth > SAFE_BOTTOM) s = into;
      input.yaw = this.ramps.heading[this.ramp];
      input.forward = 0;
      input.side = s;
      return;
    }
    const v = p.vel;
    if (v.x * v.x + v.z * v.z > HANDS_OFF_SPEED * HANDS_OFF_SPEED) {
      input.forward = 0;
      input.side = 0;
    }
  }
}
