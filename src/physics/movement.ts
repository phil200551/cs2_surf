import type { MovementConfig } from './config';
import { Vec3, cross, dot } from './vec3';
import { CollisionWorld, Penetration, TraceResult } from './world';

/** Mutable per-player simulation state. Positions are the feet centre. */
export class PlayerState {
  readonly pos = new Vec3();
  readonly vel = new Vec3();
  onGround = false;
  ducked = false;
  /** Current eye height above `pos` (eases while ducking on the ground). */
  eyeOffset = 64;
  /** Ground plane normal while grounded. */
  readonly groundNormal = new Vec3();
  /** Most recent plane a slide move was stopped by. */
  readonly lastHitNormal = new Vec3();
  /** Something stopped the slide move during the last tick. */
  touched = false;
  /** Jumped during the last tick. */
  jumped = false;
  /** Became grounded during the last tick. */
  landed = false;
  /** Downward speed at the moment of landing (for audio). */
  landingSpeed = 0;
  /** Jump state of the previous tick (only used when auto-bhop is off). */
  jumpHeld = false;
  /** Ticks simulated since the last reset. */
  tick = 0;

  copyFrom(o: PlayerState): void {
    this.pos.copy(o.pos);
    this.vel.copy(o.vel);
    this.onGround = o.onGround;
    this.ducked = o.ducked;
    this.eyeOffset = o.eyeOffset;
    this.groundNormal.copy(o.groundNormal);
    this.lastHitNormal.copy(o.lastHitNormal);
    this.touched = o.touched;
    this.jumped = o.jumped;
    this.landed = o.landed;
    this.landingSpeed = o.landingSpeed;
    this.jumpHeld = o.jumpHeld;
    this.tick = o.tick;
  }
}

/**
 * One tick of player intent. `yaw` is in radians: 0 looks down -Z, positive
 * turns left (counter-clockwise seen from above), matching a Three.js camera
 * with rotation order 'YXZ'.
 */
export class MoveInput {
  /** +1 forward (W), -1 back (S). */
  forward = 0;
  /** +1 right (D), -1 left (A). */
  side = 0;
  jump = false;
  duck = false;
  yaw = 0;

  clear(): void {
    this.forward = 0;
    this.side = 0;
    this.jump = false;
    this.duck = false;
  }
}

/** A plane we are "already parallel to or leaving" if v.n >= -this * max(1, |v|). */
const PARALLEL_TOLERANCE = 1e-4;
/** Normals closer than this dot product are treated as the same plane. */
const SAME_PLANE_DOT = 0.99999;
/** How far to push off a plane that blocked us spuriously. */
const NUDGE_DISTANCE = 0.03125;
/** Nudge retries allowed per slide move. */
const MAX_NUDGES = 3;
/** How far off the surface being ridden a blocked move is retraced. */
const RETRACE_LIFT = 0.2;
/** Lifted retraces allowed per slide move. */
const MAX_RETRACES = 2;

/**
 * Port of Source's CGameMovement::FullWalkMove for a walking player, with
 * CS2 / surf-server rules. There is deliberately no notion of "surfing" in
 * here: a steep plane is simply not ground, and gravity plus velocity
 * clipping plus air acceleration produce the surf.
 */
export class PlayerController {
  readonly world: CollisionWorld;
  readonly cfg: MovementConfig;
  readonly dt: number;

  readonly standMins: Vec3;
  readonly standMaxs: Vec3;
  readonly duckMins: Vec3;
  readonly duckMaxs: Vec3;

