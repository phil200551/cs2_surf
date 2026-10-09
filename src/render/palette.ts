import type { MaterialId } from '../map/types';

/** Art direction: colours are sRGB hex (converted to linear by Three.js). */
export const PALETTE = {
  surfaces: {
    stage1: 0x2a86ff,
    stage2: 0xff7426,
    stage3: 0xa457ff,
    platform: 0xdfe5ee,
    neutral: 0xb9c2cd,
  } satisfies Record<MaterialId, number>,
  /** Trim colours (multiplied by `trimIntensity` into HDR so they bloom). */
  trims: {
    stage1: 0x7cc4ff,
    stage2: 0xffb06a,
    stage3: 0xd2a2ff,
    platform: 0xbfe6ff,
    neutral: 0xffffff,
  } satisfies Record<MaterialId, number>,
  trimIntensity: 3.4,
  sky: {
    zenith: 0x125ad4,
    horizon: 0x9ccbf6,
    /** Haze toward and below the horizon (the sea of clouds fades into it). */
    haze: 0xb2cdea,
    sun: 0xfff2dc,
  },
  /** Light intensities (physically based units as used by three r155+). */
  sunIntensity: 2.9,
  hemisphereIntensity: 0.38,
  envIntensity: 0.5,
  /** Tone-mapping exposure (ACES). */
  exposure: 0.92,
  /** FogExp2 density: about 10% at 10k units, 63% at 34k. */
  fogDensity: 1 / 34000,
  /** World height of the sea of clouds drawn below the course. */
  cloudFloor: -4000,
} as const;
