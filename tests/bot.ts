/**
 * A deliberately unskilled surf bot for validating map flow headlessly: it
 * looks straight down each ramp and holds the strafe key into the face it is
 * meant to ride (no air-strafe speed gain), and walks off platforms.
 */
import type { Game } from '../src/game/game';
import { routeOf } from '../src/map/beginner';
import type { MapDef, RampPrimitive } from '../src/map/types';

export interface RampInfo {
  ramp: RampPrimitive;
  heading: number;
  dirX: number;
  dirZ: number;
  rightX: number;
  rightZ: number;
  length: number;
}

export function rampInfo(r: RampPrimitive): RampInfo {
  const dx = r.end.x - r.start.x;
  const dz = r.end.z - r.start.z;
  const length = Math.hypot(dx, dz);
  const dirX = dx / length;
  const dirZ = dz / length;
  return { ramp: r, heading: Math.atan2(-dx, -dz), dirX, dirZ, rightX: -dirZ, rightZ: dirX, length };
}

/** Distance along a ramp's axis and to the right of its ridge for a point. */
export function rampCoords(info: RampInfo, x: number, z: number): { along: number; lateral: number } {
  const px = x - info.ramp.start.x;
  const pz = z - info.ramp.start.z;
  return { along: px * info.dirX + pz * info.dirZ, lateral: px * info.rightX + pz * info.rightZ };
}

export class SurfBot {
  readonly route: RampInfo[];
  index = 0;
  /** Preferred distance from the ridge (on the ridden side) while surfing. */
  targetLateral = 120;

  constructor(map: MapDef) {
    this.route = routeOf(map).map(rampInfo);
  }

  /** Index of the first ramp of the route whose end lies ahead of the player. */
  resync(game: Game): void {
    const p = game.player.pos;
    this.index = 0;
    while (this.index < this.route.length - 1 && rampCoords(this.route[this.index], p.x, p.z).along > this.route[this.index].length) this.index++;
  }

  drive(game: Game): RampInfo {
    const p = game.player.pos;
    while (this.index < this.route.length - 1 && rampCoords(this.route[this.index], p.x, p.z).along > this.route[this.index].length) this.index++;
    const info = this.route[this.index];
    const input = game.input;
    input.yaw = info.heading;
    input.jump = false;
    input.duck = false;
    input.forward = 0;
    if (game.player.onGround) {
      input.forward = 1;
      input.side = 0;
      return info;
    }
    // Keep a mid-face line: strafe into the ramp when below the target line,
    // let gravity pull down when above it (holding into a 60 degree face
    // slowly climbs). In the air, steer gently toward the line too.
    const sign = info.ramp.ride === 'right' ? 1 : -1;
    const lateral = rampCoords(info, p.x, p.z).lateral * sign;
    const into = info.ramp.ride === 'right' ? -1 : 1;
    if (game.player.touched) {
      // On the face: hold into it below the line, let go above it.
      input.side = lateral > this.targetLateral ? into : 0;
    } else {
      // In the air: steer the sideways drift toward the line (at most 30 u/s
      // either way, the air-acceleration cap), with a little damping.
      const v = game.player.vel;
      const lateralVel = (v.x * info.rightX + v.z * info.rightZ) * sign;
      const desired = Math.max(-30, Math.min(30, (this.targetLateral - lateral) * 0.5));
      input.side = lateralVel < desired - 4 ? -into : lateralVel > desired + 4 ? into : 0;
    }
    return info;
  }
}
