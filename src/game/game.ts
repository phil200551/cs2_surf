import type { CompiledMap } from '../map/compile';
import type { BoostDef } from '../map/types';
import { hullOverlapsBrush, MoveInput, PlayerController, PlayerState, sweepEnterFraction, Vec3, type MovementConfig } from '../physics';

const DEG = Math.PI / 180;

/** ready: in (or reset to) the start zone. running: timer counting. finished: stopped in the end zone. */
export type RunPhase = 'ready' | 'running' | 'finished';

/** Synchronous notifications; none of them are called per tick unless something happened. */
export interface GameHooks {
  runStarted?(): void;
  /** Reached stage `stage` with the run timer at `time` seconds (NaN if not running). */
  checkpoint?(stage: number, time: number): void;
  finished?(time: number): void;
  failed?(): void;
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

  private readonly inside: boolean[];
  private readonly prevPos = new Vec3();
  private readonly startTriggerIndices: number[];
  private readonly failIndices: number[];

  constructor(map: CompiledMap, cfg: MovementConfig) {
    this.map = map;
    this.cfg = cfg;
    this.dt = 1 / cfg.tickrate;
    this.controller = new PlayerController(map.world, cfg);
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
    this.controller.teleport(this.player, s.spawn.x, s.spawn.y, s.spawn.z);
    this.curEye.set(this.player.pos.x, this.player.pos.y + this.player.eyeOffset, this.player.pos.z);
    this.prevEye.copy(this.curEye);
    this.prevPos.copy(this.player.pos);
    this.teleportCount++;
    // Re-evaluate zone membership at the new position without firing enter/leave events.
    const mins = this.controller.mins(this.player);
    const maxs = this.controller.maxs(this.player);
    this.map.triggers.forEach((t, i) => {
      this.inside[i] = hullOverlapsBrush(t.brush, this.player.pos, mins, maxs);
    });
    if (this.isInStartZone()) this.resetRun();
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
    this.controller.tick(p, this.input);
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
        this.hooks.failed?.();
        this.respawn(this.stage);
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
