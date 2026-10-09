/**
 * Every movement constant lives here: CS2 defaults plus the standard
 * surf-server overrides (sv_airaccelerate 150, sv_enablebunnyhopping 1,
 * sv_autobunnyhopping 1, sv_staminamax 0, sv_falldamage_scale 0).
 *
 * Units are Source/Hammer units and seconds. +Y is up.
 */
export interface MovementConfig {
  /** Simulation rate in Hz (CS2 64-tick). */
  tickrate: number;
  /** sv_gravity, units/s^2. */
  gravity: number;
  /** Wish speed (sv_maxspeed / weapon max speed), units/s. */
  maxSpeed: number;
  /** sv_accelerate, ground acceleration. */
  accelerate: number;
  /** sv_friction, ground friction. */
  friction: number;
  /** sv_stopspeed, units/s. */
  stopSpeed: number;
  /** sv_airaccelerate (surf servers: 150). */
  airAccelerate: number;
  /** Air wish-speed cap applied only to the `add` term of AirAccelerate. */
  airSpeedCap: number;
  /** Jump impulse: sqrt(2 * 800 * 57). */
  jumpVelocity: number;
  /** sv_maxvelocity, clamped per axis. */
  maxVelocity: number;
  /** Max stair step height. */
  stepHeight: number;
  /** Wish-speed multiplier while ducked. */
  duckSpeedMultiplier: number;
  /** Holding jump re-jumps on landing (sv_autobunnyhopping). */
  autoBhop: boolean;
  /** A plane is ground only if normal.y >= this. Everything steeper is surfable. */
  groundNormalMinY: number;
  /** Moving up faster than this means never grounded (NON_JUMP_VELOCITY). */
  nonJumpVelocity: number;
  /** How far below the hull the ground check traces. */
  groundTraceDistance: number;
  /** Distance the hull is kept off every surface (DIST_EPSILON). */
  distEpsilon: number;
  /** Player hull, origin at the feet centre. */
  hullHalfWidth: number;
  hullHeight: number;
  duckHullHeight: number;
  eyeHeight: number;
  duckEyeHeight: number;
  /** Rate the eye height eases while ducking on the ground, units/s. */
  duckViewSpeed: number;
  /** TryPlayerMove bump limit. */
  maxBumps: number;
  /** Max clip planes tracked per move (MAX_CLIP_PLANES). */
  maxClipPlanes: number;
}

export const DEFAULT_MOVEMENT: Readonly<MovementConfig> = Object.freeze({
  tickrate: 64,
  gravity: 800,
  maxSpeed: 250,
  accelerate: 5.5,
  friction: 5.2,
  stopSpeed: 80,
  airAccelerate: 150,
  airSpeedCap: 30,
  jumpVelocity: 301.993,
  maxVelocity: 3500,
  stepHeight: 18,
  duckSpeedMultiplier: 0.34,
  autoBhop: true,
  groundNormalMinY: 0.7,
  nonJumpVelocity: 140,
  groundTraceDistance: 2,
  distEpsilon: 0.03125,
  hullHalfWidth: 16,
  hullHeight: 72,
  duckHullHeight: 54,
  eyeHeight: 64,
  duckEyeHeight: 46,
  duckViewSpeed: 18 / 0.125,
  maxBumps: 4,
  maxClipPlanes: 5,
});

export function makeMovementConfig(overrides: Partial<MovementConfig> = {}): MovementConfig {
  return { ...DEFAULT_MOVEMENT, ...overrides };
}
