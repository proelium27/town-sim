import type { Building, TownMap } from '../world/map';
import { CORE_H, CORE_W } from '../world/town';
import { parkEventUntil } from './events';
import type { Sim } from './sim';
import { first } from './social';
import { type ActionKind, type Agent, HEADLINE, NOTABLE } from './types';

/**
 * Director mode picks what the camera looks at when nobody is steering. This is the pure half: it reads the
 * town and scores candidate shots. It never touches sim.rng, so watching can't change how the town turns out.
 */
export interface Shot {
  /** Identity for "we just showed this": the same person, building or site. */
  key: string;
  kind: 'news' | 'moment' | 'gathering' | 'build' | 'quiet' | 'establishing';
  /** Tile coordinates to frame (the middle of the shot). */
  x: number;
  y: number;
  /** Follow this person instead of holding still. */
  follow?: number;
  /** About how many tiles across the shot should show. */
  span: number;
  caption: string;
  score: number;
  /** Real seconds to stay on it. */
  hold: number;
  /** Game minute of the news behind it, if any: fresher than the last showing, it may cut in again. */
  at?: number;
}

/** News this recent (game minutes) is still worth cutting to. */
const NEWS_WINDOW = 45;
/** Arguments and new friendships are moments: only worth it while they're happening. */
const MOMENT_WINDOW = 6;
/** A key shown this recently (game minutes) is held back so the camera roams. */
const REPEAT_WINDOW = 150;
/** Headline-grade shots; fresh ones cut in on the current shot. */
const URGENT_SCORE = 26;
/** Evenings and small hours, when the town is asleep and the camera needs somewhere else to go. */
const isNight = (hour: number) => hour >= 22 || hour < 6;

/** Pleasant everyday things to drift to between events, and how much each is worth. */
const QUIET: Partial<Record<ActionKind, number>> = {
  stroll: 5, music: 6, play: 5, party: 5, read: 3, mourn: 7, escort: 6, farm: 4, chop: 3, craft: 4, cook: 3, socialize: 4, build: 3, pave: 3, teach: 4, learn: 3,
};

const center = (b: Building): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];

/** Where a group of living people stands on average, if at least three of them are around. */
function centroid(sim: Sim, ids: number[]): [number, number] | null {
  const here = ids.map((id) => sim.agent(id)).filter((a): a is Agent => !!a);
  if (here.length < 3 && !(here.length && ids.length < 3)) return null;
  return [here.reduce((s, a) => s + a.x, 0) / here.length, here.reduce((s, a) => s + a.y, 0) / here.length];
}

/** "Nia · Heading to the workshop — tools are low". */
export function personCaption(a: Agent): string {
  const why = a.action.reason ? ` — ${a.action.reason}` : '';
  return `${first(a)} · ${a.action.label}${why}`;
}

