import { MIN_PER_DAY, plural, SEASON_DAYS } from './defs';
import { WINTER_STOCK_DAYS, winterReadiness } from './seasons';
import { type Sim, STEP } from './sim';
import { HEADLINE, NOTABLE, type Activity } from './types';

/** Lines on the "while you were away" card; the rest are counted as "smaller things". */
export const DIGEST_LINES = 6;
/** The most game time a return will catch up on. Past this the town waits for you. */
export const CATCH_UP_MAX = MIN_PER_DAY;

export interface Digest {
  from: number;
  to: number;
  /** The lines worth telling, oldest first. */
  lines: Activity[];
  /** Everything else that happened in the window. */
  more: number;
  /** Something about the town to keep an eye on right now, or ''. */
  worry: string;
}

/** Headlines before notable lines; among equals, the bad news, then the most recent. */
function score(e: Activity): number {
  return (e.weight ?? 0) * 10 + (e.tone === 'bad' ? 1 : 0);
}

/** What happened since `from`, boiled down to the few lines a returning player wants. */
export function digest(sim: Sim, from: number, limit = DIGEST_LINES): Digest {
  const span = sim.activity.filter((e) => e.t >= from);
  const seen = new Set<string>();
  const picked = span
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => (e.weight ?? 0) >= NOTABLE)
    .sort((x, y) => score(y.e) - score(x.e) || y.i - x.i)
    // "Northwind is without a mayor" twice in a day is one piece of news.
    .filter(({ e }) => !seen.has(e.text) && !!seen.add(e.text))
    .slice(0, limit)
    .sort((x, y) => x.i - y.i)
    .map(({ e }) => e);
  return { from, to: sim.time, lines: picked, more: span.length - picked.length, worry: worry(sim) };
}

/** True if the window held anything a headline would be made of. */
export function hasHeadline(d: Digest): boolean {
  return d.lines.some((e) => (e.weight ?? 0) >= HEADLINE);
}

/** The one standing problem most worth knowing on return: nowhere to sleep, then the winter stores. */
function worry(sim: Sim): string {
  const homeless = sim.agents.filter((a) => sim.town.households[a.household]?.building < 0).length;
  if (homeless) return `${plural(homeless, 'person', 'people')} ${homeless === 1 ? 'has' : 'have'} nowhere to live yet.`;
  if (sim.season < 2) return '';
  // Same yardstick as the Town view's winter line: the stores have to last until spring.
  const toGo = (1 - sim.seasonProgress) * SEASON_DAYS;
  const need = sim.season === 2 ? toGo + SEASON_DAYS : toGo;
  const r = winterReadiness(sim);
  if (r.food < need - 0.05) return `The stores hold ${r.food.toFixed(1)} days of food, with ${need.toFixed(1)} to go until spring.`;
  if (r.firewood < Math.min(need, WINTER_STOCK_DAYS) - 0.05) return `Firewood is low: ${r.firewood.toFixed(1)} days left in the stores and hearths.`;
  return '';
}

/** Game minutes the town would have lived in `ms` of real time at `speed` (1x is a game minute a second), capped. */
export function awayMinutes(ms: number, speed: number): number {
  return Math.max(0, Math.min(CATCH_UP_MAX, (ms / 1000) * speed));
}

/** Runs the sim forward up to `minutes`, a game minute at a time, until `budgetMs` of real time is spent. Returns minutes run. */
export function runFor(sim: Sim, minutes: number, budgetMs: number, now: () => number = () => performance.now()): number {
  const end = now() + budgetMs;
  const steps = Math.round(minutes / STEP);
  const perMinute = Math.round(1 / STEP);
  let n = 0;
  while (n < steps && now() < end) {
    for (const stop = Math.min(steps, n + perMinute); n < stop; n++) sim.step();
  }
  return n * STEP;
}
