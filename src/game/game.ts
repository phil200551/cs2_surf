import type { CompiledMap } from '../map/compile';
import { hullOverlapsBrush, MoveInput, PlayerController, PlayerState, Vec3, type MovementConfig } from '../physics';

const DEG = Math.PI / 180;

/**
 * The simulation: one player on one compiled map, advanced in fixed ticks.
 * Pure TypeScript (no DOM, no Three.js) so it runs headless in tests.
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
  readonly dt: number;
  tickCount = 0;
  stage = 1;
  /** Incremented on every teleport so views can drop interpolation. */
  teleportCount = 0;

  constructor(map: CompiledMap, cfg: MovementConfig) {
    this.map = map;
    this.cfg = cfg;
    this.dt = 1 / cfg.tickrate;
    this.controller = new PlayerController(map.world, cfg);
    this.respawn(1);
  }

  /** Spawn yaw of a stage in radians. */
  spawnYaw(stage: number): number {
    const s = this.map.def.stages.find((st) => st.index === stage) ?? this.map.def.stages[0];
    return s.yaw * DEG;
  }

  /** Teleports to the start of `stage` with zero velocity. */
  respawn(stage: number): void {
    const s = this.map.def.stages.find((st) => st.index === stage) ?? this.map.def.stages[0];
    this.stage = s.index;
    this.controller.teleport(this.player, s.spawn.x, s.spawn.y, s.spawn.z);
    this.curEye.set(this.player.pos.x, this.player.pos.y + this.player.eyeOffset, this.player.pos.z);
    this.prevEye.copy(this.curEye);
    this.teleportCount++;
  }

  /** Advances one fixed tick using {@link input}. */
  step(): void {
    this.prevEye.copy(this.curEye);
    this.controller.tick(this.player, this.input);
    this.tickCount++;
    const p = this.player;
    this.curEye.set(p.pos.x, p.pos.y + p.eyeOffset, p.pos.z);
    this.checkFail();
  }

  private checkFail(): void {
    const mins = this.controller.mins(this.player);
    const maxs = this.controller.maxs(this.player);
    for (const t of this.map.triggers) {
      if (t.def.kind === 'fail' && hullOverlapsBrush(t.brush, this.player.pos, mins, maxs)) {
        this.respawn(this.stage);
        return;
      }
    }
  }

  /** Interpolated eye position between the last two ticks. */
  eye(alpha: number, out: Vec3): Vec3 {
    const a = this.prevEye;
    const b = this.curEye;
    return out.set(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha);
  }
}