/** Every shot worth considering right now, scored before repeat penalties. */
export function candidates(sim: Sim, rand: () => number = Math.random): Shot[] {
  const out: Shot[] = [];
  const now = sim.time;

  // Fresh news about someone: go and see them.
  for (const e of sim.activity) {
    if (now - e.t > NEWS_WINDOW) continue;
    const a = sim.agent(e.agentId);
    const w = e.weight ?? 0;
    if (a && w >= NOTABLE) {
      out.push({ key: `agent:${a.id}`, kind: 'news', x: a.x, y: a.y, follow: a.id, span: 14, caption: e.text, score: w * 8 + (w >= HEADLINE ? 6 : 0) - (now - e.t) / 10, hold: 14, at: e.t });
    } else if (a && e.kind === 'social' && e.otherId !== undefined && now - e.t <= MOMENT_WINDOW && e.tone !== 'good') {
      // Arguments and fallings-out; plain good chats are too common to chase.
      out.push({ key: `agent:${a.id}`, kind: 'moment', x: a.x, y: a.y, follow: a.id, span: 12, caption: e.text, score: 14, hold: 10 });
    } else if (a && e.kind === 'social' && /friends now/.test(e.text) && now - e.t <= MOMENT_WINDOW) {
      out.push({ key: `agent:${a.id}`, kind: 'moment', x: a.x, y: a.y, follow: a.id, span: 12, caption: e.text, score: 12, hold: 10 });
    }
  }

  // Crowds: the park event, birthday parties, the office party. The founders' park is open ground rather than a
  // building, so park events are framed on the crowd itself.
  const ev = sim.events;
  const rally = sim.election?.stage === 'rally' ? sim.election : null;
  if (parkEventUntil(sim) > now && (ev.festival || rally)) {
    const crowd = rally ? rally.candidates.map((c) => c.id) : [...ev.festival!.attendees];
    const at = centroid(sim, crowd);
    if (at) {
      const caption = rally ? 'The election rally in the park' : `${ev.festival?.name ?? 'The festival'} in the park`;
      out.push({ key: 'park', kind: 'gathering', x: at[0], y: at[1], span: 30, caption, score: 26, hold: 15 });
    }
  }
  for (const b of ev.birthdays) {
    const home = sim.building(sim.town.households[b.household]?.building);
    const host = sim.agent(b.hosts[0]);
    if (!home || !host || b.guests.size === 0) continue;
    const [x, y] = center(home);
    out.push({ key: `building:${home.id}`, kind: 'gathering', x, y, span: 16, caption: `${first(host)}'s birthday party`, score: 18 + Math.min(6, b.guests.size), hold: 12 });
  }
  if (ev.party && ev.party.attendees.size >= 3) {
    const office = sim.map.buildings.find((b) => b.kind === 'office');
    if (office) {
      const [x, y] = center(office);
      out.push({ key: `building:${office.id}`, kind: 'gathering', x, y, span: 18, caption: 'Friday party at the office', score: 14, hold: 12 });
    }
  }

  // Building sites, best near the end when the roof goes on.
  for (const pr of sim.projects) {
    if (pr.builders.size === 0) continue;
    const done = pr.progress / pr.work;
    out.push({
      key: `site:${pr.id}`, kind: 'build', x: pr.x + pr.w / 2, y: pr.y + pr.h / 2, span: 18,
      caption: `${pr.name} · ${Math.floor(done * 100)}% built`, score: 7 + (done > 0.8 ? 7 : 0) + pr.builders.size, hold: 11,
    });
  }

  // Quiet life: a few people doing something nice, picked at random so it isn't always the same ones.
  const quiet = sim.agents.filter((a) => QUIET[a.action.kind] !== undefined && a.action.stage === 'perform');
  for (let i = 0; i < 4 && quiet.length; i++) {
    const a = quiet.splice(Math.floor(rand() * quiet.length), 1)[0];
    const together = a.action.kind === 'stroll' && a.action.partnerId !== undefined ? 3 : 0;
    out.push({ key: `agent:${a.id}`, kind: 'quiet', x: a.x, y: a.y, follow: a.id, span: 12, caption: personCaption(a), score: QUIET[a.action.kind]! + together + rand() * 4, hold: 12 });
  }

  // After dark nearly everyone is asleep, so show the night itself: lit windows, someone up late, the lake.
  if (isNight(sim.hour)) night(sim, out, rand);

  // The whole town, now and then and after rain or snow starts.
  const bx = establishing(sim);
  if (bx) {
    const weather = ev.snowstorm ? 'A blizzard over' : ev.rain ? 'Rain over' : '';
    out.push({ ...bx, caption: weather ? `${weather} ${sim.date()}` : sim.date(), score: 4 + (ev.rain || ev.snowstorm ? 4 : 0), hold: isNight(sim.hour) ? NIGHT_HOLD : bx.hold });
  }
  return out;
}

/** Real seconds to linger on a night shot: little changes in the dark, so don't re-cut as often. */
const NIGHT_HOLD = 18;

