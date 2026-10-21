import { TILE } from '../assets/manifest';
import { type Camera, MIN_ZOOM } from '../engine/camera';
import { pickShot, type Shot, urgent } from '../sim/director';
import type { Sim } from '../sim/sim';
import { esc } from './util';

/** Untouched this long, the director takes over (if the player hasn't turned that off). */
const IDLE_START_MS = 2 * 60_000;
/** A shot stays at least this long before something urgent may cut in. */
const MIN_HOLD_MS = 4000;
/** How often to look for something urgent while holding a shot. */
const CHECK_MS = 1000;
/** Slow, cinematic easing while directing; the camera's own is 12. */
const GLIDE_RATE = 1.4;
const PREF_KEY = 'townsfolk.director.idle';
/** Close-ups stop here on a wide window: near enough to see faces, far enough to see what they're doing. */
const SHOT_MAX_ZOOM = 4;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Director mode: when nobody is steering, the camera finds what's interesting and captions it. */
export class Director {
  private on = false;
  private shot: Shot | null = null;
  private shotAt = 0;
  private checkedAt = 0;
  private lastInput = performance.now();
  /** Shot keys and the game minute each was last on screen, so the camera roams. */
  private shown = new Map<string, number>();
  private bar: HTMLElement;
  private auto: boolean;

  constructor(
    private sim: Sim,
    private camera: Camera,
    private button: HTMLElement,
    /** Panels hide while directing; main re-lays out the clear middle. */
    private onChange: (on: boolean) => void,
    /** False while something else owns the clock (catching up). */
    private canStart: () => boolean,
  ) {
    try {
      this.auto = localStorage.getItem(PREF_KEY) !== 'off';
    } catch {
      this.auto = true;
    }
    this.bar = Object.assign(document.createElement('div'), { className: 'director panel', hidden: true });
    this.bar.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.bar);
    this.bar.addEventListener('change', (e) => {
      const box = e.target as HTMLInputElement;
      this.auto = box.checked;
      try {
        localStorage.setItem(PREF_KEY, box.checked ? 'on' : 'off');
      } catch {
        // Storage blocked: lasts for this visit.
      }
    });
    this.bar.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="stop"]')) this.stop();
    });
    button.addEventListener('click', () => this.toggle());
  }

  get active(): boolean {
    return this.on;
  }

  /** Clicks inside the director's own controls aren't the player taking the camera back. */
  owns(target: EventTarget | null): boolean {
    return target instanceof Node && (this.bar.contains(target) || this.button.contains(target));
  }

  /** The player did something: hand the camera back. */
  input(): void {
    this.lastInput = performance.now();
    if (this.on) this.stop();
  }

  toggle(): void {
    if (this.on) this.stop();
    else this.start();
  }

  start(): void {
    if (this.on) return;
    this.on = true;
    this.shot = null;
    this.camera.rate = reducedMotion() ? 1000 : GLIDE_RATE;
    this.button.setAttribute('aria-pressed', 'true');
    document.body.classList.add('directing');
    this.onChange(true);
    this.next();
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    this.shot = null;
    this.camera.rate = 12;
    this.lastInput = performance.now();
    this.button.setAttribute('aria-pressed', 'false');
    document.body.classList.remove('directing');
    this.bar.hidden = true;
    this.onChange(false);
  }

  frame(): void {
    const now = performance.now();
    if (!this.on) {
      if (this.auto && now - this.lastInput >= IDLE_START_MS && document.visibilityState === 'visible' && this.canStart()) this.start();
      return;
    }
    const s = this.shot;
    if (s?.follow !== undefined) {
      const a = this.sim.agent(s.follow);
      // Someone who has just died or left town ends the shot.
      if (!a) return this.next();
      this.camera.lookAtClamped((a.x + 0.5) * TILE, (a.y + 0.5) * TILE);
    }
    if (!s || now - this.shotAt >= s.hold * 1000) return this.next();
    if (now - this.shotAt >= MIN_HOLD_MS && now - this.checkedAt >= CHECK_MS) {
      this.checkedAt = now;
      const cand = pickShot(this.sim, this.shown, s.kind);
      if (cand && cand.key !== s.key && s.score < 26 && urgent(this.sim, cand, this.shown)) this.cut(cand);
    }
  }

  private next(): void {
    const s = pickShot(this.sim, this.shown, this.shot?.kind);
    if (s) this.cut(s);
  }

  private cut(s: Shot): void {
    this.shot = s;
    this.shotAt = this.checkedAt = performance.now();
    this.shown.set(s.key, this.sim.time);
    const v = this.camera.view;
    const zoom = Math.min(SHOT_MAX_ZOOM, Math.max(MIN_ZOOM, (v.right - v.left) / (s.span * TILE)));
    this.camera.tz = zoom;
    this.camera.lookAtClamped((s.x + 0.5) * TILE, (s.y + 0.5) * TILE);
    this.bar.innerHTML = `
      <span class="dir-mark" aria-hidden="true"><svg viewBox="0 0 16 16"><rect x="1.5" y="4.5" width="9" height="7" rx="1"/><path d="M10.5 7l4-2v6l-4-2"/></svg></span>
      <span class="dir-cap">${esc(s.caption)}</span>
      <label class="dir-auto"><input type="checkbox"${this.auto ? ' checked' : ''}> When idle</label>
      <button class="chip-btn" data-act="stop" title="Stop (C or any key)">Stop</button>`;
    this.bar.hidden = false;
  }
}
