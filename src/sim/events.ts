import { ROLES } from './defs';
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
  festival: { until: number; attendees: Set<number> } | null;
  /** Day the schedule below was planned for. */
  plannedDay: number;
  plan: { at: number; kind: 'standup' | 'pizza' | 'party' | 'coffee' | 'rain'; length: number }[];
}

export function initialEvents(): EventState {
  return { standup: null, pizza: null, party: null, rain: null, coffeeBroken: false, drought: null, festival: null, plannedDay: -1, plan: [] };
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
  if (r.chance(0.35)) ev.plan.push({ at: base + r.range(7, 19) * 60, kind: 'rain', length: r.range(60, 220) });
  ev.plan.sort((a, b) => a.at - b.at);
}

const officeStaff = (sim: Sim) => sim.agents.filter((a) => ROLES[a.role].workplace === 'office');

export function tickEvents(sim: Sim, _dt: number): void {
  const ev = sim.events;
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
  if (ev.festival && sim.time >= ev.festival.until) {
    const people = [...ev.festival.attendees].map((id) => sim.agent(id)!).filter(Boolean);
    ev.festival = null;
    for (const a of people) addMemory(sim, a, 'festival');
    for (const a of people) for (const b of people) if (a.id !== b.id && Math.abs(a.x - b.x) < 8) shiftOpinion(sim, a, b, sim.rng.range(0, 3));
    sim.log(`The festival is over. ${people.length} townsfolk danced the night away`, 'event', 'good');
  }
  if (ev.rain && sim.time >= ev.rain.until) {
    ev.rain = null;
    sim.log('The rain cleared up', 'event', 'neutral');
  }
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

export type WorldEventKey = 'festival' | 'harvest' | 'newcomers' | 'drought' | 'storm';

export const WORLD_EVENTS: { key: WorldEventKey; label: string; hint: string; tone: 'good' | 'bad' }[] = [
  { key: 'festival', label: 'Hold a festival', hint: 'Everyone gathers in the park for a few hours', tone: 'good' },
  { key: 'harvest', label: 'Bumper harvest', hint: 'Every crop ripens at once', tone: 'good' },
  { key: 'newcomers', label: 'Send newcomers', hint: 'Three people arrive, housing or not', tone: 'good' },
  { key: 'drought', label: 'Drought', hint: 'Crops stop growing for two days', tone: 'bad' },
  { key: 'storm', label: 'Storm', hint: 'Rain, flattened crops and fallen trees', tone: 'bad' },
];

/** Player-triggered happenings. The townsfolk react on their own. */
export function triggerWorldEvent(sim: Sim, key: WorldEventKey): void {
  const ev = sim.events;
  const m = sim.map;
  switch (key) {
    case 'festival':
      ev.festival = { until: sim.time + 180, attendees: new Set() };
      sim.log('A town festival has been called in the park!', 'event', 'good');
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
      sim.log(`A storm rolled through${hit ? `, flattening ${hit.name}` : ''} and toppling ${fallen} trees`, 'event', 'bad');
      break;
    }
  }
}
