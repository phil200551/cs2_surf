/**
 * Data-driven map format. A map is a list of primitives (which all become
 * convex brushes), trigger volumes and stage spawn points. Everything is in
 * Hammer units, +Y up. Pure data: no Three.js.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Visual material slot; the renderer maps these to looks. */
export type MaterialId = 'platform' | 'stage1' | 'stage2' | 'stage3' | 'neutral';

interface PrimitiveBase {
  material: MaterialId;
  /**
   * Glowing trim along edges where two visible faces meet and at least one
   * of them faces upward (ramp ridges and lips, platform top edges).
   */
  trim?: boolean;
  /** Free-form label (used by validation tools and debugging). */
  name?: string;
}

/** Axis-aligned box. */
export interface BoxPrimitive extends PrimitiveBase {
  kind: 'box';
  min: V3;
  max: V3;
}

/**
 * Triangular-prism "A-frame" ramp between two ridge points. The cross-section
 * is `2 * halfWidth` wide and `height` tall. By default each end cap is
 * perpendicular to the ridge's horizontal direction; curve segments override
 * the cap headings so neighbouring segments share their joint exactly.
 */
export interface RampPrimitive extends PrimitiveBase {
  kind: 'ramp';
  start: V3;
  end: V3;
  height?: number;
  halfWidth?: number;
  /** Heading (radians, 0 = -Z, + turns left) the start cap faces against. */
  startHeading?: number;
  /** Heading the end cap faces along. */
  endHeading?: number;
  /** Internal joints of a multi-segment ramp are not drawn or trimmed. */
  hideStartCap?: boolean;
  hideEndCap?: boolean;
  /** Face the intended line rides (used by the validation bot). */
  ride?: 'left' | 'right';
}

/** Arbitrary convex hull of points. */
export interface ConvexPrimitive extends PrimitiveBase {
  kind: 'convex';
  points: V3[];
}

export type Primitive = BoxPrimitive | RampPrimitive | ConvexPrimitive;

export type TriggerKind = 'start' | 'checkpoint' | 'end' | 'fail';

export interface TriggerDef {
  kind: TriggerKind;
  /** Stage this trigger belongs to (checkpoint: the stage it starts). */
  stage: number;
  /** Axis-aligned box... */
  min?: V3;
  max?: V3;
  /** ...or a convex hull of points (for rotated volumes). */
  points?: V3[];
  /** Oriented-box description of `points`, when it is one (used for drawing). */
  obb?: { center: V3; halfX: number; halfY: number; halfZ: number; heading: number };
}

export interface StageDef {
  /** 1-based stage number. */
  index: number;
  name: string;
  /** Feet position the player respawns at, standing still. */
  spawn: V3;
  /** Spawn view yaw in degrees (0 = -Z, + turns left). */
  yaw: number;
  /** Spawn view pitch in degrees (+ up). */
  pitch?: number;
}

/** Sun direction as azimuth/elevation in degrees (azimuth 0 = toward -Z, + to the left). */
export interface SunDef {
  azimuth: number;
  elevation: number;
}

export interface MapDef {
  id: string;
  name: string;
  primitives: Primitive[];
  triggers: TriggerDef[];
  stages: StageDef[];
  sun: SunDef;
}
