import { ageOf, createAgent, surnameOf } from './agents';
import { ADULT_AGE, RETIRE_AGE, ROLES } from './defs';
import { graveSlots } from '../world/blueprints';
import { beginCareer, chooseCareer, finishApprenticeships } from './careers';
import { allocateRoles, capacity, familyOf, members, moveTo, newHousehold, setRole } from './planner';
import { addMemory, first, rel, say, think } from './social';
import type { Agent } from './types';
import type { Sim } from './sim';

const related = (a: Agent, b: Agent) =>
  a.parents.includes(b.id) || b.parents.includes(a.id) || a.parents.some((p) => b.parents.includes(p));

/** People are checked a few times a day for life events. */
export function tickLife(sim: Sim, dt: number): void {
  sim.timers.life -= dt;
  if (sim.timers.life > 0) return;
  sim.timers.life = 120;
  growUp(sim);
  finishApprenticeships(sim);
  romance(sim);
  births(sim);
  deaths(sim);
  sim.timers.arrival -= 120;
  if (sim.timers.arrival <= 0) {
    sim.timers.arrival = sim.rng.range(1.2, 2.4) * 1440;
    newcomers(sim, sim.rng.int(1, 3), false);
  }
}

function growUp(sim: Sim): void {
  for (const a of sim.agents) {
    const age = ageOf(sim, a);
    a.age = Math.floor(age);
    if (a.role === 'child' && age >= ADULT_AGE) {
      // A trade chosen by aptitude, family, role models and what the town needs.
      beginCareer(sim, a, chooseCareer(sim, a), setRole);
      a.money = 40;
      addMemory(sim, a, 'grewUp');
      think(sim, a, `Eighteen! Time to pull my weight as a ${ROLES[a.role].title.toLowerCase()}.`, 'good');
      allocateRoles(sim);
    } else if (a.role !== 'retired' && a.role !== 'child' && age >= RETIRE_AGE) {
      setRole(sim, a, 'retired', null);
      think(sim, a, 'Retirement. I could get used to this.', 'good');
      sim.log(`${a.name} retired at ${Math.floor(age)}`, 'family', 'neutral', a);
      allocateRoles(sim);
    }
  }
}

function romance(sim: Sim): void {
  const singles = sim.agents.filter((a) => !a.partner && ageOf(sim, a) >= 20);
  for (const a of singles) {
    if (a.partner) continue;
    for (const b of singles) {
      if (b.id <= a.id || b.partner || related(a, b)) continue;
      if (Math.abs(ageOf(sim, a) - ageOf(sim, b)) > 15) continue;
      const ra = rel(a, b);
      const rb = rel(b, a);
      if (ra.opinion < 55 || rb.opinion < 55 || ra.familiarity < 30) continue;
      if (!sim.rng.chance(0.25)) continue;
      a.partner = b.id;
      b.partner = a.id;
      ra.opinion = Math.min(100, ra.opinion + 15);
      rb.opinion = Math.min(100, rb.opinion + 15);
      addMemory(sim, a, 'newPartner', b);
      addMemory(sim, b, 'newPartner', a);
      say(sim, a, '♥', 'good', 20);
      say(sim, b, '♥', 'good', 20);
      think(sim, a, `${first(b)} and I are together now.`, 'good');
      think(sim, b, `I think ${first(a)} might be the one.`, 'good');
      sim.log(`${first(a)} and ${first(b)} fell in love`, 'family', 'good', a, b);
      // Move in together right away if one of their homes has room for the other.
      for (const [stay, go] of [[a, b], [b, a]] as const) {
        const fam = familyOf(sim, go).filter((x) => x.id !== stay.id && x.household === go.household);
        if (sim.town.households[stay.household].building >= 0 && capacity(sim, stay.household) - members(sim, stay.household).length >= fam.length) {
          moveTo(sim, fam, stay.household);
          for (const f of fam) addMemory(sim, f, 'movedIn');
          sim.log(`${first(go)} moved in with ${first(stay)}`, 'family', 'good', go, stay);
          break;
        }
      }
      break;
    }
  }
}

function births(sim: Sim): void {
  for (const a of sim.agents) {
    const b = sim.agent(a.partner ?? undefined);
    if (!b || a.id > b.id || a.household !== b.household) continue;
    const ages = [ageOf(sim, a), ageOf(sim, b)];
    if (ages.some((x) => x < 20 || x > 50)) continue;
    const kids = new Set([...a.children, ...b.children]).size;
    if (kids >= 3) continue;
    if (sim.town.households[a.household].building < 0) continue;
    if (capacity(sim, a.household) <= members(sim, a.household).length) continue;
    const youngest = Math.max(-Infinity, ...[...a.children, ...b.children].map((id) => sim.person(id)?.birth ?? -Infinity));
    if (sim.time - youngest < 2 * 1440) continue;
    if (!sim.rng.chance(0.04)) continue;
    const baby = createAgent(sim, { role: 'child', household: a.household, age: 0, parents: [a, b], cell: a.at });
    sim.agents.push(baby);
    sim.populationVersion++;
    for (const p of [a, b]) {
      addMemory(sim, p, 'newBaby', baby);
      think(sim, p, `Welcome to the world, little ${first(baby)}.`, 'good');
    }
    for (const gp of [...a.parents, ...b.parents].map((id) => sim.agent(id)).filter(Boolean) as Agent[]) addMemory(sim, gp, 'newBaby', baby);
    sim.log(`${first(a)} and ${first(b)} welcomed a baby, ${first(baby)}`, 'family', 'good', a, b);
    sim.milestone(`${baby.name} was born`);
  }
}

