import { awayMinutes, digest, type Digest, runFor } from '../sim/digest';
import type { Sim } from '../sim/sim';
import type { AwayRecord } from './saves';
import { dayTime, esc, linkNames } from './util';

/** Gone this long (tab hidden or closed) before the town catches up and reports. */
const MIN_AWAY_MS = 60_000;
/** Watching without touching anything for this long counts as away too: the town on a second monitor. */
const IDLE_MS = 10 * 60_000;
/** Real time per frame spent catching up, so the world visibly fast-forwards instead of freezing. */
const FRAME_BUDGET_MS = 12;
const PREF_KEY = 'townsfolk.catchUp';

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** "14 min", "2 h 10 min", "3 days". */
export function awayFor(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} min`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
  const d = Math.round(min / 1440);
  return `${d} day${d === 1 ? '' : 's'}`;
}

interface CatchUp {
  from: number;
  total: number;
  left: number;
  awayMs: number;
  /** The time away was more than a return catches up on. */
  capped: boolean;
}

/** "While you were away": catches the town up after the tab was hidden or closed, then tells you what happened. */
export class Away {
  private el: HTMLElement;
  private lastInputAt = performance.now();
  /** Game time at the last input: the digest starts here, so it covers idle watching before the tab was hidden. */
  private lastInputTime: number;
  private hiddenAt: { at: number; speed: number } | null = null;
  private catching: CatchUp | null = null;
  private enabled = readPref();

  constructor(
    private sim: Sim,
    deps: { speed: () => number; select: (id: number) => void; openLog: () => void },
  ) {
    this.lastInputTime = sim.time;
    this.el = Object.assign(document.createElement('section'), { className: 'digest panel', hidden: true });
    this.el.setAttribute('aria-label', 'While you were away');
    this.el.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-act="close"]')) return this.close();
      if (t.closest('[data-act="skip"]')) return this.finish();
      if (t.closest('[data-act="log"]')) {
        this.close();
        return deps.openLog();
      }
      const b = t.closest('[data-id]') as HTMLElement | null;
      if (b) deps.select(Number(b.dataset.id));
    });
    this.el.addEventListener('change', (e) => {
      const box = e.target as HTMLInputElement;
      if (box.dataset.act !== 'pref') return;
      this.enabled = box.checked;
      try {
        localStorage.setItem(PREF_KEY, box.checked ? 'on' : 'off');
      } catch {
        // Storage blocked: the choice lasts for this visit.
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.hiddenAt ??= { at: Date.now(), speed: deps.speed() };
        return;
      }
      const h = this.hiddenAt;
      this.hiddenAt = null;
      if (!h || this.catching) return;
      const ms = Date.now() - h.at;
      this.lastInputAt = performance.now();
      if (ms >= MIN_AWAY_MS) this.start(this.lastInputTime, ms, h.speed);
    });
  }

  /** Reopening a saved town: catch up on the time since it was saved. */
  resume(rec: AwayRecord | null): void {
    if (!rec || rec.time !== this.sim.time) return;
    const ms = Date.now() - rec.at;
    if (ms >= MIN_AWAY_MS) this.start(this.sim.time, ms, rec.speed);
  }

  /** Any input from the player. After a long idle stretch, it's a return worth reporting on. */
  input(): void {
    const now = performance.now();
    if (!this.catching && this.el.hidden && now - this.lastInputAt >= IDLE_MS) {
      const d = digest(this.sim, this.lastInputTime);
      if (d.lines.length) this.report(d, now - this.lastInputAt, 0, false);
    }
    this.lastInputAt = now;
    this.lastInputTime = this.sim.time;
  }

  /** True while catching up: main runs the clock through frame() instead of its own loop. */
  get busy(): boolean {
    return this.catching !== null;
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  frame(): void {
    const c = this.catching;
    if (!c) return;
    c.left -= runFor(this.sim, c.left, FRAME_BUDGET_MS);
    if (c.left <= 0.001) this.finish();
    else this.renderProgress(c);
  }

  close(): void {
    this.el.hidden = true;
  }

  private start(from: number, awayMs: number, speed: number): void {
    const total = this.enabled ? awayMinutes(awayMs, speed) : 0;
    if (total < 1) {
      const d = digest(this.sim, from);
      if (d.lines.length) this.report(d, awayMs, 0, false);
      return;
    }
    this.catching = { from, total, left: total, awayMs, capped: (awayMs / 1000) * speed > total };
    this.renderProgress(this.catching);
  }

  /** Done, or skipped: report on however much was caught up. */
  private finish(): void {
    const c = this.catching;
    if (!c) return;
    this.catching = null;
    this.lastInputAt = performance.now();
    this.lastInputTime = this.sim.time;
    this.report(digest(this.sim, c.from), c.awayMs, c.total - c.left, c.capped && c.left <= 0.001);
  }

  private renderProgress(c: CatchUp): void {
    const pct = Math.round(((c.total - c.left) / c.total) * 100);
    this.el.hidden = false;
    this.el.innerHTML = `
      <div class="dg-head">
        <h2>Catching up</h2>
        <span class="sub num">${dayTime(this.sim.time)}</span>
        <button class="chip-btn" data-act="skip">Skip</button>
      </div>
      <div class="dg-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>`;
  }

  private report(d: Digest, awayMs: number, caught: number, capped: boolean): void {
    const span = caught
      ? `Gone ${awayFor(awayMs)}; the town lived ${awayFor(caught * 60_000)} meanwhile${capped ? ', then waited for you' : ''}`
      : `Gone ${awayFor(awayMs)}`;
    const lines = d.lines.length
      ? `<ol class="dg-lines">${d.lines.map((e) => `<li class="${e.tone}"><time class="num">${dayTime(e.t)}</time><span class="txt">${linkNames(this.sim, e)}</span></li>`).join('')}</ol>`
      : '<p class="dg-quiet">Quiet while you were away. The town got on with its day.</p>';
    this.el.innerHTML = `
      <div class="dg-head">
        <h2>While you were away</h2>
        <button class="icon-btn" data-act="close" aria-label="Close" title="Close (Esc)"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
      </div>
      <p class="sub">${esc(span)}</p>
      ${lines}
      ${d.worry ? `<p class="dg-worry">${esc(d.worry)}</p>` : ''}
      <div class="dg-foot">
        ${d.more ? `<button class="chip-btn" data-act="log">and ${d.more} smaller thing${d.more === 1 ? '' : 's'}</button>` : ''}
        <label><input type="checkbox" data-act="pref"${this.enabled ? ' checked' : ''}> Catch up when I come back</label>
      </div>`;
    this.el.hidden = false;
  }
}
