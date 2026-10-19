import { ROLES } from './defs';
import { addMemory, first, shiftOpinion, think } from './social';
import type { Sim } from './sim';

export interface EventState {
  standup: { until: number; attendees: Set<number> } | null;
  pizza: { until: number } | null;
  party: { until: number; attendees: Set<number> } | null;
  rain: { until: number } | null;
  coffeeBroken: boolean;
  /** Day the schedule below was planned for. */
  plannedDay: number;
  plan: { at: number; kind: 'standup' | 'pizza' | 'party' | 'coffee' | 'rain'; length: number }[];
}

export function initialEvents(): EventState {
  return { standup: null, pizza: null, party: null, rain: null, coffeeBroken: false, plannedDay: -1, plan: [] };
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
