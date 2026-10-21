import { DAY_NAMES, GOOD_KEYS, GOODS } from '../sim/defs';
import { birthdayNames } from '../sim/events';
import { snowing } from '../sim/seasons';
import type { Sim } from '../sim/sim';
import { statusOf } from './tracker';
import { esc } from './util';

/** Pixel icons (16x16 grid, crisp edges) for the time of day and weather. */
const px = (body: string) => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
const SUN = px('<rect x="6" y="1" width="4" height="2" fill="#f2c14e"/><rect x="6" y="13" width="4" height="2" fill="#f2c14e"/><rect x="1" y="6" width="2" height="4" fill="#f2c14e"/><rect x="13" y="6" width="2" height="4" fill="#f2c14e"/><rect x="2" y="2" width="2" height="2" fill="#f2c14e"/><rect x="12" y="2" width="2" height="2" fill="#f2c14e"/><rect x="2" y="12" width="2" height="2" fill="#f2c14e"/><rect x="12" y="12" width="2" height="2" fill="#f2c14e"/><rect x="5" y="4" width="6" height="8" fill="#ffd977"/><rect x="4" y="5" width="8" height="6" fill="#ffd977"/>');
const MOON = px('<rect x="6" y="2" width="5" height="2" fill="#e8e2f5"/><rect x="4" y="4" width="4" height="8" fill="#e8e2f5"/><rect x="3" y="6" width="2" height="4" fill="#e8e2f5"/><rect x="6" y="12" width="5" height="2" fill="#e8e2f5"/><rect x="8" y="10" width="5" height="2" fill="#e8e2f5"/><rect x="13" y="3" width="1" height="1" fill="#f2c14e"/><rect x="12" y="6" width="1" height="1" fill="#f2c14e"/>');
const HORIZON = (sky: string) => px(`<rect x="0" y="11" width="16" height="2" fill="#7a5c48"/><rect x="5" y="6" width="6" height="5" fill="${sky}"/><rect x="4" y="7" width="8" height="4" fill="${sky}"/><rect x="7" y="2" width="2" height="2" fill="${sky}"/><rect x="2" y="4" width="2" height="2" fill="${sky}"/><rect x="12" y="4" width="2" height="2" fill="${sky}"/>`);
const DAWN = HORIZON('#ffb27a');
const DUSK = HORIZON('#f08a6a');
const RAIN = px('<rect x="4" y="3" width="8" height="2" fill="#c9d3e0"/><rect x="2" y="5" width="12" height="4" fill="#c9d3e0"/><rect x="3" y="11" width="1" height="2" fill="#8fb6e8"/><rect x="7" y="11" width="1" height="3" fill="#8fb6e8"/><rect x="11" y="11" width="1" height="2" fill="#8fb6e8"/>');
const CLEAR = px('<rect x="5" y="5" width="6" height="6" fill="#ffd977"/><rect x="7" y="2" width="2" height="2" fill="#f2c14e"/><rect x="7" y="12" width="2" height="2" fill="#f2c14e"/><rect x="2" y="7" width="2" height="2" fill="#f2c14e"/><rect x="12" y="7" width="2" height="2" fill="#f2c14e"/>');
const SNOW = px('<rect x="4" y="3" width="8" height="2" fill="#c9d3e0"/><rect x="2" y="5" width="12" height="4" fill="#c9d3e0"/><rect x="3" y="11" width="2" height="2" fill="#ffffff"/><rect x="7" y="12" width="2" height="2" fill="#ffffff"/><rect x="11" y="11" width="2" height="2" fill="#ffffff"/>');
const NIGHT = px('<rect x="3" y="4" width="1" height="1" fill="#e8e2f5"/><rect x="11" y="3" width="1" height="1" fill="#e8e2f5"/><rect x="7" y="8" width="2" height="2" fill="#e8e2f5"/><rect x="12" y="11" width="1" height="1" fill="#e8e2f5"/><rect x="4" y="12" width="1" height="1" fill="#e8e2f5"/>');

/** Top bar: clock with day phase, weather, town stats and whatever is happening right now. */
export class Hud {
  private dayEl = document.getElementById('day')!;
  private clockEl = document.getElementById('clock')!;
  private phaseEl = document.getElementById('phase')!;
  private markEl = document.getElementById('daymark')!;
  private weatherEl = document.getElementById('weather')!;
  private statsEl = document.getElementById('stats')!;
  private sigs: Record<string, string> = {};

  constructor(private sim: Sim) {}

  private put(el: HTMLElement, key: string, html: string): void {
    if (this.sigs[key] === html) return;
    this.sigs[key] = html;
    el.innerHTML = html;
  }

  update(): void {
    const sim = this.sim;
    // "Tue · Spring 2" over the time: the weekday drives routines, the season drives the year.
    const day = `${DAY_NAMES[sim.weekday]} · ${sim.seasonName} ${sim.seasonDay}`;
    const title = `${sim.date()} · day ${sim.day + 1} of the town`;
    if (this.dayEl.title !== title) this.dayEl.title = title;
    const hm = sim.clock().split(' ').pop()!;
    if (this.dayEl.textContent !== day) this.dayEl.textContent = day;
    if (this.clockEl.textContent !== hm) this.clockEl.textContent = hm;
    const h = sim.hour;
    this.markEl.style.left = `${(h / 24) * 100}%`;
    const night = h < 5.5 || h >= 20.5;
    this.put(this.phaseEl, 'phase', night ? MOON : h < 8 ? DAWN : h >= 17.5 ? DUSK : SUN);
    const ev = sim.events;
    this.put(this.weatherEl, 'weather', ev.snowstorm ? `${SNOW}<span>Blizzard</span>` : snowing(sim) ? `${SNOW}<span>Snow</span>` : ev.rain ? `${RAIN}<span>Rain</span>` : night ? `${NIGHT}<span>Clear night</span>` : `${CLEAR}<span>${sim.season === 3 ? 'Cold' : 'Clear'}</span>`);

    const working = sim.agents.filter((a) => statusOf(a) === 'working').length;
    const asleep = sim.agents.filter((a) => statusOf(a) === 'asleep').length;
    const mood = Math.round(sim.agents.reduce((s, a) => s + a.mood, 0) / sim.agents.length);
    // Town-wide numbers, most important first; narrow screens drop from the end.
    const stats: [string, number | string][] = [
      ['people', sim.agents.length],
      ['treasury', `$${Math.round(sim.treasury)}`],
      ...GOOD_KEYS.filter((g) => GOODS[g].hud).map((g): [string, number] => [GOODS[g].label.toLowerCase(), Math.round(sim.stock[g])]),
      ['at work', working],
      ['asleep', asleep],
      ['mood', mood],
    ];
    const building = sim.projects.length ? `Building ${sim.projects.length === 1 ? sim.projects[0].name : `${sim.projects.length} things`}` : '';
    const bday = ev.birthdays[0] && birthdayNames(sim, ev.birthdays[0]);
    const happening = [ev.festival && (ev.festival.name ?? 'Festival in the park'), ev.snowstorm && 'Blizzard', ev.drought && 'Drought', bday && `${bday}'s birthday`, building, ev.standup && 'Standup', ev.pizza && 'Pizza in the kitchen', ev.party && 'Party in the lounge', ev.coffeeBroken && 'Coffee machine broken'].filter(Boolean).slice(0, 2) as string[];
    this.put(
      this.statsEl,
      'stats',
      stats.map(([label, v]) => `<span class="s"><b>${v}</b>${esc(label)}</span>`).join('') +
        happening.map((t) => `<span class="happening">${esc(t)}</span>`).join(''),
    );
  }
}