  // Scratch state: nothing below allocates per tick.
  private readonly tr = new TraceResult();
  private readonly tr2 = new TraceResult();
  private readonly tr3 = new TraceResult();
  /** Plane the player is sliding on, used to retrace past sub-unit ledges. */
  private readonly ride = new Vec3();
  private hasRide = false;
  private touchedLastTick = false;
  private readonly lifted = new Vec3();
  private readonly pen = new Penetration();
  private readonly wishdir = new Vec3();
  private wishspeed = 0;
  private readonly end = new Vec3();
  private readonly tmp = new Vec3();
  private readonly primal = new Vec3();
  private readonly original = new Vec3();
  private readonly dir = new Vec3();
  private readonly planes: Vec3[];
  private readonly stepStartPos = new Vec3();
  private readonly stepStartVel = new Vec3();
  private readonly downPos = new Vec3();
  private readonly downVel = new Vec3();

  constructor(world: CollisionWorld, cfg: MovementConfig) {
    this.world = world;
    this.cfg = cfg;
    this.dt = 1 / cfg.tickrate;
    const w = cfg.hullHalfWidth;
    this.standMins = new Vec3(-w, 0, -w);
    this.standMaxs = new Vec3(w, cfg.hullHeight, w);
    this.duckMins = new Vec3(-w, 0, -w);
    this.duckMaxs = new Vec3(w, cfg.duckHullHeight, w);
    this.planes = [];
    for (let i = 0; i < cfg.maxClipPlanes; i++) this.planes.push(new Vec3());
  }

  mins(s: PlayerState): Vec3 {
    return s.ducked ? this.duckMins : this.standMins;
  }

  maxs(s: PlayerState): Vec3 {
    return s.ducked ? this.duckMaxs : this.standMaxs;
  }

  /** Places the player at `pos` standing, at rest. */
  teleport(s: PlayerState, x: number, y: number, z: number): void {
    s.pos.set(x, y, z);
    s.vel.zero();
    s.onGround = false;
    s.ducked = false;
    s.eyeOffset = this.cfg.eyeHeight;
    s.touched = false;
    s.jumped = false;
    s.landed = false;
    s.landingSpeed = 0;
    s.lastHitNormal.zero();
    s.groundNormal.zero();
    this.unstick(s);
    this.categorizePosition(s);
  }

  /** Sweeps the player's current hull. */
  trace(s: PlayerState, start: Vec3, end: Vec3, out: TraceResult): TraceResult {
    return this.world.traceBox(start, end, this.mins(s), this.maxs(s), out);
  }

  /** Advances the player by one fixed tick. */
  tick(s: PlayerState, input: MoveInput): void {
    const cfg = this.cfg;
    const dt = this.dt;
    const wasOnGround = s.onGround;
    this.touchedLastTick = s.touched;
    s.touched = false;
    s.jumped = false;
    s.landed = false;
    s.tick++;

    this.unstick(s);
    this.handleDuck(s, input);
    this.computeWish(s, input);

    // 2. First half of gravity.
    s.vel.y -= cfg.gravity * 0.5 * dt;
    this.checkVelocity(s);

    // 3. Jump before friction so bunny hops keep their speed.
    if (s.onGround && input.jump && (cfg.autoBhop || !s.jumpHeld)) {
      s.vel.y = cfg.jumpVelocity;
      s.onGround = false;
      s.jumped = true;
    }
    s.jumpHeld = input.jump;

    // 4. Move.
    const fallSpeed = -s.vel.y;
    if (s.onGround) {
      s.vel.y = 0;
      this.friction(s);
      this.checkVelocity(s);
      this.walkMove(s);
    } else {
      this.checkVelocity(s);
      this.airMove(s);
    }

    // 5. Re-check ground.
    this.categorizePosition(s);
    this.checkVelocity(s);

    // 6. Second half of gravity; no downward velocity on the ground.
    s.vel.y -= cfg.gravity * 0.5 * dt;
    if (s.onGround) s.vel.y = 0;

    // 7. Clamp.
    this.checkVelocity(s);

    if (!wasOnGround && s.onGround) {
      s.landed = true;
      s.landingSpeed = Math.max(0, fallSpeed);
    }
  }

