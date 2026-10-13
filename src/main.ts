import './styles.css';
import { GameAudio } from './audio/audio';
import { CLIENT, type Settings } from './config';
import { Game } from './game/game';
import { warmUpSimulation } from './game/warmup';
import { Input, type InputAction } from './game/input';
import { formatTime, loadPB, loadSettings, savePB, saveSettings, type PersonalBest } from './game/storage';
import { Hud, KEY_A, KEY_D, KEY_DUCK, KEY_JUMP, KEY_S, KEY_W } from './hud/hud';
import { difficultyLabel, Menu } from './hud/menu';
import { BEGINNER_MAP } from './map/beginner';
import { compileMap } from './map/compile';
import { TEST_MAP } from './map/testmap';
import { makeMovementConfig, Vec3 } from './physics';
import { GameRenderer } from './render/renderer';

type AppState = 'title' | 'playing' | 'paused';

class App {
  private readonly canvas = document.getElementById('game') as HTMLCanvasElement;
  private readonly game: Game;
  private readonly renderer: GameRenderer;
  private readonly input: Input;
  private readonly hud: Hud;
  private readonly menu: Menu;
  private readonly audio = new GameAudio();
  private readonly settings: Settings = loadSettings();
  private readonly mapId: string;
  private pb: PersonalBest | null;
  private state: AppState = 'title';
  private ready = false;
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
    this.pb = loadPB(this.pbId());
    this.renderer = new GameRenderer(this.canvas, map, { bloom: this.settings.bloom, shadows: this.settings.shadows });
    this.input = new Input(this.canvas);
    this.input.attach();
    this.input.onAction = (a) => this.onAction(a);
    this.input.onPointerLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
    };
    document.addEventListener('pointerlockerror', () => {
      if (this.state === 'playing') this.pause('The browser needs a moment before the mouse can be captured again. Click Resume.');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    window.addEventListener('beforeunload', (e) => {
      // Last line of defence for Ctrl+W outside fullscreen during a timed run.
      if (this.state === 'playing' && this.game.phase === 'running') e.preventDefault();
    });
    this.hud = new Hud(document.getElementById('hud') as HTMLElement);
    this.menu = new Menu(document.getElementById('overlay') as HTMLElement, {
      play: () => this.play(),
      restart: () => {
        this.restartRun();
        this.play();
      },
      changeSettings: (patch) => this.applySettings(patch),
      resetPB: () => {
        this.pb = null;
        savePB(this.pbId(), { time: 0, splits: [] });
        this.hud.setPB(null);
        this.showMenu();
      },
    });
    this.applySettings({});
    this.input.setView(this.game.spawnYaw(1), this.game.spawnPitch(1));
    this.hookGame();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.showMenu();
    requestAnimationFrame(this.frame);
    void this.warmUp();
  }

  /** Compile every shader (scene, shadows, post) and JIT the simulation before the first run. */
  private async warmUp(): Promise<void> {
    try {
      await this.renderer.precompile(this.game.curEye);
      warmUpSimulation(this.game);
    } finally {
      this.ready = true;
      if (this.state !== 'playing') this.showMenu();
    }
  }

  /** Personal bests are kept per difficulty; Hard (CS2 rules) uses the map's own id. */
  private pbId(): string {
    const d = this.settings.difficulty;
    return d === 'hard' ? this.mapId : `${this.mapId}-${d}`;
  }

  private applySettings(patch: Partial<Settings>): void {
    const difficultyChanged = patch.difficulty !== undefined && patch.difficulty !== this.settings.difficulty;
    Object.assign(this.settings, patch);
    saveSettings(this.settings);
    const d = this.settings.difficulty;
    this.game.assistEnabled = d === 'easy';
    this.game.rampRespawns = d !== 'hard';
    this.hud.setDifficulty(difficultyLabel(d));
    if (difficultyChanged) {
      // A run belongs to one difficulty: start over, against that difficulty's best.
      this.pb = loadPB(this.pbId());
      this.hud.setPB(this.pb?.time ?? null);
      this.restartRun();
      if (this.state !== 'playing') this.showMenu();
    }
    this.input.sensitivity = this.settings.sensitivity;
    this.audio.setVolume(this.settings.volume);
    this.hud.setKeyOverlay(this.settings.keyOverlay);
    this.renderer.setOptions({ bloom: this.settings.bloom, shadows: this.settings.shadows });
    if (patch.renderScale !== undefined) this.resize();
    if (patch.shadows !== undefined && this.ready) void this.renderer.precompile(this.game.curEye);
  }

  private hookGame(): void {
    const g = this.game;
    this.hud.setPB(this.pb?.time ?? null);
    g.hooks = {
      runStarted: () => this.audio.runStart(),
      checkpoint: (stage, time) => {
        const pbSplit = this.pb?.splits[stage - 1];
        const delta = Number.isFinite(time) && pbSplit !== undefined && Number.isFinite(pbSplit) ? time - pbSplit : null;
        this.hud.showMessage(`Stage ${stage}`, Number.isFinite(time) ? formatTime(time) : '', delta);
        this.audio.checkpoint();
      },
      finished: (time) => {
        const prev = this.pb;
        const delta = prev ? time - prev.time : null;
        const isPb = !prev || time < prev.time;
        if (isPb) {
          this.pb = { time, splits: g.splits.slice() };
          savePB(this.pbId(), this.pb);
          this.hud.setPB(time);
        }
        const top = Math.round(g.topSpeed).toLocaleString('en-US');
        this.hud.showMessage(isPb ? 'New personal best' : 'Finished', `${formatTime(time)} &middot; top speed ${top} u/s &middot; press R to go again`, delta, 6);
        this.audio.finish(isPb);
      },
      reset: () => this.hud.clearMessage(),
      // Put back after a fall: face the way to go.
      failed: (yaw, pitch) => this.input.setView(yaw, pitch),
      landed: (speed) => this.audio.land(speed),
      boosted: (speed) => {
        this.audio.boost(speed);
        this.hud.flashBoost();
      },
    };
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio, 3) * this.settings.renderScale);
  }

  private showMenu(notice?: string): void {
    this.menu.show({
      title: this.game.map.def.name.toUpperCase(),
      subtitle: 'An original three-stage surf map built for speed, with boosters all the way down. CS2 surf-server movement at 64 tick, with the speed cap raised to 10,000 u/s.',
      mode: this.state === 'title' ? 'title' : 'paused',
      ready: this.ready,
      personalBest: this.pb ? formatTime(this.pb.time) : null,
      notice,
      settings: this.settings,
    });
  }

  private play(): void {
    if (!this.ready) return;
    void this.input.lockPointer();
    void this.input.enterFullscreen();
    this.audio.start();
    this.menu.hide();
    this.state = 'playing';
    this.input.capturing = true;
    this.lastTime = -1;
  }

  private pause(notice?: string): void {
    this.state = 'paused';
    this.input.capturing = false;
    this.input.unlockPointer();
    this.audio.suspend();
    this.showMenu(notice);
  }

  private restartRun(): void {
    this.game.restartRun();
    this.input.setView(this.game.spawnYaw(1), this.game.spawnPitch(1));
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
      this.input.setView(this.game.spawnYaw(this.game.stage), this.game.spawnPitch(this.game.stage));
      this.accumulator = 0;
    }
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const game = this.game;
    const dt = game.dt;
    const elapsed = this.lastTime < 0 ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (this.state === 'playing') {
      this.accumulator += Math.min(elapsed, CLIENT.maxFrameTime);
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
    this.renderer.render(this.eye, this.input.yaw, this.input.pitch, now / 1000, game.player.vel);

    const p = game.player;
    const speed = p.vel.horizontalLength();
    if (this.state === 'playing') this.audio.updateWind(speed);
    this.hud.tick(elapsed);
    this.hud.setSpeed(speed);
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
    this.fpsTime += elapsed;
    this.frameMs = this.frameMs * 0.9 + elapsed * 1000 * 0.1;
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
