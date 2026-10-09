import './styles.css';
import { CLIENT } from './config';
import { Game } from './game/game';
import { Input, type InputAction } from './game/input';
import { formatTime, loadPB, loadSettings, savePB, type PersonalBest } from './game/storage';
import { Hud, KEY_A, KEY_D, KEY_DUCK, KEY_JUMP, KEY_S, KEY_W } from './hud/hud';
import { BEGINNER_MAP } from './map/beginner';
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
  private readonly settings = loadSettings();
  private readonly mapId: string;
  private pb: PersonalBest | null;
  private state: AppState = 'title';
  private accumulator = 0;
  private lastTime = -1;
  private readonly eye = new Vec3();
  // Frame / tick timing for the F3 overlay.
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private frameMs = 0;
  private tickMs = 0;

  constructor() {
    const def = new URLSearchParams(location.search).get('map') === 'test' ? TEST_MAP : BEGINNER_MAP;
    this.mapId = def.id;
    const map = compileMap(def);
    this.game = new Game(map, makeMovementConfig());
    this.pb = loadPB(this.mapId);
    this.renderer = new GameRenderer(this.canvas, map);
    this.input = new Input(this.canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.attach();
    this.input.setView(this.game.spawnYaw(1), 0);
    this.input.onAction = (a) => this.onAction(a);
    this.input.onPointerLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
    };
    this.hud = new Hud(document.getElementById('hud') as HTMLElement);
    this.hud.setKeyOverlay(this.settings.keyOverlay);
    this.hud.setPB(this.pb?.time ?? null);
    this.hookGame();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.showTitle();
    requestAnimationFrame(this.frame);
  }

  private hookGame(): void {
    const g = this.game;
    g.hooks = {
      checkpoint: (stage, time) => {
        const pbSplit = this.pb?.splits[stage - 1];
        const delta = Number.isFinite(time) && pbSplit !== undefined && Number.isFinite(pbSplit) ? time - pbSplit : null;
        this.hud.showMessage(`Stage ${stage}`, Number.isFinite(time) ? formatTime(time) : '', delta);
      },
      finished: (time) => {
        const prev = this.pb;
        const delta = prev ? time - prev.time : null;
        const isPb = !prev || time < prev.time;
        if (isPb) {
          this.pb = { time, splits: g.splits.slice() };
          savePB(this.mapId, this.pb);
          this.hud.setPB(time);
        }
        this.hud.showMessage(isPb ? 'New personal best' : 'Finished', `${formatTime(time)} &middot; press R to go again`, delta, 6);
      },
      reset: () => this.hud.clearMessage(),
    };
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, window.devicePixelRatio * this.settings.renderScale);
  }

  private controlsHtml(): string {
    return `<p class="controls">WASD move &middot; Mouse look &middot; Space / wheel jump &middot; Ctrl or C duck<br/>R restart run &middot; E restart stage &middot; Esc menu &middot; F3 debug</p>`;
  }

  private showTitle(): void {
    this.overlay.innerHTML = `
      <div class="panel">
        <h1>${this.game.map.def.name.toUpperCase()}</h1>
        <p>A three-stage beginner surf map. ${this.pb ? `Personal best ${formatTime(this.pb.time)}.` : 'No personal best yet.'}</p>
        ${this.controlsHtml()}
        <div class="buttons"><button class="primary" id="play">Play</button></div>
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
        ${this.controlsHtml()}
        <div class="buttons">
          <button class="primary" id="resume">Resume</button>
          <button id="restart">Restart run</button>
        </div>
      </div>`;
    this.overlay.classList.remove('hidden');
    (document.getElementById('resume') as HTMLButtonElement).onclick = () => this.play();
    (document.getElementById('restart') as HTMLButtonElement).onclick = () => {
      this.restartRun();
      this.play();
    };
  }

  private restartRun(): void {
    this.game.restartRun();
    this.input.setView(this.game.spawnYaw(1), 0);
    this.accumulator = 0;
  }

  private onAction(a: InputAction): void {
    if (a === 'debug') {
      this.hud.toggleDebug();
      return;
    }
    if (a === 'menu') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.play();
      return;
    }
    if (this.state !== 'playing') return;
    if (a === 'restartRun') {
      this.restartRun();
    } else if (a === 'restartStage') {
      this.game.respawn(this.game.stage);
      this.input.setView(this.game.spawnYaw(this.game.stage), 0);
      this.accumulator = 0;
    }
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const game = this.game;
    const dt = game.dt;
    const elapsedRaw = this.lastTime < 0 ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (this.state === 'playing') {
      this.accumulator += Math.min(elapsedRaw, CLIENT.maxFrameTime);
      const t0 = performance.now();
      let ticks = 0;
      while (this.accumulator >= dt) {
        this.input.sample(game.input);
        game.step();
        this.accumulator -= dt;
        ticks++;
      }
      if (ticks > 0) this.tickMs = this.tickMs * 0.9 + ((performance.now() - t0) / ticks) * 0.1;
    }
    const alpha = this.state === 'playing' ? this.accumulator / dt : 1;
    game.eye(alpha, this.eye);
    this.renderer.render(this.eye, this.input.yaw, this.input.pitch, now / 1000);

    const p = game.player;
    this.hud.tick(elapsedRaw);
    this.hud.setSpeed(p.vel.horizontalLength());
    this.hud.setTimer(game.runTime(alpha), game.phase);
    this.hud.setStage(game.stage, game.stageCount);
    if (this.settings.keyOverlay) {
      const i = this.input;
      this.hud.setKeys(
        (i.isDown('KeyW') ? KEY_W : 0) |
          (i.isDown('KeyA') ? KEY_A : 0) |
          (i.isDown('KeyS') ? KEY_S : 0) |
          (i.isDown('KeyD') ? KEY_D : 0) |
          (i.isDown('Space') ? KEY_JUMP : 0) |
          (i.isDown('ControlLeft') || i.isDown('ControlRight') || i.isDown('KeyC') ? KEY_DUCK : 0),
      );
    }
    this.fpsFrames++;
    this.fpsTime += elapsedRaw;
    this.frameMs = this.frameMs * 0.9 + elapsedRaw * 1000 * 0.1;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    if (this.hud.debugShown) {
      this.hud.setDebug({
        fps: this.fps,
        frameMs: this.frameMs,
        tickMs: this.tickMs,
        pos: p.pos,
        vel: p.vel,
        grounded: p.onGround,
        ducked: p.ducked,
        hitNormal: p.lastHitNormal,
        touching: p.touched,
        stage: game.stage,
        phase: game.phase,
      });
    }
  };
}

const app = new App();
if (import.meta.env.DEV) (window as unknown as { __surf: unknown }).__surf = app;
