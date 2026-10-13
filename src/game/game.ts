import type { CompiledMap } from '../map/compile';
import type { BoostDef } from '../map/types';
import { hullOverlapsBrush, MoveInput, PlayerController, PlayerState, sweepEnterFraction, Vec3, type MovementConfig } from '../physics';
import { SurfAssist } from './assist';

const DEG = Math.PI / 180;

/** ready: in (or reset to) the start zone. running: timer counting. finished: stopped in the end zone. */
export type RunPhase = 'ready' | 'running' | 'finished';

/** Synchronous notifications; none of them are called per tick unless something happened. */
export interface GameHooks {
  runStarted?(): void;
  /** Reached stage `stage` with the run timer at `time` seconds (NaN if not running). */
  checkpoint?(stage: number, time: number): void;
  finished?(time: number): void;
  /** Fell into a fail volume and was put back; `yaw` and `pitch` (radians) face the way to go. */
  failed?(yaw: number, pitch: number): void;
  /** The run was reset (back in the start zone). */
  reset?(): void;
  landed?(speed: number): void;
  /** Went through a booster; `speed` is the horizontal speed after it. */
  boosted?(speed: number): void;
}

/**
 * The simulation: one player on one compiled map, advanced in fixed ticks,
 * plus the run state (timer, stages, triggers). Pure TypeScript: no DOM and
 * no Three.js, so the whole run is testable headless.
 */
export class Game {
  readonly map: CompiledMap;
  readonly cfg: MovementConfig;
  readonly controller: PlayerController;
  readonly player = new PlayerState();
  /** Filled by the input layer before every {@link step}. */
  readonly input = new MoveInput();
  /** Eye position at the previous and the current tick, for interpolation. */
  readonly prevEye = new Vec3();
  readonly curEye = new Vec3();
  readonly dt: number = 0;
  readonly stageCount: number = 1;
  hooks: GameHooks = {};

  tickCount = 0;
  /** Stage the player respawns at (last checkpoint reached). */
  stage = 1;
  phase: RunPhase = 'ready';
  /** Simulation time (s) the run started, measured at the sub-tick zone exit. */
  runStart = 0;
  /** Final time (s) once finished. */
  finishTime = 0;
  /** Run time at which each stage was reached (index = stage - 1). */
  readonly splits: number[];
  /** Incremented on every teleport so views can drop interpolation. */
  teleportCount = 0;
  /** Highest horizontal speed (u/s) reached in the current run. */
  topSpeed = 0;
  /** The surf assist rewrites the movement keys on ramp faces and in the air (see SurfAssist). */
  assistEnabled = false;
  /** A fall puts you back on the ramp you fell from, at the speed you had on it. */
  rampRespawns = false;
  readonly assist: SurfAssist;

  private readonly inside: boolean[];
  private readonly prevPos = new Vec3();
  private readonly startTriggerIndices: number[];
  private readonly failIndices: number[];

  constructor(map: CompiledMap, cfg: MovementConfig) {
    this.map = map;
    this.cfg = cfg;
    this.dt = 1 / cfg.tickrate;
    this.controller = new PlayerController(map.world, cfg);
    this.assist = new SurfAssist(map.def);
    this.stageCount = Math.max(1, ...map.def.stages.map((s) => s.index));
    this.splits = new Array<number>(this.stageCount).fill(NaN);
    this.inside = map.triggers.map(() => false);
    this.startTriggerIndices = map.triggers.flatMap((t, i) => (t.def.kind === 'start' ? [i] : []));
    this.failIndices = map.triggers.flatMap((t, i) => (t.def.kind === 'fail' ? [i] : []));
    this.respawn(1);
  }

  /** Simulation clock in seconds. */
  get time(): number {
    return this.tickCount * this.dt;
  }

  /** Run timer in seconds; `alpha` (0..1) interpolates within the current tick for display. */
  runTime(alpha = 0): number {
    if (this.phase === 'ready') return 0;
    if (this.phase === 'finished') return this.finishTime;
    return Math.max(0, (this.tickCount + alpha) * this.dt - this.runStart);
  }

  /** Spawn yaw of a stage in radians. */
  spawnYaw(stage: number): number {
    return this.stageDef(stage).yaw * DEG;
  }

  /** Spawn pitch of a stage in radians. */
  spawnPitch(stage: number): number {
    return (this.stageDef(stage).pitch ?? 0) * DEG;
  }