  private computeWish(s: PlayerState, input: MoveInput): void {
    const f = input.forward > 0 ? 1 : input.forward < 0 ? -1 : 0;
    const r = input.side > 0 ? 1 : input.side < 0 ? -1 : 0;
    const sy = Math.sin(input.yaw);
    const cy = Math.cos(input.yaw);
    // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
    const wx = -sy * f + cy * r;
    const wz = -cy * f - sy * r;
    const len = Math.sqrt(wx * wx + wz * wz);
    if (len > 1e-9) {
      this.wishdir.set(wx / len, 0, wz / len);
      this.wishspeed = this.cfg.maxSpeed * (s.ducked ? this.cfg.duckSpeedMultiplier : 1);
    } else {
      this.wishdir.zero();
      this.wishspeed = 0;
    }
  }

  private handleDuck(s: PlayerState, input: MoveInput): void {
    const cfg = this.cfg;
    const delta = cfg.hullHeight - cfg.duckHullHeight;
    if (input.duck && !s.ducked) {
      s.ducked = true;
      if (!s.onGround) {
        // In the air the feet tuck up: the top of the hull and the eye stay put.
        s.pos.y += delta;
        s.eyeOffset -= delta;
      }
    } else if (!input.duck && s.ducked) {
      if (s.onGround) {
        if (!this.world.findPenetration(s.pos, this.standMins, this.standMaxs, this.pen)) s.ducked = false;
      } else {
        this.tmp.set(s.pos.x, s.pos.y - delta, s.pos.z);
        if (!this.world.findPenetration(this.tmp, this.standMins, this.standMaxs, this.pen)) {
          s.ducked = false;
          s.pos.y -= delta;
          s.eyeOffset += delta;
        }
      }
    }
    const target = s.ducked ? cfg.duckEyeHeight : cfg.eyeHeight;
    const step = cfg.duckViewSpeed * this.dt;
    if (s.eyeOffset < target) s.eyeOffset = Math.min(target, s.eyeOffset + step);
    else if (s.eyeOffset > target) s.eyeOffset = Math.max(target, s.eyeOffset - step);
  }

  private checkVelocity(s: PlayerState): void {
    const m = this.cfg.maxVelocity;
    const v = s.vel;
    if (!Number.isFinite(v.x)) v.x = 0;
    if (!Number.isFinite(v.y)) v.y = 0;
    if (!Number.isFinite(v.z)) v.z = 0;
    if (v.x > m) v.x = m; else if (v.x < -m) v.x = -m;
    if (v.y > m) v.y = m; else if (v.y < -m) v.y = -m;
    if (v.z > m) v.z = m; else if (v.z < -m) v.z = -m;
  }

  private friction(s: PlayerState): void {
    const v = s.vel;
    const speed = v.length();
    if (speed < 0.1) return;
    const control = speed < this.cfg.stopSpeed ? this.cfg.stopSpeed : speed;
    const drop = control * this.cfg.friction * this.dt;
    let newspeed = speed - drop;
    if (newspeed < 0) newspeed = 0;
    if (newspeed !== speed) v.scale(newspeed / speed);
  }

  private accelerate(s: PlayerState, wishspeed: number, accel: number): void {
    const currentspeed = dot(s.vel, this.wishdir);
    const addspeed = wishspeed - currentspeed;
    if (addspeed <= 0) return;
    let accelspeed = accel * this.dt * wishspeed;
    if (accelspeed > addspeed) accelspeed = addspeed;
    s.vel.addScaled(this.wishdir, accelspeed);
  }

  /**
   * The 30 u/s cap applies only to the `add` term; the acceleration term
   * uses the full wish speed. This asymmetry is what makes air strafing and
   * surfing work. Do not "fix" it.
   */
  private airAccelerate(s: PlayerState, wishspeed: number, accel: number): void {
    const wishspd = wishspeed > this.cfg.airSpeedCap ? this.cfg.airSpeedCap : wishspeed;
    const currentspeed = dot(s.vel, this.wishdir);
    const addspeed = wishspd - currentspeed;
    if (addspeed <= 0) return;
    let accelspeed = accel * wishspeed * this.dt;
    if (accelspeed > addspeed) accelspeed = addspeed;
    s.vel.addScaled(this.wishdir, accelspeed);
  }

