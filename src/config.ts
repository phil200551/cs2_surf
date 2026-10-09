/**
 * Client-side tunables (view, input, rendering, audio). Movement constants
 * live in src/physics/config.ts.
 */
export const CLIENT = {
  /** CS2: 90 degrees horizontal at 4:3, Hor+ => fixed 73.74 degrees vertical. */
  fovVertical: (2 * Math.atan(Math.tan((90 * Math.PI) / 360) * (3 / 4)) * 180) / Math.PI,
  /** Near/far clip planes in units. */
  near: 2,
  far: 100_000,
  /** CS2 m_yaw / m_pitch: degrees per mouse count at sensitivity 1. */
  yawDegreesPerCount: 0.022,
  pitchDegreesPerCount: 0.022,
  /** Pitch clamp in degrees. */
  maxPitch: 89,
  /** Longest frame the fixed-step accumulator will catch up on, seconds. */
  maxFrameTime: 0.25,
  /** Default settings (all persisted in localStorage). */
  defaults: {
    sensitivity: 1.25,
    volume: 0.7,
    bloom: true,
    shadows: true,
    renderScale: 1,
    keyOverlay: false,
  },
} as const;

export type Settings = {
  sensitivity: number;
  volume: number;
  bloom: boolean;
  shadows: boolean;
  renderScale: number;
  keyOverlay: boolean;
};