function deaths(sim: Sim): void {
  for (const a of [...sim.agents]) {
    const age = ageOf(sim, a);
    if (age < 70) continue;
    // Roughly one in four makes it to 80; almost no one past 92.
    if (!sim.rng.chance(Math.min(0.5, ((age - 70) / 22) ** 2 * 0.12))) continue;
    die(sim, a, `old age at ${Math.floor(age)}`);
  }
}

export function die(sim: Sim, a: Agent, cause: string): void {
  if (a.action.propId !== undefined && sim.reserved.get(a.action.propId) === a.id) sim.reserved.delete(a.action.propId);
  sim.agents = sim.agents.filter((x) => x.id !== a.id);
  sim.deceased.push(a);
  sim.populationVersion++;
  const partner = sim.agent(a.partner ?? undefined);
  if (partner) partner.partner = null;
  for (const o of sim.agents) {
    const close = o.id === a.partner || a.children.includes(o.id) || a.parents.includes(o.id) || (o.relations.get(a.id)?.opinion ?? 0) >= 40;
    if (close) {
      addMemory(sim, o, 'grief', a, o.id === a.partner ? 1.4 : 1);
      think(sim, o, `I can't believe ${first(a)} is gone.`, 'bad');
    }
  }
  sim.log(`${a.name} passed away (${cause})`, 'family', 'bad', a);
  sim.milestone(`${a.name} passed away`);
  if (!bury(sim, a.id)) sim.unburied.push(a.id);
}

/** Lays someone to rest in the first free plot. False if there's no cemetery with room. */
export function bury(sim: Sim, id: number): boolean {
  const a = sim.person(id);
  if (!a) return true;
  const m = sim.map;
  for (const b of m.buildings) {
    if (b.kind !== 'cemetery') continue;
    const slot = graveSlots(b).find((s) => !m.propsOn(s.x, s.y).length);
    if (!slot) continue;
    m.addProp({ key: 'grave', drawn: true, x: slot.x, y: slot.y, w: 1, h: 1, building: b.id, about: a.id, label: a.name });
    return true;
  }
  return false;
}

/** Newcomers walk in from the east road. With force, they come even if there's nowhere to live. */
export function newcomers(sim: Sim, n: number, force: boolean): Agent[] {
  const pop = sim.agents.length;
  const avgMood = sim.agents.reduce((s, a) => s + a.mood, 0) / Math.max(1, pop);
  const homes = sim.town.households.filter((h) => h.building >= 0).map((h) => ({ h, room: capacity(sim, h.id) - members(sim, h.id).length })).filter((x) => x.room > 0);
  const room = homes.reduce((s, x) => s + x.room, 0);
  if (!force) {
    if (room < 1 || avgMood < 45 || sim.stock.food < pop * 2) return [];
    n = Math.min(n, room);
  }
  const m = sim.map;
  const cell = m.idx(m.w - 1, 27);
  // A pair might be a couple; a trio is sometimes a family with a kid.
  const family = n >= 2 && sim.rng.chance(0.55);
  let hh: number;
  const whole = homes.find((x) => x.room >= n);
  if (whole) hh = whole.h.id;
  else if (force) hh = newHousehold(sim, 'Newcomers').id;
  else hh = homes[0].h.id;
  const made: Agent[] = [];
  for (let i = 0; i < n; i++) {
    const kid = family && i === 2;
    const age = kid ? sim.rng.range(4, 12) : sim.rng.range(20, 40);
    const a = createAgent(sim, { role: kid ? 'child' : 'laborer', household: hh, age, cell, surname: family && made[0] ? surnameOf(made[0].name) : undefined, parents: kid ? made.slice(0, 2) : [] });
    a.at = m.idx(m.w - 1 - i, 27);
    a.x = a.px = m.cx(a.at);
    a.y = a.py = m.cy(a.at);
    made.push(a);
    sim.agents.push(a);
    // If they didn't land a home they at least have each other; place them with any room, else homeless.
    if (!whole && !force && homes[i]) a.household = homes[Math.min(i, homes.length - 1)].h.id;
  }
  if (family && made.length >= 2) {
    made[0].partner = made[1].id;
    made[1].partner = made[0].id;
    made[0].relations.set(made[1].id, { opinion: 80, familiarity: 95, lastTalk: -Infinity });
    made[1].relations.set(made[0].id, { opinion: 80, familiarity: 95, lastTalk: -Infinity });
  }
  for (const a of made) {
    think(sim, a, 'So this is Northwind. Smaller than I pictured.', 'neutral');
    for (const b of made) if (a.id !== b.id && !a.relations.has(b.id)) a.relations.set(b.id, { opinion: 30, familiarity: 50, lastTalk: -Infinity });
  }
  sim.populationVersion++;
  const names = made.map(first);
  const where = sim.town.households[made[0].household];
  sim.log(`${family ? 'A family' : names.length > 1 ? 'Newcomers' : 'A newcomer'} arrived: ${names.join(', ')}${where.building < 0 ? ', with nowhere to live yet' : ''}`, 'family', 'good', made[0], made[1]);
  allocateRoles(sim);
  return made;
}