  private airMove(s: PlayerState): void {
    if (this.wishspeed > 0) this.airAccelerate(s, this.wishspeed, this.cfg.airAccelerate);
    this.tryPlayerMove(s);
  }

  private walkMove(s: PlayerState): void {
    const v = s.vel;
    v.y = 0;
    if (this.wishspeed > 0) this.accelerate(s, this.wishspeed, this.cfg.accelerate);
    v.y = 0;
    if (v.length() < 1) {
      v.zero();
      return;
    }
    const end = this.end.set(s.pos.x + v.x * this.dt, s.pos.y, s.pos.z + v.z * this.dt);
    const tr = this.trace(s, s.pos, end, this.tr);
    if (tr.fraction === 1 && !tr.startSolid) {
      s.pos.copy(tr.endPos);
      this.stayOnGround(s);
      return;
    }
    this.stepMove(s);
    this.stayOnGround(s);
  }

  /** Port of CGameMovement::StepMove: slide on the ground and one step up, keep the farther. */
  private stepMove(s: PlayerState): void {
    const cfg = this.cfg;
    const startPos = this.stepStartPos.copy(s.pos);
    const startVel = this.stepStartVel.copy(s.vel);

    this.tryPlayerMove(s);
    this.downPos.copy(s.pos);
    this.downVel.copy(s.vel);

    s.pos.copy(startPos);
    s.vel.copy(startVel);

    this.end.set(s.pos.x, s.pos.y + cfg.stepHeight + cfg.distEpsilon, s.pos.z);
    let tr = this.trace(s, s.pos, this.end, this.tr);
    if (!tr.startSolid && !tr.allSolid) s.pos.copy(tr.endPos);

    this.tryPlayerMove(s);

    this.end.set(s.pos.x, s.pos.y - cfg.stepHeight - cfg.distEpsilon, s.pos.z);
    tr = this.trace(s, s.pos, this.end, this.tr);
    if (tr.normal.y < cfg.groundNormalMinY) {
      s.pos.copy(this.downPos);
      s.vel.copy(this.downVel);
      return;
    }
    if (!tr.startSolid && !tr.allSolid) s.pos.copy(tr.endPos);

    const dxd = this.downPos.x - startPos.x;
    const dzd = this.downPos.z - startPos.z;
    const dxu = s.pos.x - startPos.x;
    const dzu = s.pos.z - startPos.z;
    if (dxd * dxd + dzd * dzd > dxu * dxu + dzu * dzu) {
      s.pos.copy(this.downPos);
      s.vel.copy(this.downVel);
    } else {
      s.vel.y = this.downVel.y;
    }
  }

  /** Port of CGameMovement::StayOnGround: keeps a walking player glued to walkable slopes. */
  private stayOnGround(s: PlayerState): void {
    const cfg = this.cfg;
    this.end.set(s.pos.x, s.pos.y + 2, s.pos.z);
    let tr = this.trace(s, s.pos, this.end, this.tr);
    this.tmp.copy(tr.endPos);
    this.end.set(s.pos.x, s.pos.y - cfg.stepHeight, s.pos.z);
    tr = this.trace(s, this.tmp, this.end, this.tr);
    if (tr.fraction > 0 && tr.fraction < 1 && !tr.startSolid && tr.normal.y >= cfg.groundNormalMinY) {
      if (Math.abs(s.pos.y - tr.endPos.y) > 0.5 / 32) s.pos.copy(tr.endPos);
    }
  }

