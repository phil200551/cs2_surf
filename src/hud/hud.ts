import { formatDelta, formatTime } from '../game/storage';

export interface DebugInfo {
  fps: number;
  frameMs: number;
  tickMs: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  grounded: boolean;
  ducked: boolean;
  hitNormal: { x: number; y: number; z: number };
  touching: boolean;
  stage: number;
  phase: string;
}

/** Bit flags for the key overlay. */
export const KEY_W = 1, KEY_A = 2, KEY_S = 4, KEY_D = 8, KEY_JUMP = 16, KEY_DUCK = 32;

/** Horizontal speeds (u/s) where the speedometer changes colour. */
const SPEED_TIERS = [1500, 3000, 4500, 6000, 7500];

/**
 * Plain-DOM heads-up display. Every setter only touches the DOM when the
 * shown value changes, so per-frame updates cost almost nothing.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly speedEl: HTMLElement;
  private readonly speedBox: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly pbEl: HTMLElement;
  private readonly messageEl: HTMLElement;
  private readonly keysEl: HTMLElement;
  private readonly keyEls: HTMLElement[];
  private readonly debugEl: HTMLElement;
  private lastSpeed = -1;
  private lastTier = -1;
  private lastTimerText = '';
  private lastTimerState = '';
  private lastStage = '';
  private lastPb = '';
  private lastKeys = -1;
  private messageTimer = 0;
  private debugVisible = false;
  private debugAccum = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="crosshair"></div>
      <div class="hud-top">
        <div class="timer ready">00:00.000</div>
        <div class="hud-sub"><span class="stage">Stage 1/3</span><span class="pb">PB --:--.---</span></div>
      </div>
      <div class="message"></div>
      <div class="hud-bottom">
        <div class="speed" data-tier="0"><span class="speed-value">0</span><span class="speed-unit">u/s</span></div>
        <div class="keys hidden">
          <div class="key-row"><span class="key" data-k="w">W</span></div>
          <div class="key-row"><span class="key" data-k="a">A</span><span class="key" data-k="s">S</span><span class="key" data-k="d">D</span></div>
          <div class="key-row"><span class="key wide" data-k="duck">DUCK</span><span class="key wide" data-k="jump">JUMP</span></div>
        </div>
      </div>
      <pre class="debug hidden"></pre>`;
    const q = (sel: string) => root.querySelector(sel) as HTMLElement;
    this.speedEl = q('.speed-value');
    this.speedBox = q('.speed');
    this.timerEl = q('.timer');
    this.stageEl = q('.stage');
    this.pbEl = q('.pb');
    this.messageEl = q('.message');
    this.keysEl = q('.keys');
    this.debugEl = q('.debug');
    this.keyEls = ['w', 'a', 's', 'd', 'jump', 'duck'].map((k) => q(`.key[data-k="${k}"]`));
  }

  setVisible(visible: boolean): void {
    this.root.style.visibility = visible ? 'visible' : 'hidden';
  }

  /** Horizontal speed in u/s, shown as an integer and coloured by tier. */
  setSpeed(speed: number): void {
    const v = Math.round(speed);
    if (v === this.lastSpeed) return;
    this.lastSpeed = v;
    this.speedEl.textContent = String(v);
    let tier = 0;
    while (tier < SPEED_TIERS.length && v >= SPEED_TIERS[tier]) tier++;
    if (tier !== this.lastTier) {
      this.lastTier = tier;
      this.speedBox.dataset.tier = String(tier);
    }
  }

  /** Brief pulse on the speedometer when a booster fires. */
  flashBoost(): void {
    this.speedBox.classList.remove('boosted');
    void this.speedBox.offsetWidth; // restart the CSS animation
    this.speedBox.classList.add('boosted');
  }

  setTimer(seconds: number, state: 'ready' | 'running' | 'finished'): void {
    const text = formatTime(seconds);
    if (text !== this.lastTimerText) {
      this.lastTimerText = text;
      this.timerEl.textContent = text;
    }
    if (state !== this.lastTimerState) {
      this.lastTimerState = state;
      this.timerEl.className = `timer ${state}`;
    }
  }

  setStage(stage: number, count: number): void {
    const text = `Stage ${stage}/${count}`;
    if (text === this.lastStage) return;
    this.lastStage = text;
    this.stageEl.textContent = text;
  }

  setPB(seconds: number | null): void {
    const text = seconds === null ? 'PB --:--.---' : `PB ${formatTime(seconds)}`;
    if (text === this.lastPb) return;
    this.lastPb = text;
    this.pbEl.textContent = text;
  }

  /** Shows a centred message; `delta` (vs PB) is coloured green/red. */
  showMessage(title: string, detail = '', delta: number | null = null, seconds = 2.5): void {
    const d = delta === null || !Number.isFinite(delta) ? '' : `<span class="delta ${delta <= 0 ? 'better' : 'worse'}">${formatDelta(delta)}</span>`;
    this.messageEl.innerHTML = `<div class="msg-title">${title}</div><div class="msg-detail">${detail} ${d}</div>`;
    this.messageEl.classList.add('visible');
    this.messageTimer = seconds;
  }

  clearMessage(): void {
    this.messageTimer = 0;
    this.messageEl.classList.remove('visible');
  }

  setKeyOverlay(visible: boolean): void {
    this.keysEl.classList.toggle('hidden', !visible);
  }

  setKeys(mask: number): void {
    if (mask === this.lastKeys) return;
    const changed = mask ^ this.lastKeys;
    this.lastKeys = mask;
    const bits = [KEY_W, KEY_A, KEY_S, KEY_D, KEY_JUMP, KEY_DUCK];
    for (let i = 0; i < bits.length; i++) {
      if (changed & bits[i]) this.keyEls[i].classList.toggle('down', (mask & bits[i]) !== 0);
    }
  }

  toggleDebug(): boolean {
    this.debugVisible = !this.debugVisible;
    this.debugEl.classList.toggle('hidden', !this.debugVisible);
    return this.debugVisible;
  }

  get debugShown(): boolean {
    return this.debugVisible;
  }

  /** Per-frame upkeep (message fade). */
  tick(dt: number): void {
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.messageEl.classList.remove('visible');
    }
    this.debugAccum += dt;
  }

  /** Refreshes the F3 overlay at most ten times a second. */
  setDebug(info: DebugInfo): void {
    if (!this.debugVisible || this.debugAccum < 0.1) return;
    this.debugAccum = 0;
    const f = (n: number, d = 1) => n.toFixed(d).padStart(9);
    const v = info.vel;
    const h = Math.hypot(v.x, v.z);
    this.debugEl.textContent =
      `fps      ${info.fps.toFixed(0).padStart(5)}   frame ${info.frameMs.toFixed(2)} ms\n` +
      `tick     ${info.tickMs.toFixed(3)} ms\n` +
      `pos     ${f(info.pos.x)}${f(info.pos.y)}${f(info.pos.z)}\n` +
      `vel     ${f(v.x)}${f(v.y)}${f(v.z)}\n` +
      `speed   ${f(h)} h ${f(Math.hypot(v.x, v.y, v.z))} 3d\n` +
      `grounded ${info.grounded ? 'yes' : 'no '}   ducked ${info.ducked ? 'yes' : 'no'}\n` +
      `hit n   ${f(info.hitNormal.x, 3)}${f(info.hitNormal.y, 3)}${f(info.hitNormal.z, 3)} ${info.touching ? '(touching)' : ''}\n` +
      `stage    ${info.stage}   run ${info.phase}`;
  }
}
