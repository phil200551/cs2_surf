import { AdditiveBlending, BoxGeometry, Color, DoubleSide, Group, Mesh, ShaderMaterial, Vector3 } from 'three';
import type { CompiledMap } from '../map/compile';
import type { TriggerKind } from '../map/types';

const DEG = Math.PI / 180;

export const ZONE_COLORS: Partial<Record<TriggerKind, number>> = {
  start: 0x3dff8e,
  checkpoint: 0x3ec8ff,
  end: 0xffc53a,
};

const vertexShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  varying vec3 vWorld;
  void main() {
    vLocal = position;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uFogDensity;
  uniform vec3 uHalf;
  uniform float uTime;
  uniform float uIntensity;
  varying vec3 vLocal;
  varying vec3 vWorld;
  void main() {
    #include <logdepthbuf_fragment>
    // Distance to the nearest box edge on this face: the middle of the three
    // per-axis distances to the box surface (the smallest is ~0 on a face).
    vec3 d = uHalf - abs(vLocal);
    float lo = min(d.x, min(d.y, d.z));
    float hi = max(d.x, max(d.y, d.z));
    float edgeDist = d.x + d.y + d.z - lo - hi;
    float edge = exp(-edgeDist / 10.0) + 0.35 * exp(-edgeDist / 60.0);
    // Brighter toward the bottom, with slow rising bands.
    float h = clamp((vLocal.y + uHalf.y) / (2.0 * uHalf.y), 0.0, 1.0);
    float bands = 0.5 + 0.5 * sin((h * 6.0 - uTime * 0.6) * 6.2831);
    float fill = (0.05 + 0.10 * (1.0 - h) + 0.03 * bands) * (1.0 - h * 0.6);
    // Walls right next to the camera fade out, so standing inside a zone
    // tints the view instead of whiting it out.
    float near = smoothstep(60.0, 700.0, distance(cameraPosition, vWorld));
    float a = clamp(edge * 0.9 + fill, 0.0, 1.0) * (0.25 + 0.75 * near);
    // Additive glow fades to nothing with distance (fog for additive light).
    float dist = distance(cameraPosition, vWorld);
    float fog = exp(-uFogDensity * uFogDensity * dist * dist);
    gl_FragColor = vec4(uColor * a * uIntensity * fog, 1.0);
  }
`;

/** Translucent glowing volumes for the start, checkpoint and end zones. */
export class ZoneMeshes {
  readonly group = new Group();
  private readonly materials: ShaderMaterial[] = [];

  constructor(map: CompiledMap, fogDensity: number) {
    for (const t of map.triggers) {
      const color = ZONE_COLORS[t.def.kind];
      if (color === undefined) continue;
      let center: Vector3;
      let half: Vector3;
      let heading = 0;
      if (t.def.obb) {
        const o = t.def.obb;
        center = new Vector3(o.center.x, o.center.y, o.center.z);
        half = new Vector3(o.halfX, o.halfY, o.halfZ);
        heading = o.heading * DEG;
      } else {
        const b = t.brush;
        center = new Vector3((b.mins.x + b.maxs.x) / 2, (b.mins.y + b.maxs.y) / 2, (b.mins.z + b.maxs.z) / 2);
        half = new Vector3((b.maxs.x - b.mins.x) / 2, (b.maxs.y - b.mins.y) / 2, (b.maxs.z - b.mins.z) / 2);
      }
      const material = new ShaderMaterial({
        uniforms: { uColor: { value: new Color(color) }, uHalf: { value: half }, uTime: { value: 0 }, uIntensity: { value: 1.6 }, uFogDensity: { value: fogDensity } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
      this.materials.push(material);
      const mesh = new Mesh(new BoxGeometry(half.x * 2, half.y * 2, half.z * 2), material);
      mesh.position.copy(center);
      mesh.rotation.y = heading;
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 10;
      mesh.frustumCulled = true;
      this.group.add(mesh);
    }
  }

  update(time: number): void {
    for (const m of this.materials) m.uniforms.uTime.value = time;
  }
}
