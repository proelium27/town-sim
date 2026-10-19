import { ageOf } from './agents';
import { MIN_PER_DAY, ROLES, YEAR_DAYS, YEARS_PER_DAY } from './defs';
import { fallIll } from './health';
import { TRADER_EVERY } from './market';
import { FESTIVALS } from './seasons';
import { spawnTrader } from './traffic';
import { kinship } from './social';
import { newcomers } from './life';
import { addMemory, first, shiftOpinion, think } from './social';
import type { Sim } from './sim';

export interface EventState {
  standup: { until: number; attendees: Set<number> } | null;
  pizza: { until: number } | null;
  party: { until: number; attendees: Set<number> } | null;
  rain: { until: number } | null;
  coffeeBroken: boolean;
  drought: { until: number } | null;
  festival: { until: number; attendees: Set<number>; name?: string } | null;
  /** The season's festival, scheduled when the season turns. */
  seasonal: { at: number; name: string } | null;
  /** A blizzard: bitter cold and heavy snow; people stay in. */
  snowstorm: { until: number } | null;
  /** How wet the ground is, 0..1: rises in rain, dries over a few hours. */
  wet: number;
  /** Birthday parties happening right now, one per host. */
  birthdays: Birthday[];
  /** Day the schedule below was planned for. */
  plannedDay: number;
  plan: { at: number; kind: 'standup' | 'pizza' | 'party' | 'coffee' | 'rain' | 'birthday' | 'storm' | 'snowstorm' | 'trader'; length: number; host?: number }[];
}

export interface Birthday {
  host: number;
  household: number;
  age: number;
  /** A round-number birthday: friends come too, not just family. */
  milestone: boolean;
  until: number;
  guests: Set<number>;
  cake?: number;
}

const MILESTONES = [18, 30, 50, 65, 80, 90, 100];

/** Day of the calendar year (0..7) someone was born on. */
export function birthdayOf(birth: number): number {
  const year = YEAR_DAYS * MIN_PER_DAY;
  return Math.floor((((birth % year) + year) % year) / MIN_PER_DAY);
}

export function initialEvents(): EventState {
  return { standup: null, pizza: null, party: null, rain: null, coffeeBroken: false, drought: null, festival: null, seasonal: null, snowstorm: null, wet: 0, birthdays: [], plannedDay: -1, plan: [] };
}

/** Lays out the day's happenings at midnight (or on the first tick). */
function planDay(sim: Sim): void {
  const ev = sim.events;
  const r = sim.rng;
  const base = sim.day * 24 * 60;
  ev.plannedDay = sim.day;
  ev.plan = [];
  if (!sim.weekend) {
    ev.plan.push({ at: base + 10 * 60, kind: 'standup', length: 20 });
    if (r.chance(0.3)) ev.plan.push({ at: base + 12 * 60 + 10, kind: 'pizza', length: 75 });
    if (sim.weekday === 4) ev.plan.push({ at: base + 17 * 60 + 15, kind: 'party', length: 120 });
    if (r.chance(0.25)) ev.plan.push({ at: base + r.range(9, 15) * 60, kind: 'coffee', length: 0 });
  }
  if (r.chance(sim.season === 3 ? 0.5 : 0.35)) ev.plan.push({ at: base + r.range(7, 19) * 60, kind: 'rain', length: r.range(60, 220) });
  // A trader's cart every few days.
  if (sim.day % TRADER_EVERY === 1) ev.plan.push({ at: base + 10 * 60, kind: 'trader', length: 0 });
  // Autumn brings storms; winter, the odd blizzard.
  if (sim.season === 2 && sim.seasonProgress > 0.2 && r.chance(0.18)) ev.plan.push({ at: base + r.range(10, 20) * 60, kind: 'storm', length: 0 });
  if (sim.season === 3 && r.chance(0.22)) ev.plan.push({ at: base + r.range(2, 16) * 60, kind: 'snowstorm', length: 0 });
  // Birthdays follow the calendar: once a year, on the day of the year someone was born.
  const today = sim.day % YEAR_DAYS;
  for (const a of sim.agents) {
    if (birthdayOf(a.birth) !== today || a.lastBirthday >= sim.year || sim.time - a.birth < YEAR_DAYS * MIN_PER_DAY * 0.75) continue;
    ev.plan.push({ at: base + 18 * 60, kind: 'birthday', length: 150, host: a.id });
  }
  ev.plan.sort((x, y) => x.at - y.at);
  ev.plan.sort((a, b) => a.at - b.at);
}

