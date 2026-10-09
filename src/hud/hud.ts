/**
 * Plain-DOM heads-up display. Every setter only touches the DOM when the
 * shown value changes, so per-frame updates cost almost nothing.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly speedEl: HTMLElement;
  private lastSpeed = -1;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="crosshair"></div>
      <div class="hud-bottom">
        <div class="speed"><span class="speed-value">0</span><span class="speed-unit">u/s</span></div>
      </div>`;
    this.speedEl = root.querySelector('.speed-value') as HTMLElement;
  }

  setVisible(visible: boolean): void {
    this.root.style.visibility = visible ? 'visible' : 'hidden';
  }

  /** Horizontal speed in u/s, shown as an integer. */
  setSpeed(speed: number): void {
    const v = Math.round(speed);
    if (v === this.lastSpeed) return;
    this.lastSpeed = v;
    this.speedEl.textContent = String(v);
  }
}
