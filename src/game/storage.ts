import { CLIENT, type Settings } from '../config';

/** localStorage wrappers. Storage can be missing or throw (private mode), so every access is guarded. */

const SETTINGS_KEY = 'surf.settings.v1';
const pbKey = (mapId: string) => `surf.pb.v1.${mapId}`;

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: settings simply won't persist.
  }
}

export function loadSettings(): Settings {
  const stored = read(SETTINGS_KEY);
  const s: Settings = { ...CLIENT.defaults };
  if (stored && typeof stored === 'object') {
    const o = stored as Partial<Record<keyof Settings, unknown>>;
    if (typeof o.sensitivity === 'number' && o.sensitivity > 0 && o.sensitivity < 100) s.sensitivity = o.sensitivity;
    if (typeof o.volume === 'number' && o.volume >= 0 && o.volume <= 1) s.volume = o.volume;
    if (typeof o.bloom === 'boolean') s.bloom = o.bloom;
    if (typeof o.shadows === 'boolean') s.shadows = o.shadows;
    if (typeof o.renderScale === 'number' && o.renderScale >= 0.25 && o.renderScale <= 2) s.renderScale = o.renderScale;
    if (typeof o.keyOverlay === 'boolean') s.keyOverlay = o.keyOverlay;
  }
  return s;
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}

export interface PersonalBest {
  /** Final time in seconds. */
  time: number;
  /** Run time at which each stage was reached (index = stage - 1). */
  splits: number[];
}

export function loadPB(mapId: string): PersonalBest | null {
  const v = read(pbKey(mapId));
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<PersonalBest>;
  if (typeof o.time !== 'number' || !(o.time > 0)) return null;
  return { time: o.time, splits: Array.isArray(o.splits) ? o.splits.map((x) => (typeof x === 'number' ? x : NaN)) : [] };
}

export function savePB(mapId: string, pb: PersonalBest): void {
  write(pbKey(mapId), pb);
}

/** mm:ss.mmm */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalMs = Math.floor(seconds * 1000 + 1e-6);
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}.${ms < 10 ? '00' : ms < 100 ? '0' : ''}${ms}`;
}

/** +1.234 / -0.512 */
export function formatDelta(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  return `${sign}${Math.abs(seconds).toFixed(3)}`;
}
