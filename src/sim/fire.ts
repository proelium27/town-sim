import type { Building, BuildingKind } from '../world/map';
import { canFight, replan } from './ai';
import { addMemory, first, think } from './social';
import { Rng } from './rng';
import type { Sim } from './sim';
import { type Agent, HEADLINE, NOTABLE } from './types';

/**
 * Fire. Rare, and worse in a dry summer or a drought, from a winter hearth, a kiln, or lightning in a storm. A fire
 * grows, scorches the building it's in and can jump to close neighbours; whoever is near drops what they're doing to
 * fight it with buckets (faster with a well close by, or in the rain). Buildings are never lost outright: a fire that
 * nobody fights burns itself out and leaves a shell builders can repair. A home burned past GUTTED can't be lived in
 * until then. Planks-and-bricks buildings from the workshop burn slower.
 */

export interface Fire {
  building: number;
  /** 0..1: how fierce it is. */
  heat: number;
  started: number;
  cause: string;
  /** Game minute of the next shout of "Fire!". */
  alarm?: number;
}

/** Buildings that can catch: anything with a roof. */
const BURNS: BuildingKind[] = ['house', 'office', 'cafe', 'market', 'library', 'school', 'storehouse', 'workshop', 'clinic'];
/** Damage past which a home can't be slept in until builders have repaired it. */
export const GUTTED = 0.6;
/** Firefighters work within this many tiles of a well at a bucket line's full pace. */
export const WELL_REACH = 25;
/** Builder-minutes to repair a fully burned-out building, and the wood it takes. */
/** How far a fierce fire throws sparks: across a path to the next house in a row. */
const SPREAD = 3;
export const REPAIR_WORK = 180;
export const REPAIR_WOOD = 20;
/**
 * Burn damage below this is just soot: nobody goes out to repair it (the soot tint is too faint to see), and it
 * fades over the next day or so on its own.
 */
export const REPAIR_AT = 0.05;
/**
 * How hard a fire is to put out. A bucket line has only so many places: past LINE_MAX people there's nowhere to stand,
 * so a crowd doesn't help. Each person beats back BEAT of the fire's heat a minute (a well close by makes that go
 * further, rain further still) against GROW of its own, and the building takes DAMAGE of its fabric a minute at full
 * heat. Measured over triggered fires (two seeds, a home by day, at night, in rain and in drought, each with and without
 * a well), the old 0.0025 a head with no cap and 0.004 damage put every fire out in 10-33 minutes at 0-2% damage, with
 * 8-11 people on the line. Now a daytime crew with a well saves the house in about half an hour with a visible scorch;
 * a drought fire is harder, and two or three people at night can't hold one.
 */
export const LINE_MAX = 7;
const BEAT = 0.002;
const GROW = 0.011;
const DAMAGE = 0.012;
/** Sleepers this close (tiles) to a fire wake to the shouting, as do sleepers this close to anyone who is already up and answering it. */
export const SLEEPER_RADIUS = 25;
export const NEIGHBOUR_RADIUS = 14;

/** Daily odds that a fire starts somewhere in town. A few in-game years apart on average. */
function dailyOdds(sim: Sim): number {
  return 0.03 + (sim.season === 1 ? 0.02 : 0) + (sim.events.drought ? 0.05 : 0) + (sim.season === 3 ? 0.02 : 0);
}

const dry = (sim: Sim) => sim.season === 1 || !!sim.events.drought;

export function burns(b: Building): boolean {
  return BURNS.includes(b.kind);
}

export function fireAt(sim: Sim, building: number): Fire | undefined {
  return sim.fires.find((f) => f.building === building);
}

/** Nearest gap in tiles between two buildings' footprints. */
export function gap(a: Building, b: Building): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.max(dx, dy);
}

export function wellNear(sim: Sim, b: Building): boolean {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return sim.map.buildings.some((w) => w.kind === 'well' && Math.hypot(w.x - cx, w.y - cy) <= WELL_REACH);
}

/** True if this cell is inside a building that's on fire. */
export function burningAt(sim: Sim, cell: number): boolean {
  const room = sim.map.room[cell];
  return room >= 0 && sim.fires.some((f) => sim.building(f.building)?.rooms.includes(room));
}

/** Starts a fire in a building (no-op if it's already burning or can't burn). */
export function startFire(sim: Sim, b: Building, cause: string): Fire | undefined {
  if (!burns(b) || fireAt(sim, b.id)) return undefined;
  const f: Fire = { building: b.id, heat: 0.15, started: sim.time, cause };
  sim.fires.push(f);
  sim.firesEver = (sim.firesEver ?? 0) + 1;
  sim.log(`Fire at the ${b.name} (${cause})!`, 'event', 'alert').weight = HEADLINE;
  return f;
}

