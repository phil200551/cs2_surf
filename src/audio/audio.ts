/**
 * All sound is synthesised with Web Audio: no asset files.
 *
 * - Wind: looping pink noise through a band-pass filter; volume and pitch
 *   follow horizontal speed. A second high-passed layer whistles at speed.
 * - Landing thud, checkpoint chime, start blip and finish arpeggio are short
 *   one-shot envelopes on oscillators and noise.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private whistleGain: GainNode | null = null;
  private whistleFilter: BiquadFilterNode | null = null;
  private echo: DelayNode | null = null;
  private volume = 0.7;
  private lastWindUpdate = 0;

  /** Must be called from a user gesture (browsers block audio until then). */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    this.noise = makePinkNoise(ctx, 3);

    // Wind body.
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noise;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.Q.value = 0.7;
    windFilter.frequency.value = 300;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(master);
    windSrc.start();
    this.windFilter = windFilter;
    this.windGain = windGain;

    // High whistle layer (offset into the buffer so it decorrelates).
    const whistleSrc = ctx.createBufferSource();
    whistleSrc.buffer = this.noise;
    whistleSrc.loop = true;
    const whistleFilter = ctx.createBiquadFilter();
    whistleFilter.type = 'bandpass';
    whistleFilter.Q.value = 4;
    whistleFilter.frequency.value = 1200;
    const whistleGain = ctx.createGain();
    whistleGain.gain.value = 0;
    whistleSrc.connect(whistleFilter).connect(whistleGain).connect(master);
    whistleSrc.start(0, 1.37);
    this.whistleFilter = whistleFilter;
    this.whistleGain = whistleGain;

    // Short feedback echo for the chimes.
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.16;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    echo.connect(fb).connect(echo);
    echo.connect(wet).connect(master);
    this.echo = echo;
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** Call every frame with the horizontal speed (u/s). */
  updateWind(speed: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.windGain || !this.windFilter || !this.whistleGain || !this.whistleFilter) return;
    const t = ctx.currentTime;
    // ~30 Hz is plenty for smoothed parameters and keeps the automation queue short.
    if (t - this.lastWindUpdate < 0.033) return;
    this.lastWindUpdate = t;
    const s = Math.max(0, speed);
    const body = smoothstep(120, 2600, s);
    this.windGain.gain.setTargetAtTime(0.06 + 0.55 * body * body, t, 0.12);
    this.windFilter.frequency.setTargetAtTime(220 + Math.min(s, 3500) * 0.55, t, 0.12);
    const whistle = smoothstep(900, 3000, s);
    this.whistleGain.gain.setTargetAtTime(0.12 * whistle, t, 0.15);
    this.whistleFilter.frequency.setTargetAtTime(900 + Math.min(s, 3500) * 0.7, t, 0.15);
  }

  /** Thud scaled by impact speed (u/s). */
  land(impact: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || impact < 120) return;
    const t = ctx.currentTime;
    const k = Math.min(1, impact / 900);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380 + 500 * k;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * k + 0.05, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random() * 2, 0.2);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.14);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.45 * k + 0.05, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** Two rising notes. */
  checkpoint(): void {
    this.tone(659.25, 0, 0.18, 'triangle', 0.22);
    this.tone(987.77, 0.09, 0.28, 'triangle', 0.22);
  }

  /** Soft blip when the timer starts. */
  runStart(): void {
    this.tone(880, 0, 0.09, 'sine', 0.12);
  }

  /** Major arpeggio; brighter for a personal best. */
  finish(personalBest: boolean): void {
    const notes = personalBest ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(f, i * 0.085, 0.5, 'triangle', 0.2));
    this.tone(personalBest ? 2093 : 1568, notes.length * 0.085, 0.7, 'sine', 0.08);
  }

  private tone(freq: number, delay: number, length: number, type: OscillatorType, peak: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.echo) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(g);
    g.connect(this.master);
    g.connect(this.echo);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Pink-ish noise via Paul Kellet's filter on white noise. */
function makePinkNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  // Crossfade the loop seam.
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    d[len - fade + i] = d[len - fade + i] * (1 - a) + d[i] * a;
  }
  return buf;
}
