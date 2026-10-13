import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import {
  Color,
  CubeCamera,
  DirectionalLight,
  FogExp2,
  HalfFloatType,
  HemisphereLight,
  Matrix4,
  Mesh,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderer,
  type Material,
} from 'three';
import { CLIENT } from '../config';
import type { CompiledMap } from '../map/compile';
import type { Vec3 } from '../physics';
import { createSurfaceMaterial, createTrimMaterial, GRID_UNIFORMS } from './materials';
import { buildMapGeometry } from './meshes';
import { PALETTE } from './palette';
import { installSkyFog, SkyDome, sunDirection } from './sky';
import { ZoneMeshes } from './zones';

/** Half-size of the sun's shadow frustum around its focus, units. */
const SHADOW_EXTENT = 3000;
const SHADOW_MAP_SIZE = 2048;
/** Distance from the shadow focus back toward the sun. */
const SHADOW_DISTANCE = 9000;
/**
 * The shadow focus leads the player by this much of a second of travel (up
 * to SHADOW_LEAD_MAX units), so at speed the shadows cover what is coming up
 * rather than what is already behind.
 */
const SHADOW_LEAD_TIME = 0.3;
const SHADOW_LEAD_MAX = 1800;
/** Minor grid lines fade out between these horizontal speeds (u/s). */
const GRID_FADE_START = 2600;
const GRID_FADE_END = 4800;

export interface RenderOptions {
  bloom: boolean;
  shadows: boolean;
}

/**
 * Scene, post-processing and camera. The camera's position comes from the
 * interpolated eye; its rotation is the raw mouse yaw/pitch of this frame.
 */