  private stageDef(stage: number) {
    return this.map.def.stages.find((st) => st.index === stage) ?? this.map.def.stages[0];
  }

  /** Restarts the whole run from the start zone. */
  restartRun(): void {
    this.respawn(1);
  }

  /** Teleports to the start of `stage` with zero velocity. */
  respawn(stage: number): void {
    const s = this.stageDef(stage);
    this.stage = s.index;
    this.assist.forget();
    this.place(s.spawn.x, s.spawn.y, s.spawn.z);
    if (this.isInStartZone()) this.resetRun();
  }

  /**
   * Respawn on the last ramp ridden, a little way down it and in the middle
   * of the face it was ridden on, moving along it at the speed the player
   * first had on it.
   */
  private respawnOnRamp(): void {
    const a = this.assist;
    const r = a.ramps;
    const i = a.lastRamp;
    const hw = r.halfWidth[i];
    const along = Math.min(320, r.length[i] * 0.3);
    const lane = 0.45 * hw * a.lastSide;
    const x = r.startX[i] + r.dirX[i] * along - r.dirZ[i] * lane;
    const z = r.startZ[i] + r.dirZ[i] * along + r.dirX[i] * lane;
    // Just clear of the face: the hull's inner bottom edge reaches up to 23
    // units nearer the ridge than its centre (diagonal ramps), and its back
    // edge sits where a descending ridge is a little higher.
    const y = r.ridgeY(i, along - 24) - (r.height[i] / hw) * (Math.abs(lane) - 24) + 4;
    this.place(x, y, z);
    const s = a.lastSpeed;
    this.player.vel.set(r.dirX[i] * s, -r.slope[i] * s, r.dirZ[i] * s);
  }

  /** Teleports the player at rest and re-evaluates zone membership without firing events. */
  private place(x: number, y: number, z: number): void {
    this.controller.teleport(this.player, x, y, z);
    this.curEye.set(this.player.pos.x, this.player.pos.y + this.player.eyeOffset, this.player.pos.z);
    this.prevEye.copy(this.curEye);
    this.prevPos.copy(this.player.pos);
    this.teleportCount++;
    const mins = this.controller.mins(this.player);
    const maxs = this.controller.maxs(this.player);
    this.map.triggers.forEach((t, i) => {
      this.inside[i] = hullOverlapsBrush(t.brush, this.player.pos, mins, maxs);
    });
  }

  private isInStartZone(): boolean {
    return this.startTriggerIndices.some((i) => this.inside[i]);
  }

  private resetRun(): void {
    const wasReset = this.phase === 'ready';
    this.phase = 'ready';
    this.stage = 1;
    this.runStart = 0;
    this.finishTime = 0;
    this.topSpeed = 0;
    this.splits.fill(NaN);
    if (!wasReset) this.hooks.reset?.();
  }

  /** Advances one fixed tick using {@link input}. */
  step(): void {
    const p = this.player;
    this.prevEye.copy(this.curEye);
    this.prevPos.copy(p.pos);
    if (this.assistEnabled) this.assist.steer(p, this.input);
    this.controller.tick(p, this.input);
    this.assist.observe(p, this.cfg.groundNormalMinY);
    this.tickCount++;
    this.curEye.set(p.pos.x, p.pos.y + p.eyeOffset, p.pos.z);
    if (p.landed) this.hooks.landed?.(p.landingSpeed);
    this.updateTriggers();
    if (this.phase === 'running') {
      const speed = p.vel.horizontalLength();
      if (speed > this.topSpeed) this.topSpeed = speed;
    }
  }

