import { loadSim, saveSim } from '../sim/save';
import type { Sim } from '../sim/sim';
import { hhmm } from './util';

const KEY = 'townsfolk.save';
/** Never autosave more often than this, however fast the clock runs. */
const MIN_GAP_MS = 15_000;

/** The autosaved town, or null if there is none (or it can't be read). */
export function readSave(): Sim | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? loadSim(text) : null;
  } catch (err) {
    console.warn('[Townsfolk] Could not load the saved town; starting fresh.', err);
    return null;
  }
}

/** Autosave every game hour (at most every 15 s), plus manual save, export, import and starting over. */
export class Saves {
  private lastHour: number;
  private lastAt = 0;
  private savedAt: number | null = null;
  private error = '';
  private resetting = false;

  constructor(
    private sim: Sim,
    /** False for ?seed= scratch towns, which never overwrite the real one. */
    readonly enabled: boolean,
  ) {
    this.lastHour = Math.floor(sim.time / 60);
    if (enabled) {
      addEventListener('pagehide', () => this.save());
      document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && this.save());
    }
  }

  tick(): void {
    const hour = Math.floor(this.sim.time / 60);
    if (hour === this.lastHour || performance.now() - this.lastAt < MIN_GAP_MS) return;
    this.lastHour = hour;
    this.save();
  }

  save(): void {
    if (!this.enabled || this.resetting) return;
    this.lastAt = performance.now();
    try {
      localStorage.setItem(KEY, saveSim(this.sim));
      this.savedAt = this.sim.time;
      this.error = '';
    } catch {
      this.error = 'Browser storage is full or blocked; use Export';
    }
  }

  status(): string {
    if (!this.enabled) return 'scratch town, not saved';
    if (this.error) return this.error;
    return this.savedAt === null ? 'autosaves every game hour' : `saved at ${hhmm(this.savedAt)}`;
  }

  exportFile(): void {
    const s = this.sim;
    const blob = new Blob([saveSim(s)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `townsfolk-year${s.year}-${s.seasonName.toLowerCase()}${s.seasonDay}.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Checks the file loads before replacing anything, then restarts into it. */
  async importFile(file: File): Promise<void> {
    const text = await file.text();
    try {
      loadSim(text);
    } catch (err) {
      this.error = `Couldn't import: ${(err as Error).message}`;
      return;
    }
    this.resetting = true;
    try {
      localStorage.setItem(KEY, text);
    } catch {
      this.resetting = false;
      this.error = 'Browser storage is full or blocked';
      return;
    }
    location.href = location.pathname;
  }

  reset(): void {
    this.resetting = true;
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing saved to remove.
    }
    location.href = location.pathname;
  }
}