const officeStaff = (sim: Sim) => sim.agents.filter((a) => ROLES[a.role].workplace === 'office');

export function tickEvents(sim: Sim, dt: number): void {
  const ev = sim.events;
  ev.wet = Math.max(0, Math.min(1, ev.wet + (ev.rain ? dt / 45 : -dt / 240)));
  if (ev.plannedDay !== sim.day) planDay(sim);
  while (ev.plan.length && ev.plan[0].at <= sim.time) {
    const e = ev.plan.shift()!;
    switch (e.kind) {
      case 'standup':
        ev.standup = { until: sim.time + e.length, attendees: new Set() };
        sim.log('Daily standup is starting in the meeting room', 'event', 'neutral');
        break;
      case 'pizza':
        ev.pizza = { until: sim.time + e.length };
        sim.log('Someone ordered pizza for the office!', 'event', 'good');
        break;
      case 'party':
        ev.party = { until: sim.time + e.length, attendees: new Set() };
        sim.log('Friday party in the lounge', 'event', 'good');
        break;
      case 'coffee':
        if (!ev.coffeeBroken) {
          ev.coffeeBroken = true;
          sim.log('The office coffee machine broke down', 'event', 'bad');
        }
        break;
      case 'birthday':
        startBirthday(sim, e.host!, e.length);
        break;
      case 'storm':
      case 'snowstorm':
        triggerWorldEvent(sim, e.kind);
        break;
      case 'trader':
        spawnTrader(sim);
        break;
      case 'rain':
        if (!ev.rain) {
          ev.rain = { until: sim.time + e.length };
          sim.log('It started raining', 'event', 'neutral');
        }
        break;
    }
  }
  if (ev.standup && sim.time >= ev.standup.until) endStandup(sim);
  if (ev.pizza && sim.time >= ev.pizza.until) {
    ev.pizza = null;
    sim.log('The pizza is gone', 'event', 'neutral');
  }
  if (ev.party && sim.time >= ev.party.until) endParty(sim);
  if (ev.drought && sim.time >= ev.drought.until) {
    ev.drought = null;
    sim.log('The drought broke. The crops can grow again', 'event', 'good');
  }
  if (ev.seasonal && sim.time >= ev.seasonal.at) {
    if (!ev.festival) {
      ev.festival = { until: sim.time + 180, attendees: new Set(), name: ev.seasonal.name };
      lightBonfire(sim);
      sim.log(`${ev.seasonal.name} in the park tonight!`, 'event', 'good');
    }
    ev.seasonal = null;
  }
  if (ev.snowstorm && sim.time >= ev.snowstorm.until) {
    ev.snowstorm = null;
    sim.log('The blizzard blew itself out', 'event', 'neutral');
  }
  if (ev.festival && sim.time >= ev.festival.until) {
    const people = [...ev.festival.attendees].map((id) => sim.agent(id)!).filter(Boolean);
    ev.festival = null;
    for (const a of people) addMemory(sim, a, 'festival');
    for (const a of people) for (const b of people) if (a.id !== b.id && Math.abs(a.x - b.x) < 8) shiftOpinion(sim, a, b, sim.rng.range(0, 3));
    sim.log(`The festival is over. ${people.length} townsfolk ${sim.season === 3 ? 'warmed up together' : 'danced the night away'}`, 'event', 'good');
  }
  if (ev.rain && sim.time >= ev.rain.until) {
    ev.rain = null;
    sim.log('The rain cleared up', 'event', 'neutral');
  }
  for (const b of ev.birthdays) if (sim.time >= b.until) endBirthday(sim, b);
}

function startBirthday(sim: Sim, hostId: number, length: number): void {
  const a = sim.agent(hostId);
  if (!a || a.lastBirthday >= sim.year) return;
  a.lastBirthday = sim.year;
  const age = Math.floor(ageOf(sim, a));
  const before = age - YEAR_DAYS * YEARS_PER_DAY;
  const milestone = MILESTONES.some((m) => m > before && m <= age);
  const hh = sim.town.households[a.household];
  if (hh.building < 0) {
    addMemory(sim, a, 'birthday');
    sim.log(`${first(a)} turned ${age} with nowhere to throw a party`, 'family', 'neutral', a);
    return;
  }
  // Cake on the home's table, if it has one.
  const m = sim.map;
  const table = m.props.find((p) => p.room === hh.room && /^table/.test(p.key));
  const cake = table ? m.addProp({ key: 'cake', drawn: true, x: table.x, y: table.y, w: 1, h: 1, blocks: true }) : undefined;
  sim.events.birthdays.push({ host: a.id, household: a.household, age, milestone, until: sim.time + length, guests: new Set([a.id]), cake: cake?.id });
  think(sim, a, milestone ? `${age}! That's a big one.` : `Another year older. ${age} today.`, 'good');
  sim.log(`It's ${first(a)}'s birthday: ${age} today${milestone ? '. A big one, so friends are invited too' : ''}`, 'family', 'good', a);
}

