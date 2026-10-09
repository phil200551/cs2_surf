import type { Settings } from '../config';

export interface MenuModel {
  title: string;
  subtitle: string;
  /** 'title' before the first run, 'paused' afterwards. */
  mode: 'title' | 'paused';
  ready: boolean;
  personalBest: string | null;
  notice?: string;
  settings: Settings;
}

export interface MenuHandlers {
  play(): void;
  restart(): void;
  changeSettings(patch: Partial<Settings>): void;
  resetPB(): void;
}

const RENDER_SCALES = [0.5, 0.67, 0.75, 0.85, 1, 1.25];

/** The title / pause overlay with persisted settings. Plain DOM. */
export class Menu {
  private readonly root: HTMLElement;
  private handlers: MenuHandlers;

  constructor(root: HTMLElement, handlers: MenuHandlers) {
    this.root = root;
    this.handlers = handlers;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  show(m: MenuModel): void {
    const s = m.settings;
    const playLabel = !m.ready ? 'Loading&hellip;' : m.mode === 'title' ? 'Play' : 'Resume';
    this.root.innerHTML = `
      <div class="panel wide">
        <div class="panel-head">
          <h1>${m.title}</h1>
          <p>${m.subtitle}</p>
        </div>
        <div class="panel-body">
          <div class="col">
            <div class="buttons">
              <button class="primary" id="m-play" ${m.ready ? '' : 'disabled'}>${playLabel}</button>
              ${m.mode === 'paused' ? '<button id="m-restart">Restart run</button>' : ''}
            </div>
            ${m.notice ? `<p class="notice">${m.notice}</p>` : ''}
            <p class="pb-line">${m.personalBest ? `Personal best <b>${m.personalBest}</b>` : 'No personal best yet'}</p>
            <table class="controls-table">
              <tr><td>W A S D</td><td>Move / air strafe</td></tr>
              <tr><td>Mouse</td><td>Look</td></tr>
              <tr><td>Space / wheel down</td><td>Jump (hold to bunny hop)</td></tr>
              <tr><td>Ctrl / C</td><td>Duck</td></tr>
              <tr><td>R</td><td>Restart run</td></tr>
              <tr><td>E</td><td>Restart stage</td></tr>
              <tr><td>Esc</td><td>Menu</td></tr>
              <tr><td>F3</td><td>Debug overlay</td></tr>
            </table>
            <p class="hint">Surf: hold the strafe key toward the ramp and steer with the mouse. Never land on a ramp &mdash; the slope is the floor.</p>
          </div>
          <div class="col settings">
            <h2>Settings</h2>
            <label class="row"><span>Sensitivity</span>
              <input id="s-sens-range" type="range" min="0.1" max="8" step="0.01" value="${s.sensitivity}">
              <input id="s-sens" type="number" min="0.01" max="99" step="0.01" value="${s.sensitivity}">
            </label>
            <label class="row"><span>Volume</span>
              <input id="s-vol" type="range" min="0" max="1" step="0.01" value="${s.volume}">
              <output id="s-vol-out">${Math.round(s.volume * 100)}%</output>
            </label>
            <label class="row"><span>Render scale</span>
              <select id="s-scale">${RENDER_SCALES.map((r) => `<option value="${r}" ${Math.abs(r - s.renderScale) < 1e-6 ? 'selected' : ''}>${Math.round(r * 100)}%</option>`).join('')}</select>
            </label>
            <label class="row check"><input id="s-bloom" type="checkbox" ${s.bloom ? 'checked' : ''}><span>Bloom</span></label>
            <label class="row check"><input id="s-shadows" type="checkbox" ${s.shadows ? 'checked' : ''}><span>Shadows</span></label>
            <label class="row check"><input id="s-keys" type="checkbox" ${s.keyOverlay ? 'checked' : ''}><span>Key-press overlay</span></label>
            <p class="hint">Sensitivity matches CS2 (degrees = counts &times; sensitivity &times; 0.022).</p>
            <button id="s-reset-pb" class="small">Reset personal best</button>
          </div>
        </div>
      </div>`;
    this.root.classList.remove('hidden');
    const $ = <T extends HTMLElement>(id: string) => this.root.querySelector(`#${id}`) as T;
    $<HTMLButtonElement>('m-play').onclick = () => this.handlers.play();
    const restart = this.root.querySelector('#m-restart') as HTMLButtonElement | null;
    if (restart) restart.onclick = () => this.handlers.restart();
    const sensRange = $<HTMLInputElement>('s-sens-range');
    const sens = $<HTMLInputElement>('s-sens');
    const setSens = (v: number) => {
      if (!(v > 0) || !Number.isFinite(v)) return;
      sensRange.value = String(v);
      sens.value = String(v);
      this.handlers.changeSettings({ sensitivity: v });
    };
    sensRange.oninput = () => setSens(Number(sensRange.value));
    sens.onchange = () => setSens(Number(sens.value));
    const vol = $<HTMLInputElement>('s-vol');
    vol.oninput = () => {
      $<HTMLOutputElement>('s-vol-out').textContent = `${Math.round(Number(vol.value) * 100)}%`;
      this.handlers.changeSettings({ volume: Number(vol.value) });
    };
    $<HTMLSelectElement>('s-scale').onchange = (e) => this.handlers.changeSettings({ renderScale: Number((e.target as HTMLSelectElement).value) });
    $<HTMLInputElement>('s-bloom').onchange = (e) => this.handlers.changeSettings({ bloom: (e.target as HTMLInputElement).checked });
    $<HTMLInputElement>('s-shadows').onchange = (e) => this.handlers.changeSettings({ shadows: (e.target as HTMLInputElement).checked });
    $<HTMLInputElement>('s-keys').onchange = (e) => this.handlers.changeSettings({ keyOverlay: (e.target as HTMLInputElement).checked });
    $<HTMLButtonElement>('s-reset-pb').onclick = () => {
      if (confirm('Reset your personal best for this map?')) this.handlers.resetPB();
    };
  }
}
