import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { CLIENT } from '../config';
import type { CompiledMap } from '../map/compile';
import type { MaterialId } from '../map/types';
import type { Vec3 } from '../physics';
import { buildMapGeometry } from './meshes';

const DEG = Math.PI / 180;

const GRAY: Record<MaterialId, number> = {
  platform: 0xd8d8d8,
  stage1: 0x9aa4b0,
  stage2: 0xa8a29a,
  stage3: 0xa49cab,
  neutral: 0xb0b0b0,
};

/** Gray-box renderer. */
export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  constructor(canvas: HTMLCanvasElement, map: CompiledMap) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.camera = new PerspectiveCamera(CLIENT.fovVertical, 1, CLIENT.near, CLIENT.far);
    this.camera.rotation.order = 'YXZ';
    const sky = new Color(0x9ccaf2);
    this.scene.background = sky;
    this.scene.fog = new Fog(sky, 6000, 60000);
    this.scene.add(new HemisphereLight(0xdfefff, 0x55606c, 1.6));
    const sun = new DirectionalLight(0xffffff, 2.2);
    const az = map.def.sun.azimuth * DEG;
    const el = map.def.sun.elevation * DEG;
    sun.position.set(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.scene.add(sun);

    const geo = buildMapGeometry(map);
    for (const [id, g] of geo.faces) {
      this.scene.add(new Mesh(g, new MeshStandardMaterial({ color: GRAY[id], roughness: 0.8, flatShading: true })));
    }
    for (const [, g] of geo.trims) {
      this.scene.add(new Mesh(g, new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 })));
    }
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(eye: Vec3, yaw: number, pitch: number): void {
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(pitch, yaw, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
