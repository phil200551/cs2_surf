import { Color, MeshBasicMaterial, MeshPhysicalMaterial } from 'three';
import type { MaterialId } from '../map/types';
import { PALETTE } from './palette';

/** World-space grid spacing (units): minor lines stream past at speed, major lines group them. */
export const GRID_MINOR = 128;
export const GRID_MAJOR = 512;

/**
 * Smooth, slightly glossy PBR surface in a stage colour, with an
 * antialiased world-space grid so speed is readable. The grid is projected on
 * the plane most facing each surface and fades out where it would alias.
 */
export function createSurfaceMaterial(id: MaterialId): MeshPhysicalMaterial {
  const isPlatform = id === 'platform' || id === 'neutral';
  const m = new MeshPhysicalMaterial({
    color: PALETTE.surfaces[id],
    roughness: isPlatform ? 0.45 : 0.36,
    metalness: 0,
    clearcoat: isPlatform ? 0.15 : 0.32,
    clearcoatRoughness: 0.24,
    // Tame grazing-angle reflections of the pale horizon so faces keep their colour.
    specularIntensity: isPlatform ? 0.7 : 0.55,
    envMapIntensity: PALETTE.envIntensity,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridPos;\nvarying vec3 vGridNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGridPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;\nvGridNormal = normalize( mat3( modelMatrix ) * normal );',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vGridPos;
        varying vec3 vGridNormal;
        // Antialiased grid lines: 1 on a line, 0 between, faded where too fine.
        float gridLines( vec2 p, float spacing, float halfWidth ) {
          vec2 c = p / spacing;
          vec2 fw = max( fwidth( c ), vec2( 1e-6 ) );
          vec2 dist = abs( fract( c - 0.5 ) - 0.5 ) * spacing;
          vec2 aa = fw * spacing;
          vec2 l = 1.0 - smoothstep( vec2( halfWidth ) - aa, vec2( halfWidth ) + aa, dist );
          vec2 fade = 1.0 - smoothstep( vec2( 0.15 ), vec2( 0.6 ), fw );
          return max( l.x * fade.x, l.y * fade.y );
        }
        float surfaceGrid( vec3 p, vec3 n ) {
          vec3 a = abs( n );
          vec2 uv = a.x > a.y && a.x > a.z ? p.zy : ( a.y > a.z ? p.xz : p.xy );
          return max( gridLines( uv, ${GRID_MINOR.toFixed(1)}, 1.0 ) * 0.6, gridLines( uv, ${GRID_MAJOR.toFixed(1)}, 1.8 ) );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= 1.0 - 0.17 * surfaceGrid( vGridPos, normalize( vGridNormal ) );`,
      );
  };
  // Distinct program cache key so the grid variant is never shared with plain materials.
  m.customProgramCacheKey = () => 'surf-grid-v1';
  return m;
}

/** Emissive trim: HDR colour so only it (and the sun) crosses the bloom threshold. */
export function createTrimMaterial(id: MaterialId): MeshBasicMaterial {
  const c = new Color(PALETTE.trims[id]).multiplyScalar(PALETTE.trimIntensity);
  return new MeshBasicMaterial({ color: c, fog: true });
}
