import { BackSide, Color, Mesh, ShaderChunk, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { PALETTE } from './palette';

const DEG = Math.PI / 180;

/** Unit vector toward the sun from azimuth/elevation in degrees (azimuth 0 = -Z, + left). */
export function sunDirection(azimuthDeg: number, elevationDeg: number): Vector3 {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  return new Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

function glslVec3(c: Color | Vector3): string {
  const v = c instanceof Color ? [c.r, c.g, c.b] : [c.x, c.y, c.z];
  return `vec3(${v.map((x) => x.toFixed(6)).join(', ')})`;
}

/**
 * Sky colour without clouds or the sun disc: a zenith-to-horizon gradient,
 * haze at and below the horizon, and a warm glow around the sun. Shared by the
 * sky dome and by every material's fog so distant geometry dissolves into
 * exactly the sky behind it.
 */
function skyGradientGlsl(sunDir: Vector3): string {
  const p = PALETTE.sky;
  return /* glsl */ `
    vec3 skyGradient( vec3 d ) {
      const vec3 zenith = ${glslVec3(new Color(p.zenith))};
      const vec3 horizon = ${glslVec3(new Color(p.horizon))};
      const vec3 haze = ${glslVec3(new Color(p.haze))};
      const vec3 sunCol = ${glslVec3(new Color(p.sun))};
      const vec3 sunDir = ${glslVec3(sunDir)};
      float h = d.y;
      vec3 col = mix( horizon, zenith, pow( clamp( h, 0.0, 1.0 ), 0.5 ) );
      col = mix( col, haze, smoothstep( 0.04, -0.2, h ) );
      float s = max( dot( d, sunDir ), 0.0 );
      col += sunCol * ( pow( s, 6.0 ) * 0.16 + pow( s, 48.0 ) * 0.3 );
      return col;
    }
  `;
}

/**
 * Replaces Three.js' fog chunks: fog uses radial distance (no swimming when
 * turning) and takes its colour from the sky in the view direction, so the
 * horizon and distant ramps always match. Must run before materials compile.
 */
export function installSkyFog(sunDir: Vector3): void {
  ShaderChunk.fog_pars_vertex = /* glsl */ `
    #ifdef USE_FOG
      varying float vFogDepth;
      varying vec3 vFogDir;
    #endif
  `;
  ShaderChunk.fog_vertex = /* glsl */ `
    #ifdef USE_FOG
      vFogDepth = length( mvPosition.xyz );
      vFogDir = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
    #endif
  `;
  ShaderChunk.fog_pars_fragment = /* glsl */ `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying float vFogDepth;
      varying vec3 vFogDir;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
      ${skyGradientGlsl(sunDir)}
    #endif
  `;
  ShaderChunk.fog_fragment = /* glsl */ `
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
      #else
        float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
      #endif
      gl_FragColor.rgb = mix( gl_FragColor.rgb, skyGradient( normalize( vFogDir ) ), fogFactor );
    #endif
  `;
}

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    // Pin to the far plane; the dome is drawn first with depth writes off.
    gl_Position = p.xyww;
  }
`;

function skyFragment(sunDir: Vector3): string {
  const p = PALETTE.sky;
  return /* glsl */ `
    uniform float uTime;
    uniform float uCloudFloor;
    uniform vec3 uCamPos;
    varying vec3 vDir;
    ${skyGradientGlsl(sunDir)}

    float hash12( vec2 p ) {
      vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
      p3 += dot( p3, p3.yzx + 33.33 );
      return fract( ( p3.x + p3.y ) * p3.z );
    }
    float vnoise( vec2 p ) {
      vec2 i = floor( p );
      vec2 f = fract( p );
      vec2 u = f * f * ( 3.0 - 2.0 * f );
      return mix( mix( hash12( i ), hash12( i + vec2( 1.0, 0.0 ) ), u.x ),
                  mix( hash12( i + vec2( 0.0, 1.0 ) ), hash12( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
    }
    float fbm( vec2 p ) {
      float v = 0.0;
      float a = 0.5;
      mat2 r = mat2( 0.8, 0.6, -0.6, 0.8 );
      for ( int i = 0; i < 5; i++ ) {
        v += a * vnoise( p );
        p = r * p * 2.02 + 17.1;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec3 d = normalize( vDir );
      const vec3 sunCol = ${glslVec3(new Color(p.sun))};
      const vec3 sunDir = ${glslVec3(sunDir)};
      vec3 col = skyGradient( d );
      float s = dot( d, sunDir );

      if ( d.y > 0.0 ) {
        // Soft cloud layer projected on a plane overhead.
        vec2 uv = d.xz / ( d.y + 0.1 ) * 0.9 + uTime * vec2( 0.006, 0.003 );
        float c = fbm( uv );
        float cover = smoothstep( 0.5, 0.82, c ) * smoothstep( 0.0, 0.22, d.y );
        float lit = 0.82 + 0.18 * smoothstep( 0.45, 0.9, c );
        vec3 cloud = vec3( 0.86, 0.9, 0.96 ) * lit + sunCol * pow( max( s, 0.0 ), 10.0 ) * 0.5;
        col = mix( col, cloud, cover * 0.8 );
      } else {
        // A sea of clouds far below the course, fading into haze.
        float t = ( uCloudFloor - uCamPos.y ) / d.y;
        vec2 q = ( uCamPos.xz + d.xz * t ) / 5200.0 + uTime * vec2( 0.004, 0.002 );
        float c = fbm( q );
        float puff = smoothstep( 0.32, 0.72, c );
        vec3 floorCol = mix( vec3( 0.42, 0.55, 0.74 ), vec3( 1.05, 1.04, 1.0 ), puff );
        floorCol += sunCol * 0.06 * puff;
        float haze = 1.0 - exp( -t / 110000.0 );
        col = mix( floorCol, col, clamp( haze + smoothstep( -0.06, 0.0, d.y ), 0.0, 1.0 ) );
      }

      // HDR sun disc so it blooms.
      col += sunCol * smoothstep( 0.99988, 0.99995, s ) * 40.0;
      gl_FragColor = vec4( col, 1.0 );
    }
  `;
}

/** Procedural sky dome that follows the camera. */
export class SkyDome {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;

  constructor(sunDir: Vector3) {
    this.material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCloudFloor: { value: PALETTE.cloudFloor }, uCamPos: { value: new Vector3() } },
      vertexShader: skyVertex,
      fragmentShader: skyFragment(sunDir),
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(1000, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  update(camPos: Vector3, time: number): void {
    this.mesh.position.copy(camPos);
    this.material.uniforms.uCamPos.value.copy(camPos);
    this.material.uniforms.uTime.value = time;
  }
}