/** Where a fire starts and why, weighted by what's likely to spark. */
function pickSpark(sim: Sim): { b: Building; cause: string } | undefined {
  const cands = sim.map.buildings.filter((b) => burns(b) && !fireAt(sim, b.id));
  if (!cands.length) return undefined;
  const weight = (b: Building) => {
    const hh = sim.town.households.find((h) => h.building === b.id);
    const hearth = sim.season === 3 && hh && sim.fuel[hh.id] > 0 ? 2 : 1;
    const kiln = b.kind === 'workshop' ? 2 : 1;
    return hearth * kiln * (b.sturdy ? 0.5 : 1);
  };
  const total = cands.reduce((s, b) => s + weight(b), 0);
  let r = sim.rng.range(0, total);
  const b = cands.find((x) => (r -= weight(x)) <= 0) ?? cands[cands.length - 1];
  const hh = sim.town.households.find((h) => h.building === b.id);
  const cause =
    b.kind === 'workshop' ? 'a spark from the kiln'
      : sim.season === 3 && hh ? 'an ember from the hearth'
        : dry(sim) ? 'the dry heat'
          : 'a lamp knocked over';
  return { b, cause };
}

/** Lightning from a storm sometimes finds a roof. */
export function lightning(sim: Sim): void {
  const roofs = sim.map.buildings.filter((b) => burns(b) && !fireAt(sim, b.id));
  if (roofs.length && sim.rng.chance(0.25)) startFire(sim, sim.rng.pick(roofs), 'lightning');
}

/** Minutes between shouts of "Fire!" for people nearby; the whole town is called every fifth shout. */
const ALARM_EVERY = 2;

const centreOf = (b: Building) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Up and answering the fire: on the bucket line, heading for it, or getting clear. */
const answering = (a: Agent) => a.action.kind === 'firefight' || a.action.reason === 'Fire!';

/** Everyone on the bucket line or heading for it, at this building. */
export function lineSize(sim: Sim, building: number): number {
  return sim.agents.filter((a) => a.action.kind === 'firefight' && a.action.building === building).length;
}

/**
 * Whether someone would hear the alarm for this building. Anyone up hears it from across the town; someone asleep
 * hears it from SLEEPER_RADIUS tiles, or from NEIGHBOUR_RADIUS of anyone already up and answering it.
 */
export function hearsAlarm(sim: Sim, a: Agent, b: Building): boolean {
  const c = centreOf(b);
  const d = Math.hypot(a.x - c.x, a.y - c.y);
  if (a.action.kind !== 'sleep') return d <= 60;
  if (d <= SLEEPER_RADIUS) return true;
  return sim.agents.some((o) => o !== a && answering(o) && Math.hypot(o.x - a.x, o.y - a.y) <= NEIGHBOUR_RADIUS);
}

/**
 * Raises the alarm. Only those who'd answer it are called: whoever is inside the burning building, and the able-bodied
 * (not children, the old or the ill, who are left to carry on, or to sleep). Sleepers hear it when close, or when a
 * neighbour who is already up shouts, so the word spreads from house to house. Nobody is woken once the line is full.
 */
function alarm(sim: Sim, b: Building, everyone: boolean): void {
  const called: Agent[] = [];
  const sleepers: Agent[] = [];
  for (const a of sim.agents) {
    const room = sim.roomOf(a);
    const inside = !!room && b.rooms.includes(room.id);
    if (answering(a)) {
      called.push(a);
      continue;
    }
    if (inside) {
      replan(sim, a);
      continue;
    }
    if (!canFight(sim, a)) continue;
    if (a.action.kind === 'sleep') sleepers.push(a);
    else if (everyone && hearsAlarm(sim, a, b)) replan(sim, a);
  }
  // The shout passes from house to house: each wave of sleepers woken calls the sleepers beside them.
  const c = centreOf(b);
  let asleep = sleepers;
  for (let wave = 0; wave < 3 && asleep.length && called.length < LINE_MAX; wave++) {
    const distance = (a: Agent) => Math.hypot(a.x - c.x, a.y - c.y);
    const heard = asleep
      .filter((a) => distance(a) <= SLEEPER_RADIUS || called.some((o) => Math.hypot(o.x - a.x, o.y - a.y) <= NEIGHBOUR_RADIUS))
      .sort((x, y) => distance(x) - distance(y))
      .slice(0, LINE_MAX - called.length);
    if (!heard.length) break;
    for (const a of heard) replan(sim, a);
    called.push(...heard);
    asleep = asleep.filter((a) => !heard.includes(a));
  }
}

/** People fighting this fire right now, standing at it. */
export function fighters(sim: Sim, f: Fire): Agent[] {
  return sim.agents.filter((a) => a.action.kind === 'firefight' && a.action.stage === 'perform' && a.action.building === f.building);
}