  private updateTriggers(): void {
    const p = this.player;
    const mins = this.controller.mins(p);
    const maxs = this.controller.maxs(p);
    const triggers = this.map.triggers;
    const tickStart = (this.tickCount - 1) * this.dt;
    // Bounds of the hull swept over this tick: triggers outside them can be
    // neither overlapped nor entered, which rejects almost all of them cheaply.
    const a = this.prevPos;
    const b = p.pos;
    const lx = (a.x < b.x ? a.x : b.x) + mins.x, hx = (a.x > b.x ? a.x : b.x) + maxs.x;
    const ly = (a.y < b.y ? a.y : b.y) + mins.y, hy = (a.y > b.y ? a.y : b.y) + maxs.y;
    const lz = (a.z < b.z ? a.z : b.z) + mins.z, hz = (a.z > b.z ? a.z : b.z) + maxs.z;

    for (let i = 0; i < triggers.length; i++) {
      const t = triggers[i];
      const tb = t.brush;
      const near = tb.maxs.x >= lx && tb.mins.x <= hx && tb.maxs.y >= ly && tb.mins.y <= hy && tb.maxs.z >= lz && tb.mins.z <= hz;
      const was = this.inside[i];
      if (!near && !was) continue;
      const now = near && hullOverlapsBrush(tb, p.pos, mins, maxs);
      this.inside[i] = now;
      switch (t.def.kind) {
        case 'start':
          if (now) {
            if (this.phase !== 'ready') this.resetRun();
          } else if (was && this.phase === 'ready') {
            // Left the start zone: the run starts at the sub-tick exit time.
            const back = sweepEnterFraction(t.brush, p.pos, this.prevPos, mins, maxs);
            const f = back < 0 ? 0 : 1 - back;
            this.phase = 'running';
            this.runStart = tickStart + f * this.dt;
            this.splits[0] = 0;
            this.hooks.runStarted?.();
          }
          break;
        case 'checkpoint': {
          if (was || t.def.stage <= this.stage) break;
          // Entered this tick, possibly passing straight through a thin gate.
          const f = sweepEnterFraction(t.brush, this.prevPos, p.pos, mins, maxs);
          if (!now && f < 0) break;
          this.stage = t.def.stage;
          const time = this.phase === 'running' ? tickStart + Math.max(0, f) * this.dt - this.runStart : NaN;
          if (this.phase === 'running') this.splits[t.def.stage - 1] = time;
          this.hooks.checkpoint?.(t.def.stage, time);
          break;
        }
        case 'end': {
          if (was || this.phase !== 'running') break;
          const f = sweepEnterFraction(t.brush, this.prevPos, p.pos, mins, maxs);
          if (!now && f < 0) break;
          this.phase = 'finished';
          this.finishTime = tickStart + Math.max(0, f) * this.dt - this.runStart;
          this.hooks.finished?.(this.finishTime);
          break;
        }
        case 'boost': {
          if (was) break;
          // Entered this tick, possibly flying straight through a thin gate.
          if (!now && sweepEnterFraction(t.brush, this.prevPos, p.pos, mins, maxs) < 0) break;
          this.boost(t.def.boost);
          break;
        }
        case 'fail':
          break;
      }
    }

    // Fail volumes last, from the overlap flags computed above.
    for (let i = 0; i < this.failIndices.length; i++) {
      if (this.inside[this.failIndices[i]]) {
        const a = this.assist;
        // Back on the ramp you fell from, unless you just fell from it again.
        if (this.rampRespawns && a.lastRamp >= 0 && a.falls === 0) {
          a.falls++;
          this.respawnOnRamp();
          this.hooks.failed?.(a.ramps.heading[a.lastRamp], -8 * DEG);
        } else {
          this.respawn(this.stage);
          this.hooks.failed?.(this.spawnYaw(this.stage), this.spawnPitch(this.stage));
        }
        return;
      }
    }
  }

  /** Applies a booster: along-heading speed becomes max(along + add, min). Silent if it changes nothing. */
  private boost(b: BoostDef | undefined): void {
    if (!b) return;
    const v = this.player.vel;
    const h = b.heading * DEG;
    const fx = -Math.sin(h);
    const fz = -Math.cos(h);
    const along = v.x * fx + v.z * fz;
    const gain = Math.max(along + b.add, b.min) - along;
    const lift = b.up !== undefined && v.y < b.up;
    if (gain <= 0 && !lift) return;
    if (gain > 0) {
      // Within sv_maxvelocity, as the movement code would clamp it next tick.
      const m = this.cfg.maxVelocity;
      v.x = Math.max(-m, Math.min(m, v.x + fx * gain));
      v.z = Math.max(-m, Math.min(m, v.z + fz * gain));
    }
    if (lift) {
      v.y = b.up as number;
      this.player.onGround = false;
    }
    this.hooks.boosted?.(v.horizontalLength());
  }

  /** Interpolated eye position between the last two ticks. */
  eye(alpha: number, out: Vec3): Vec3 {
    const a = this.prevEye;
    const b = this.curEye;
    return out.set(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha);
  }
}