function endBirthday(sim: Sim, b: Birthday): void {
  sim.events.birthdays = sim.events.birthdays.filter((x) => x !== b);
  const host = sim.agent(b.host);
  if (b.cake !== undefined) {
    const p = sim.map.prop(b.cake);
    if (p) sim.map.removeProp(p);
  }
  if (!host) return;
  const guests = [...b.guests].filter((id) => id !== b.host).map((id) => sim.agent(id)).filter((x): x is NonNullable<typeof x> => !!x);
  addMemory(sim, host, 'myBirthday', undefined, guests.length ? 1 + Math.min(1, guests.length / 6) : 0.4);
  for (const g of guests) {
    addMemory(sim, g, 'birthday', host);
    shiftOpinion(sim, g, host, sim.rng.range(1, 4));
    shiftOpinion(sim, host, g, sim.rng.range(2, 5));
  }
  const family = guests.filter((g) => kinship(sim, host, g)).length;
  const friends = guests.length - family;
  const who = [family && `${family} family`, friends && `${friends} friend${friends === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
  sim.log(
    guests.length ? `${first(host)}'s birthday wound down: ${who} came to celebrate` : `Nobody came to ${first(host)}'s birthday`,
    'family',
    guests.length ? 'good' : 'bad',
    host,
  );
}

/** Cold-weather festivals gather round a bonfire in the middle of the park. */
function lightBonfire(sim: Sim): void {
  if (sim.season < 2) return;
  const m = sim.map;
  for (const [x, y] of [[54, 12], [53, 12], [55, 12], [54, 11], [54, 13]]) {
    if (!m.walkable(x, y) || m.propsOn(x, y).length) continue;
    m.addProp({ key: 'bonfire', drawn: true, x, y, w: 1, h: 1, blocks: true, expires: sim.time + 180 });
    return;
  }
}

/** The birthday party this person is hosting or invited to right now, if any. */
export function birthdayFor(sim: Sim, a: { id: number }): Birthday | undefined {
  return sim.events.birthdays.find((b) => b.host === a.id || b.guests.has(a.id));
}

function endStandup(sim: Sim): void {
  const s = sim.events.standup!;
  sim.events.standup = null;
  const people = [...s.attendees].map((id) => sim.agent(id)!).filter(Boolean);
  if (!people.length) return;
  // The lead praises whoever shipped the most since last time.
  const lead = sim.agents.find((a) => a.role === 'manager');
  const star = people.filter((p) => p.role !== 'manager').sort((a, b) => b.tasksDone - a.tasksDone)[0];
  if (lead && star && star.tasksDone > 0 && sim.rng.chance(0.6)) {
    addMemory(sim, star, 'praised');
    shiftOpinion(sim, star, lead, 5);
    think(sim, star, `${first(lead)} called out my work at standup.`, 'good');
    sim.log(`${first(lead)} praised ${first(star)} at standup`, 'work', 'good', lead, star);
  }
  const missing = officeStaff(sim).filter((a) => !s.attendees.has(a.id));
  sim.log(`Standup wrapped up with ${people.length} of ${officeStaff(sim).length} there${missing.length ? ` (missing ${missing.map(first).join(', ')})` : ''}`, 'event', 'neutral');
}

function endParty(sim: Sim): void {
  const p = sim.events.party!;
  sim.events.party = null;
  const people = [...p.attendees].map((id) => sim.agent(id)!).filter(Boolean);
  for (const a of people) addMemory(sim, a, 'party');
  for (const a of people) for (const b of people) if (a.id !== b.id) shiftOpinion(sim, a, b, sim.rng.range(1, 5));
  sim.log(people.length ? `The party wound down. ${people.length} people had a good time` : 'Nobody showed up to the party', 'event', people.length ? 'good' : 'bad');
}

export type WorldEventKey = 'festival' | 'harvest' | 'newcomers' | 'trader' | 'drought' | 'storm' | 'snowstorm' | 'outbreak';

export const WORLD_EVENTS: { key: WorldEventKey; label: string; hint: string; tone: 'good' | 'bad' }[] = [
  { key: 'festival', label: 'Hold a festival', hint: 'Everyone gathers in the park for a few hours', tone: 'good' },
  { key: 'harvest', label: 'Bumper harvest', hint: 'Every crop ripens at once', tone: 'good' },
  { key: 'newcomers', label: 'Send newcomers', hint: 'Three people arrive, housing or not', tone: 'good' },
  { key: 'trader', label: 'Call a trader', hint: 'A cart comes to buy surplus and sell what is short', tone: 'good' },
  { key: 'drought', label: 'Drought', hint: 'Crops stop growing for two days', tone: 'bad' },
  { key: 'storm', label: 'Storm', hint: 'Rain, flattened crops and fallen trees', tone: 'bad' },
  { key: 'outbreak', label: 'Outbreak', hint: 'A flu starts going around town', tone: 'bad' },
  { key: 'snowstorm', label: 'Blizzard', hint: 'Heavy snow and bitter cold for six hours', tone: 'bad' },
];

/** Player-triggered happenings. The townsfolk react on their own. */
export function triggerWorldEvent(sim: Sim, key: WorldEventKey): void {
  const ev = sim.events;
  const m = sim.map;
  switch (key) {
    case 'festival':
      ev.festival = { until: sim.time + 180, attendees: new Set(), name: FESTIVALS[sim.season] };
      lightBonfire(sim);
      sim.log(`${FESTIVALS[sim.season]} in the park, called early!`, 'event', 'good');
      break;
    case 'trader':
      spawnTrader(sim);
      break;
    case 'outbreak': {
      const well = sim.agents.filter((a) => !a.illness);
      for (let k = 0; k < 3 && well.length; k++) fallIll(sim, well.splice(sim.rng.int(0, well.length - 1), 1)[0], 'flu', '');
      sim.log('A flu is going around town', 'event', 'bad');
      sim.outbreak = sim.time;
      break;
    }
    case 'snowstorm':
      if (ev.snowstorm) break;
      ev.rain = { until: sim.time + 360 };
      ev.snowstorm = { until: sim.time + 360 };
      for (const a of sim.agents) addMemory(sim, a, 'blizzard');
      sim.log('A blizzard is blowing in. Everyone hurries indoors', 'event', 'bad');
      break;
    case 'harvest':
      for (const p of m.props) if (p.use === 'farm') p.growth = 1;
      sim.log('A bumper harvest! Every field is ripe', 'event', 'good');
      break;
    case 'newcomers':
      newcomers(sim, 3, true);
      break;
    case 'drought':
      ev.drought = { until: sim.time + 2 * 1440 };
      for (const a of sim.agents) if (a.role === 'farmer' || a.needs.hunger < 50) addMemory(sim, a, 'drought');
      sim.log('A drought has begun. Nothing will grow for two days', 'event', 'bad');
      break;
    case 'storm': {
      ev.rain = { until: sim.time + 240 };
      const farms = m.buildings.filter((b) => b.kind === 'farm');
      const hit = farms.length ? sim.rng.pick(farms) : null;
      if (hit) for (const p of m.props) if (p.use === 'farm' && p.building === hit.id) p.growth = 0;
      // Some trees blow over: they come down and leave stumps.
      const trees = m.props.filter((p) => p.resource === 'wood');
      let fallen = 0;
      for (let i = 0; i < 18 && trees.length; i++) {
        const t = trees.splice(sim.rng.int(0, trees.length - 1), 1)[0];
        m.removeProp(t);
        m.addProp({ key: 'stump', drawn: true, x: t.x, y: t.y, w: 1, h: 1, blocks: false, flat: true, expires: sim.time + 1440 });
        fallen++;
      }
      for (const a of sim.agents) addMemory(sim, a, 'storm');
      for (const a of sim.agents) if (m.room[a.at] < 0 && sim.rng.chance(0.12)) fallIll(sim, a, 'injury', 'caught out in the storm');
      sim.log(`A storm rolled through${hit ? `, flattening ${hit.name}` : ''} and toppling ${fallen} trees`, 'event', 'bad');
      break;
    }
  }
}