/** Each step: maybe a new fire; each fire grows or is beaten back, scorches its building, and may spread. */
export function tickFires(sim: Sim, dt: number): void {
  // Roll for a new fire once a game hour, on dice of its own, so a town's story only changes once something catches.
  sim.timers.fire -= dt;
  if (sim.timers.fire <= 0) {
    sim.timers.fire = 60;
    // A scorch too slight to be worth a repair fades on its own.
    for (const b of sim.map.buildings) {
      const d = b.damage ?? 0;
      if (d > 0 && d < REPAIR_AT && !fireAt(sim, b.id)) b.damage = Math.max(0, d - 0.004);
    }
    const dice = new Rng(sim.seed * 6151 + Math.floor(sim.time / 60) * 92821);
    dice.next(); // a fresh generator's first draw runs low; skip it
    if (dice.chance(dailyOdds(sim) / 24)) {
      const s = pickSpark(sim);
      if (s) startFire(sim, s.b, s.cause);
    }
  }
  for (const f of [...sim.fires]) {
    const b = sim.building(f.building);
    if (!b) {
      sim.fires = sim.fires.filter((x) => x !== f);
      continue;
    }
    if (sim.time >= (f.alarm ?? 0)) {
      f.alarm = sim.time + ALARM_EVERY;
      alarm(sim, b, Math.floor((sim.time - f.started + 0.5) / ALARM_EVERY) % 5 === 0);
    }
    const rain = !!sim.events.rain;
    const grow = GROW * (dry(sim) ? 1.5 : 1) * (b.sturdy ? 0.6 : 1) * (rain ? 0.4 : 1);
    const water = (wellNear(sim, b) ? 1.7 : 1) * (rain ? 1.3 : 1);
    const beat = fighters(sim, f).slice(0, LINE_MAX).reduce((s, a) => s + BEAT * (1 + a.skills.athletics.level * 0.03) * water, 0);
    f.heat = Math.min(1, f.heat + (grow - beat) * dt);
    b.damage = Math.min(1, (b.damage ?? 0) + DAMAGE * f.heat * dt);
    if (f.heat > 0.6) {
      for (const n of sim.map.buildings) {
        if (n === b || !burns(n) || fireAt(sim, n.id) || gap(b, n) > SPREAD) continue;
        if (sim.rng.chance(0.003 * (dry(sim) ? 1.5 : 1) * (rain ? 0.3 : 1) * dt)) startFire(sim, n, `sparks from the ${b.name}`);
      }
    }
    if (f.heat <= 0) putOut(sim, f, b, false);
    else if (b.damage >= 1) putOut(sim, f, b, true);
  }
}

/** The fire is out, or has burned out: tally the damage and what it cost the people who live there. */
function putOut(sim: Sim, f: Fire, b: Building, burnedOut: boolean): void {
  sim.fires = sim.fires.filter((x) => x !== f);
  const crew = fighters(sim, f);
  for (const a of crew) {
    addMemory(sim, a, 'foughtFire');
    think(sim, a, burnedOut ? `We couldn't save the ${b.name}.` : `We put it out. The ${b.name} still stands.`, burnedOut ? 'bad' : 'good');
  }
  const d = b.damage ?? 0;
  for (const hh of sim.town.households.filter((h) => h.building === b.id)) {
    // Food and firewood in the house burn with it.
    sim.pantry[hh.id] *= 1 - d;
    sim.fuel[hh.id] *= 1 - d;
    for (const a of sim.agents.filter((x) => x.household === hh.id)) {
      if (d >= 0.1) addMemory(sim, a, 'houseFire');
      if (d >= GUTTED) think(sim, a, 'Our home is a burnt shell. Where do we sleep tonight?', 'bad');
    }
  }
  const how = d >= GUTTED ? 'gutted' : d >= 0.25 ? 'badly scorched' : 'scorched';
  const who = crew.length ? `, after ${crew.length === 1 ? `${first(crew[0])} fought it alone` : `${crew.length} people fought it`}` : '';
  const text = burnedOut
    ? `The fire at the ${b.name} burned itself out, leaving it ${how}`
    : `The fire at the ${b.name} is out${who}. The building is ${how}${d >= GUTTED ? ' and needs repairing before anyone can live there' : ''}`;
  sim.log(text, 'event', d >= GUTTED ? 'bad' : 'neutral', crew[0]).weight = d >= GUTTED ? HEADLINE : NOTABLE;
  sim.milestone(burnedOut || d >= GUTTED ? `Fire gutted the ${b.name}` : `Fire scorched the ${b.name}`);
}

/** True if this home is too burned to live in. */
export function gutted(b: Building | undefined): boolean {
  return !!b && (b.damage ?? 0) >= GUTTED;
}

/** Repair: damage comes down with builders' work, a little wood at a time. Returns true when it's done. */
export function mend(sim: Sim, b: Building, work: number): boolean {
  const before = b.damage ?? 0;
  if (before <= 0 || fireAt(sim, b.id)) return true;
  const fraction = Math.min(before, work / REPAIR_WORK);
  const wood = fraction * REPAIR_WOOD;
  if (sim.stock.wood < wood) return true;
  sim.stock.wood -= wood;
  b.damage = Math.max(0, before - fraction);
  if (b.damage <= 0.001) {
    b.damage = 0;
    sim.log(`The ${b.name} is repaired`, 'build', 'good');
    return true;
  }
  return false;
}
