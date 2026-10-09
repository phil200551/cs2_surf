import './styles.css';
import { CLIENT } from './config';
import { Game } from './game/game';
import { Input } from './game/input';
import { Hud } from './hud/hud';
import { compileMap } from './map/compile';
import { TEST_MAP } from './map/testmap';
import { makeMovementConfig, Vec3 } from './physics';
import { GameRenderer } from './render/renderer';

type AppState = 'title' | 'playing' | 'paused';

class App {
  private readonly canvas = document.getElementById('game') as HTMLCanvasElement;
  private readonly overlay = document.getElementById('overlay') as HTMLElement;
  private readonly game: Game;
  private readonly renderer: GameRenderer;
  private readonly input: Input;
  private readonly hud: Hud;
  private state: AppState = 'title';
  private accumulator = 0;
  private lastTime = -1;
  private readonly eye = new Vec3();

  constructor() {
    const map = compileMap(TEST_MAP);
    this.game = new Game(map, makeMovementConfig());
    this.renderer = new GameRenderer(this.canvas, map);
    this.input = new Input(this.canvas);
    this.input.attach();
    this.input.setView(this.game.spawnYaw(1), 0);
    this.input.onAction = (a) => this.onAction(a);
    this.input.onPointerLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
    };
    this.hud = new Hud(document.getElementById('hud') as HTMLElement);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.showTitle();
    requestAnimationFrame(this.frame);
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  }

  private showTitle(): void {
    this.overlay.innerHTML = `
      <div class="panel">
        <h1>SURF</h1>
        <p>WASD move · Mouse look · Space jump · Ctrl/C duck · R restart · E restart stage · Esc menu · F3 debug</p>
        <button class="primary" id="play">Click to play</button>
      </div>`;
    this.overlay.classList.remove('hidden');
    (document.getElementById('play') as HTMLButtonElement).onclick = () => this.play();
  }

  private play(): void {
    void this.input.lockPointer();
    void this.input.enterFullscreen();
    this.overlay.classList.add('hidden');
    this.state = 'playing';
    this.input.capturing = true;
    this.lastTime = -1;
  }

  private pause(): void {
    this.state = 'paused';
    this.input.capturing = false;
    this.input.unlockPointer();
    this.overlay.innerHTML = `
      <div class="panel">
        <h1>Paused</h1>
        <p>Esc or click to resume</p>
        <button class="primary" id="resume">Resume</button>
      </div>`;
    this.overlay.classList.remove('hidden');
    (document.getElementById('resume') as HTMLButtonElement).onclick = () => this.play();
  }

  private onAction(a: string): void {
    if (a === 'menu') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.play();
      return;
    }
    if (this.state !== 'playing') return;
    if (a === 'restartRun') {
      this.game.respawn(1);
      this.input.setView(this.game.spawnYaw(1), 0);
    } else if (a === 'restartStage') {
      this.game.respawn(this.game.stage);
      this.input.setView(this.game.spawnYaw(this.game.stage), 0);
    }
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const game = this.game;
    const dt = game.dt;
    if (this.state === 'playing') {
      let elapsed = this.lastTime < 0 ? 0 : (now - this.lastTime) / 1000;
      if (elapsed > CLIENT.maxFrameTime) elapsed = CLIENT.maxFrameTime;
      this.accumulator += elapsed;
      while (this.accumulator >= dt) {
        this.input.sample(game.input);
        game.step();
        this.accumulator -= dt;
      }
    }
    this.lastTime = now;
    const alpha = this.state === 'playing' ? this.accumulator / dt : 1;
    game.eye(alpha, this.eye);
    this.renderer.render(this.eye, this.input.yaw, this.input.pitch);
    this.hud.setSpeed(game.player.vel.horizontalLength());
  };
}

const app = new App();
if (import.meta.env.DEV) (window as unknown as { __surf: App }).__surf = app;