  /** Clip `vin` against plane `n` into `out` (overbounce 1). `out` may alias `vin`. */
  private clipVelocity(vin: Vec3, n: Vec3, out: Vec3): void {
    const backoff = dot(vin, n);
    out.x = vin.x - n.x * backoff;
    out.y = vin.y - n.y * backoff;
    out.z = vin.z - n.z * backoff;
    // Iterate once to make sure we aren't still moving through the plane.
    const adjust = dot(out, n);
    if (adjust < 0) out.addScaled(n, -adjust);
  }

  /**
   * Port of CGameMovement::TryPlayerMove (the slide move), plus the ramp-bug
   * fix: a block at fraction 0 by a plane the velocity is already parallel
   * to or leaving is a precision artefact (typically a seam between two
   * coplanar brushes), so we nudge off the plane and retry instead of
   * clipping, which would otherwise feed a degenerate crease and stop us.
   */
  private tryPlayerMove(s: PlayerState): void {
    const cfg = this.cfg;
    const v = s.vel;
    const planes = this.planes;
    const primal = this.primal.copy(v);
    const original = this.original.copy(v);
    let numplanes = 0;
    let allFraction = 0;
    let timeLeft = this.dt;
    let nudges = 0;
    let retraces = 0;
    if (s.onGround) {
      this.ride.copy(s.groundNormal);
      this.hasRide = true;
    } else if (this.touchedLastTick) {
      this.ride.copy(s.lastHitNormal);
      this.hasRide = true;
    } else {
      this.hasRide = false;
    }

    for (let bump = 0; bump < cfg.maxBumps; bump++) {
      const speed = v.length();
      if (speed === 0) break;

      this.end.set(s.pos.x + v.x * timeLeft, s.pos.y + v.y * timeLeft, s.pos.z + v.z * timeLeft);
      const tr = this.trace(s, s.pos, this.end, this.tr);

      if (tr.allSolid) {
        if (nudges < MAX_NUDGES && this.unstick(s)) {
          nudges++;
          bump--;
          continue;
        }
        v.zero();
        return;
      }

      if (tr.fraction === 0 && nudges < MAX_NUDGES) {
        const into = dot(v, tr.normal);
        let samePlane = false;
        for (let i = 0; i < numplanes; i++) {
          if (dot(planes[i], tr.normal) > SAME_PLANE_DOT) {
            samePlane = true;
            break;
          }
        }
        if ((into >= -PARALLEL_TOLERANCE * Math.max(1, speed) || samePlane) && this.nudge(s, tr.normal)) {
          nudges++;
          bump--;
          continue;
        }
      }

      // Blocked by something other than the surface we are sliding on: a
      // misaligned neighbouring brush can leave a ledge far smaller than a
      // unit at a seam. Retrace from slightly off the ridden surface and take
      // that path if it gets farther.
      if (tr.fraction < 1 && this.hasRide && retraces < MAX_RETRACES && dot(tr.normal, this.ride) < SAME_PLANE_DOT) {
        retraces++;
        this.retraceLifted(s, timeLeft, tr);
      }

      allFraction += tr.fraction;
      if (tr.fraction > 0) {
        s.pos.copy(tr.endPos);
        original.copy(v);
        numplanes = 0;
      }
      if (tr.fraction === 1) break;

      s.touched = true;
      s.lastHitNormal.copy(tr.normal);
      timeLeft -= timeLeft * tr.fraction;

      if (numplanes >= cfg.maxClipPlanes) {
        v.zero();
        break;
      }

      // Never store the same plane twice: two (near-)identical planes would
      // make a zero-length crease below.
      let dup = -1;
      for (let i = 0; i < numplanes; i++) {
        if (dot(planes[i], tr.normal) > SAME_PLANE_DOT) {
          dup = i;
          break;
        }
      }
      if (dup >= 0) {
        this.clipVelocity(v, tr.normal, v);
        continue;
      }
      planes[numplanes++].copy(tr.normal);
      this.ride.copy(tr.normal);
      this.hasRide = true;

      if (numplanes === 1 && !s.onGround) {
        // First impact in the air: plain clip (sv_bounce 0).
        this.clipVelocity(original, planes[0], v);
        original.copy(v);
      } else {
        let i = 0;
        for (; i < numplanes; i++) {
          this.clipVelocity(original, planes[i], v);
          let j = 0;
          for (; j < numplanes; j++) {
            if (j !== i && dot(v, planes[j]) < 0) break;
          }
          if (j === numplanes) break;
        }
        if (i === numplanes) {
          // Slide along the crease of the two planes.
          if (numplanes !== 2) {
            v.zero();
            break;
          }
          cross(planes[0], planes[1], this.dir);
          if (this.dir.normalize() === 0) {
            v.zero();
            break;
          }
          const d = dot(this.dir, v);
          v.copy(this.dir).scale(d);
        }
        // Moving against the original direction: stop dead to avoid
        // oscillating in sloped corners.
        if (dot(v, primal) <= 0) {
          v.zero();
          break;
        }
      }
    }

    if (allFraction === 0) v.zero();
  }