export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private effectPass: EffectPass | null = null;
  private readonly bloom: BloomEffect;
  private readonly toneMapping: ToneMappingEffect;
  private readonly smaa: SMAAEffect | null;
  private readonly sky: SkyDome;
  private readonly zones: ZoneMeshes;
  private readonly sun: DirectionalLight;
  private readonly sunDir: Vector3;
  private readonly materials: Material[] = [];
  private readonly shadowFocus = new Vector3(Infinity, Infinity, Infinity);
  private readonly focus = new Vector3();
  private readonly lightBasis = new Matrix4();
  private readonly lightBasisInv = new Matrix4();
  private readonly tmp = new Vector3();
  private options: RenderOptions;

  constructor(canvas: HTMLCanvasElement, map: CompiledMap, options: RenderOptions) {
    this.options = { ...options };
    this.sunDir = sunDirection(map.def.sun.azimuth, map.def.sun.elevation);
    installSkyFog(this.sunDir);

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping; // ACES happens in the effect pass
    this.renderer.toneMappingExposure = PALETTE.exposure;
    this.renderer.shadowMap.enabled = options.shadows;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    this.camera = new PerspectiveCamera(CLIENT.fovVertical, 1, CLIENT.near, CLIENT.far);
    this.camera.rotation.order = 'YXZ';

    this.scene.fog = new FogExp2(new Color(PALETTE.sky.haze), PALETTE.fogDensity);

    // Sky, and image-based lighting rendered from it.
    this.sky = new SkyDome(this.sunDir);
    this.scene.add(this.sky.mesh);
    this.scene.environment = this.bakeEnvironment();
    this.scene.environmentIntensity = 1;

    // One sun with shadows that follow the player, plus hemisphere fill.
    this.sun = new DirectionalLight(new Color(PALETTE.sky.sun), PALETTE.sunIntensity);
    this.sun.castShadow = options.shadows;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_EXTENT;
    cam.right = SHADOW_EXTENT;
    cam.top = SHADOW_EXTENT;
    cam.bottom = -SHADOW_EXTENT;
    cam.near = 10;
    cam.far = SHADOW_DISTANCE * 2;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 3;
    this.scene.add(this.sun, this.sun.target);
    const hemi = new HemisphereLight(new Color(PALETTE.sky.horizon), new Color(0x8fa3bd), PALETTE.hemisphereIntensity);
    this.scene.add(hemi);
    // Basis that maps world space into the light's view (for texel snapping).
    const up = Math.abs(this.sunDir.y) > 0.99 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
    this.lightBasis.lookAt(new Vector3(), this.sunDir.clone().negate(), up);
    this.lightBasisInv.copy(this.lightBasis).invert();

    // Static geometry: merged per material.
    const geo = buildMapGeometry(map);
    for (const [id, g] of geo.faces) {
      const m = createSurfaceMaterial(id);
      this.materials.push(m);
      const mesh = new Mesh(g, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
    }
    for (const [id, g] of geo.trims) {
      const m = createTrimMaterial(id);
      this.materials.push(m);
      const mesh = new Mesh(g, m);
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
    }
    this.zones = new ZoneMeshes(map, PALETTE.fogDensity);
    this.scene.add(this.zones.group);

    // Post-processing: MSAA HDR buffer -> bloom on emissives -> ACES.
    const maxSamples = this.renderer.capabilities.maxSamples;
    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType, multisampling: Math.min(4, maxSamples) });
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new BloomEffect({ luminanceThreshold: 1.05, luminanceSmoothing: 0.25, intensity: 0.85, mipmapBlur: true, radius: 0.72 });
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.smaa = maxSamples > 0 ? null : new SMAAEffect();
    this.rebuildEffects();
  }

  private bakeEnvironment() {
    const envScene = new Scene();
    const dome = new SkyDome(this.sunDir);
    dome.update(new Vector3(0, 5000, 0), 0);
    dome.mesh.position.set(0, 0, 0);
    envScene.add(dome.mesh);
    const target = new WebGLCubeRenderTarget(256, { type: HalfFloatType });
    const cube = new CubeCamera(1, 10000, target);
    cube.update(this.renderer, envScene);
    const pmrem = new PMREMGenerator(this.renderer);
    const env = pmrem.fromCubemap(target.texture).texture;
    pmrem.dispose();
    target.dispose();
    dome.material.dispose();
    dome.mesh.geometry.dispose();
    return env;
  }

  private rebuildEffects(): void {
    if (this.effectPass) {
      this.composer.removePass(this.effectPass);
      this.effectPass.dispose();
    }
    const effects = [];
    if (this.smaa) effects.push(this.smaa);
    if (this.options.bloom) effects.push(this.bloom);
    effects.push(this.toneMapping);
    this.effectPass = new EffectPass(this.camera, ...effects);
    this.composer.addPass(this.effectPass);
  }

  setOptions(options: RenderOptions): void {
    const prev = this.options;
    this.options = { ...options };
    if (prev.bloom !== options.bloom) this.rebuildEffects();
    if (prev.shadows !== options.shadows) {
      this.renderer.shadowMap.enabled = options.shadows;
      this.sun.castShadow = options.shadows;
      for (const m of this.materials) m.needsUpdate = true;
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Compiles every shader variant up front so the run never hitches on a first use. */
  async precompile(eye: Vec3): Promise<void> {
    this.placeCamera(eye, 0, 0, 0);
    this.updateShadowFocus(this.focus.set(eye.x, eye.y, eye.z), true);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.shadowMap.needsUpdate = true;
    this.composer.render();
  }

  private placeCamera(eye: Vec3, yaw: number, pitch: number, time: number): void {
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(pitch, yaw, 0);
    this.camera.updateMatrixWorld();
    this.sky.update(this.camera.position, time);
  }

  /**
   * Centres the shadow frustum on the player, snapped to whole shadow-map
   * texels in light space (no shimmering), and re-renders the shadow map only
   * when that snapped centre moves: the world is static.
   */
  private updateShadowFocus(focus: Vector3, force = false): void {
    if (!this.options.shadows) return;
    const texel = (SHADOW_EXTENT * 2) / SHADOW_MAP_SIZE;
    const step = texel * 64;
    const p = this.tmp.copy(focus).applyMatrix4(this.lightBasisInv);
    p.set(Math.round(p.x / step) * step, Math.round(p.y / step) * step, Math.round(p.z / step) * step);
    if (!force && p.equals(this.shadowFocus)) return;
    this.shadowFocus.copy(p);
    p.applyMatrix4(this.lightBasis);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(this.sunDir, SHADOW_DISTANCE);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** `vel` is the player's velocity: shadows lead it and the fine grid fades with speed. */
  render(eye: Vec3, yaw: number, pitch: number, time: number, vel?: Vec3): void {
    this.placeCamera(eye, yaw, pitch, time);
    const f = this.focus.set(eye.x, eye.y, eye.z);
    let speed = 0;
    if (vel) {
      speed = Math.hypot(vel.x, vel.z);
      const lead = Math.min(speed * SHADOW_LEAD_TIME, SHADOW_LEAD_MAX);
      if (speed > 1) f.set(eye.x + (vel.x / speed) * lead, eye.y, eye.z + (vel.z / speed) * lead);
    }
    this.updateShadowFocus(f);
    const t = Math.min(1, Math.max(0, (speed - GRID_FADE_START) / (GRID_FADE_END - GRID_FADE_START)));
    GRID_UNIFORMS.uGridMinor.value = 1 - t * t * (3 - 2 * t);
    this.zones.update(time);
    this.composer.render();
  }
}
