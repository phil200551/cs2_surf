import { CLIENT } from '../config';
import type { MoveInput } from '../physics';

const DEG = Math.PI / 180;

export type InputAction = 'restartRun' | 'restartStage' | 'menu' | 'debug';

const ACTION_KEYS: Record<string, InputAction> = {
  KeyR: 'restartRun',
  KeyE: 'restartStage',
  Escape: 'menu',
  F3: 'debug',
};

/** Keys the browser keeps even while playing. */
const PASSTHROUGH = new Set(['F11', 'F12']);

interface PointerLockable {
  requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
}

interface KeyboardLock {
  lock(keyCodes?: string[]): Promise<void>;
  unlock(): void;
}

/**
 * Keyboard + raw mouse input. Mouse look is applied the moment an event
 * arrives (never smoothed or interpolated); each simulation tick samples the
 * latest yaw. Key taps shorter than a tick are latched so they still count.
 */
export class Input {
  /** View angles in radians. Yaw 0 looks down -Z, + turns left; pitch + looks up. */
  yaw = 0;
  pitch = 0;
  sensitivity: number = CLIENT.defaults.sensitivity;
  /** While true, game keys are captured and their browser defaults suppressed. */
  capturing = false;

  onAction: ((a: InputAction) => void) | null = null;
  onPointerLockChange: ((locked: boolean) => void) | null = null;

  private readonly down = new Set<string>();
  private readonly tapped = new Set<string>();
  private wheelJumpTicks = 0;
  private ignoreNextMove = false;
  private readonly target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('contextmenu', (e) => {
      if (this.capturing) e.preventDefault();
    });
  }

  /** Writes the current intent into `out` and clears latched taps. Never allocates. */
  sample(out: MoveInput): void {
    const d = this.down;
    const t = this.tapped;
    const w = d.has('KeyW') || t.has('KeyW');
    const s = d.has('KeyS') || t.has('KeyS');
    const a = d.has('KeyA') || t.has('KeyA');
    const r = d.has('KeyD') || t.has('KeyD');
    out.forward = (w ? 1 : 0) - (s ? 1 : 0);
    out.side = (r ? 1 : 0) - (a ? 1 : 0);
    out.jump = d.has('Space') || t.has('Space') || this.wheelJumpTicks > 0;
    out.duck = d.has('ControlLeft') || d.has('ControlRight') || d.has('KeyC') || t.has('ControlLeft') || t.has('ControlRight') || t.has('KeyC');
    out.yaw = this.yaw;
    t.clear();
    if (this.wheelJumpTicks > 0) this.wheelJumpTicks--;
  }

  setView(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Pointer lock with raw (unaccelerated) movement, falling back if unsupported. */
  async lockPointer(): Promise<void> {
    const el = this.target as unknown as PointerLockable;
    this.ignoreNextMove = true;
    try {
      await el.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        await el.requestPointerLock();
      } catch {
        // The browser refused (e.g. too soon after Esc); the caller shows "click to resume".
      }
    }
  }

  unlockPointer(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Fullscreen plus Keyboard Lock so Ctrl+W / Ctrl+S / Ctrl+D reach the game. */
  async enterFullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      // Fullscreen denied: keep playing windowed.
    }
    const kb = (navigator as unknown as { keyboard?: KeyboardLock }).keyboard;
    try {
      await kb?.lock();
    } catch {
      // Keyboard Lock unsupported; preventDefault still covers most shortcuts.
    }
  }

  releaseAll = (): void => {
    this.down.clear();
    this.tapped.clear();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.capturing) {
      if (e.code === 'Escape' || e.code === 'F3') this.onAction?.(ACTION_KEYS[e.code]);
      return;
    }
    if (!PASSTHROUGH.has(e.code)) e.preventDefault();
    if (!e.repeat) {
      this.down.add(e.code);
      this.tapped.add(e.code);
      const action = ACTION_KEYS[e.code];
      if (action) this.onAction?.(action);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
    if (this.capturing && !PASSTHROUGH.has(e.code)) e.preventDefault();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (document.pointerLockElement !== this.target) return;
    if (this.ignoreNextMove) {
      // Browsers can report a bogus jump on the first event after locking.
      this.ignoreNextMove = false;
      return;
    }
    const k = this.sensitivity;
    let yaw = this.yaw - e.movementX * k * CLIENT.yawDegreesPerCount * DEG;
    if (yaw > Math.PI) yaw -= 2 * Math.PI;
    else if (yaw < -Math.PI) yaw += 2 * Math.PI;
    this.yaw = yaw;
    const maxPitch = CLIENT.maxPitch * DEG;
    const pitch = this.pitch - e.movementY * k * CLIENT.pitchDegreesPerCount * DEG;
    this.pitch = pitch > maxPitch ? maxPitch : pitch < -maxPitch ? -maxPitch : pitch;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.capturing) return;
    e.preventDefault();
    if (e.deltaY > 0) this.wheelJumpTicks = 2; // mouse-wheel-down jumps, like a CS bind
  };

  private onLockChange = (): void => {
    if (!this.pointerLocked) this.releaseAll();
    this.onPointerLockChange?.(this.pointerLocked);
  };
}