  /**
   * Retraces the remaining move from RETRACE_LIFT off the ridden plane. If
   * that gets farther than `tr`, moves the player to the lifted start and
   * replaces `tr` with the new result.
   */
  private retraceLifted(s: PlayerState, timeLeft: number, tr: TraceResult): boolean {
    const r = this.ride;
    const lifted = this.lifted.set(s.pos.x + r.x * RETRACE_LIFT, s.pos.y + r.y * RETRACE_LIFT, s.pos.z + r.z * RETRACE_LIFT);
    const up = this.trace(s, s.pos, lifted, this.tr2);
    if (up.fraction < 1 || up.startSolid) return false;
    const v = s.vel;
    this.end.set(lifted.x + v.x * timeLeft, lifted.y + v.y * timeLeft, lifted.z + v.z * timeLeft);
    const re = this.trace(s, lifted, this.end, this.tr3);
    if (re.startSolid || re.allSolid || re.fraction <= tr.fraction + 1e-4) return false;
    s.pos.copy(lifted);
    tr.copy(re);
    return true;
  }

  /** Pushes the player `NUDGE_DISTANCE` along `n` if that space is free. */
  private nudge(s: PlayerState, n: Vec3): boolean {
    this.tmp.set(s.pos.x + n.x * NUDGE_DISTANCE, s.pos.y + n.y * NUDGE_DISTANCE, s.pos.z + n.z * NUDGE_DISTANCE);
    const tr = this.trace(s, s.pos, this.tmp, this.tr2);
    if (tr.allSolid || tr.fraction === 0) return false;
    s.pos.copy(tr.endPos);
    return true;
  }

  /**
   * If the hull is embedded in a brush, push it out along the shallowest
   * plane (a smarter CheckStuck). Returns true if the player was moved.
   */
  unstick(s: PlayerState): boolean {
    let moved = false;
    for (let i = 0; i < 4; i++) {
      if (!this.world.findPenetration(s.pos, this.mins(s), this.maxs(s), this.pen)) return moved;
      s.pos.addScaled(this.pen.normal, this.pen.depth + this.cfg.distEpsilon);
      moved = true;
    }
    return moved;
  }

  /** Port of CategorizePosition (ground only; there is no water). */
  categorizePosition(s: PlayerState): void {
    const cfg = this.cfg;
    if (s.vel.y > cfg.nonJumpVelocity) {
      s.onGround = false;
      return;
    }
    this.end.set(s.pos.x, s.pos.y - cfg.groundTraceDistance, s.pos.z);
    const tr = this.trace(s, s.pos, this.end, this.tr);
    if (tr.fraction < 1 && !tr.allSolid && tr.normal.y >= cfg.groundNormalMinY) {
      s.onGround = true;
      s.groundNormal.copy(tr.normal);
    } else {
      s.onGround = false;
      s.groundNormal.zero();
    }
  }
}
