import { loadSim, saveSim } from '../sim/save';
import type { Sim } from '../sim/sim';
import { download, hhmm } from './util';

const KEY = 'townsfolk.save';
/** A save that failed to load is moved here, so starting fresh never overwrites it. Holds the most recent one. */
export const BACKUP_KEY = 'townsfolk.save.unreadable';
/** Never autosave more often than this, however fast the clock runs. */
const MIN_GAP_MS = 15_000;
/** When the town was last saved, how fast it was running and its game minute, so reopening it can catch up. */
const AWAY_KEY = 'townsfolk.away';

export interface AwayRecord {
  /** Date.now() at the save. */
  at: number;
  speed: number;
  /** sim.time at the save, to check the record belongs to the town that was loaded. */
  time: number;
}

export function readAway(): AwayRecord | null {
  try {
    const r = JSON.parse(localStorage.getItem(AWAY_KEY) ?? 'null') as AwayRecord | null;
    return r && Number.isFinite(r.at) && Number.isFinite(r.speed) && Number.isFinite(r.time) ? r : null;
  } catch {
    return null;
  }
}

function clearAway(): void {
  try {
    localStorage.removeItem(AWAY_KEY);
  } catch {
    // Storage blocked: nothing to clear.
  }
}

export interface Unreadable {
  /** Why it couldn't be loaded. */
  reason: string;
  text: string;
  /** False if it couldn't be moved to BACKUP_KEY, so autosave must leave it alone. */
  kept: boolean;
}

/** The autosaved town, or null if there is none. A save that can't be read is moved to BACKUP_KEY. */
export function readSave(): { sim: Sim | null; unreadable?: Unreadable } {
  let text: string | null;
  try {
    text = localStorage.getItem(KEY);
  } catch {
    return { sim: null };
  }
  if (!text) return { sim: null };
  try {
    return { sim: loadSim(text) };
  } catch (err) {
    console.warn('[Townsfolk] Could not load the saved town; keeping it as a backup and starting fresh.', err);
    let kept = true;
    try {
      // Move rather than copy, so a big save doesn't need room for two.
      localStorage.removeItem(KEY);
      localStorage.setItem(BACKUP_KEY, text);
    } catch {
      kept = false;
      try {
        localStorage.setItem(KEY, text);
      } catch {
        // Nothing more we can do; the text is still in memory for Export backup.
      }
    }
    return { sim: null, unreadable: { reason: (err as Error).message, text, kept } };
  }
}

/** Autosave every game hour (at most every 15 s), plus manual save, export, import and starting over. */
export class Saves {
  private lastHour: number;
  private lastAt = 0;
  private savedAt: number | null = null;
  private error = '';
  private resetting = false;
  /** The save that couldn't be read, for Export backup: from this boot, or left over from an earlier one. */
  private backup: string | null = null;
  /** The clock speed, kept up to date by main, saved alongside so a return catches up at the pace the town was going. */
  speed = 1;

  constructor(
    private sim: Sim,
    /** False for ?seed= scratch towns, which never touch the real save. */
    readonly enabled: boolean,
    /** Set when the saved town couldn't be loaded and this is a fresh one. */
    private unreadable?: Unreadable,
  ) {
    this.lastHour = Math.floor(sim.time / 60);
    this.backup = unreadable?.text ?? null;
    if (enabled && !unreadable) {
      try {
        this.backup = localStorage.getItem(BACKUP_KEY);
      } catch {
        // Storage blocked: no backup to offer.
      }
    }
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

  /** False while an unreadable save is still in the main slot (it couldn't be moved aside), so autosave won't clobber it. */
  get canSave(): boolean {
    return this.enabled && !(this.unreadable && !this.unreadable.kept);
  }

  get hasBackup(): boolean {
    return this.backup !== null;
  }

  save(): void {
    if (!this.canSave || this.resetting) return;
    this.lastAt = performance.now();
    try {
      localStorage.setItem(KEY, saveSim(this.sim));
      this.savedAt = this.sim.time;
      this.error = '';
      localStorage.setItem(AWAY_KEY, JSON.stringify({ at: Date.now(), speed: this.speed, time: this.sim.time } satisfies AwayRecord));
    } catch {
      this.error = 'Browser storage is full or blocked; use Export';
    }
  }

  status(): string {
    if (this.error) return this.error;
    if (!this.enabled) return 'scratch town, not saved';
    if (!this.canSave) return 'autosave off';
    return this.savedAt === null ? 'autosaves every game hour' : `saved at ${hhmm(this.savedAt)}`;
  }

  /** Why the saved town isn't the one running, if it isn't. */
  notice(): string {
    const u = this.unreadable;
    if (!u) return '';
    const why = `Couldn't read your saved town: ${u.reason.replace(/\.?$/, '.')}`;
    return u.kept
      ? `${why} It was kept as a backup and this is a fresh town. Export backup downloads it; Import loads a save.`
      : `${why} There was no room to back it up, so autosave is off to keep it. Export backup, then start a New town.`;
  }

  exportFile(): void {
    const s = this.sim;
    download(saveSim(s), `townsfolk-year${s.year}-${s.seasonName.toLowerCase()}${s.seasonDay}.json`);
  }

  exportBackup(): void {
    if (this.backup) download(this.backup, 'townsfolk-unreadable-save.json');
  }

  /** Checks the file loads before replacing anything, then restarts into it. */
  async importFile(file: File): Promise<void> {
    if (!this.enabled) {
      this.error = "Scratch towns can't import";
      return;
    }
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
    // An imported town picks up where its file left off; it wasn't "away".
    clearAway();
    location.href = location.pathname;
  }

  reset(): void {
    if (!this.enabled) {
      // A scratch town just starts over from its seed; the saved town is untouched.
      location.reload();
      return;
    }
    this.resetting = true;
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing saved to remove.
    }
    clearAway();
    location.href = location.pathname;
  }
}