/** The middle of the water outside the founders' town, cached per map. */
const lakes = new WeakMap<TownMap, [number, number] | null>();
function lakeCenter(m: TownMap): [number, number] | null {
  if (lakes.has(m)) return lakes.get(m)!;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if ((x >= CORE_W || y >= CORE_H) && m.ground[m.idx(x, y)] === 'water') {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  const at: [number, number] | null = n ? [sx / n, sy / n] : null;
  lakes.set(m, at);
  return at;
}

/** Night-time shots: homes with sleepers behind lit windows, anyone still up, and the lake under the moon. */
function night(sim: Sim, out: Shot[], rand: () => number): void {
  const asleep = new Map<number, number>();
  const up: Agent[] = [];
  for (const a of sim.agents) {
    if (a.action.kind === 'sleep') asleep.set(a.household, (asleep.get(a.household) ?? 0) + 1);
    else if (a.action.stage === 'perform' && QUIET[a.action.kind] === undefined) up.push(a);
  }
  const homes = [...asleep.keys()].map((h) => sim.building(sim.town.households[h]?.building)).filter((b): b is Building => !!b);
  // Several homes to choose from, so a town fast asleep with no lake doesn't cycle three shots all night.
  for (let i = 0; i < 6 && homes.length; i++) {
    const b = homes.splice(Math.floor(rand() * homes.length), 1)[0];
    const [x, y] = center(b);
    out.push({ key: `home:${b.id}`, kind: 'quiet', x, y, span: 14, caption: `Quiet night at ${b.name}`, score: 5 + rand() * 2, hold: NIGHT_HOLD });
  }
  if (up.length) {
    const a = up[Math.floor(rand() * up.length)];
    out.push({ key: `agent:${a.id}`, kind: 'quiet', x: a.x, y: a.y, follow: a.id, span: 12, caption: `Up late · ${personCaption(a)}`, score: 6 + rand() * 2, hold: NIGHT_HOLD });
  }
  const lake = lakeCenter(sim.map);
  if (lake) out.push({ key: 'lake', kind: 'quiet', x: lake[0], y: lake[1], span: 40, caption: 'The lake at night', score: 4.5, hold: NIGHT_HOLD });
}

/** A wide shot over every building. */
function establishing(sim: Sim): Omit<Shot, 'caption' | 'score'> | null {
  const bs = sim.map.buildings;
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map((b) => b.x));
  const x1 = Math.max(...bs.map((b) => b.x + b.w));
  const y0 = Math.min(...bs.map((b) => b.y));
  const y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { key: 'town', kind: 'establishing', x: (x0 + x1) / 2, y: (y0 + y1) / 2, span: Math.max(x1 - x0, ((y1 - y0) * 16) / 9) + 6, hold: 9 };
}

/**
 * The next shot: the best candidate after dropping anything shown within REPEAT_WINDOW (unless it is fresh
 * headline news since then), the shot we are on, and, a little, another shot of the same kind. If that leaves
 * nothing, the least recently shown candidate other than the current one is better than standing still.
 * `shown` maps shot keys to the game time they were last on screen.
 */
export function pickShot(sim: Sim, shown: ReadonlyMap<string, number>, last?: Pick<Shot, 'key' | 'kind'>, rand: () => number = Math.random): Shot | null {
  const all = candidates(sim, rand);
  const others = all.filter((s) => s.key !== last?.key);
  const pool = others.length ? others : all;
  const fresh = pool.filter((s) => {
    const t = shown.get(s.key);
    return t === undefined || sim.time - t >= REPEAT_WINDOW || (s.at !== undefined && s.at > t && s.score >= URGENT_SCORE);
  });
  let best: Shot | null = null;
  let bestScore = -Infinity;
  for (const s of fresh.length ? fresh : pool) {
    const t = shown.get(s.key);
    // Only matters in the fallback: prefer what has been off screen the longest.
    const repeat = t === undefined ? 0 : 30 * Math.max(0, 1 - (sim.time - t) / REPEAT_WINDOW);
    const score = s.score - repeat - (s.kind === last?.kind ? 4 : 0);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/**
 * True if this shot should cut in on the current one right away: a fresh headline or a crowd forming, unless
 * the camera was just there (a town-wide fair would otherwise pull it back every few seconds).
 */
export function urgent(sim: Sim, s: Shot, shown: ReadonlyMap<string, number>): boolean {
  const t = shown.get(s.key);
  return s.score >= URGENT_SCORE && (t === undefined || sim.time - t > REPEAT_WINDOW);
}
