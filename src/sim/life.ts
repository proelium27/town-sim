import { inherit, succession } from './business';
import { ageOf, createAgent, surnameOf } from './agents';
import { ADULT_AGE, RETIRE_AGE, ROLES } from './defs';
import { graveSlots } from '../world/blueprints';
import { beginCareer, chooseCareer, finishApprenticeships } from './careers';
import { tickTownHealth } from './health';
import { allocateRoles, capacity, members, moveTo, newHousehold, setRole } from './planner';
import { dreaming, tickAspirations } from './aspirations';
import { courtship, scheduleFuneral } from './rites';
import { addMemory, first, kinship, think } from './social';
import { HEADLINE, NOTABLE, type Agent } from './types';
import type { Sim } from './sim';

/** People are checked a few times a day for life events. */
export function tickLife(sim: Sim, dt: number): void {
  sim.timers.life -= dt;
  if (sim.timers.life > 0) return;
  sim.timers.life = 120;
  growUp(sim);
  finishApprenticeships(sim);
  courtship(sim);
  tickAspirations(sim);
  births(sim);
  tickTownHealth(sim);
  takeInChildren(sim);
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
      sim.log(`${a.name} retired at ${Math.floor(age)}`, 'family', 'neutral', a).weight = NOTABLE;
      allocateRoles(sim);
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
    // A parent dreaming of a big family makes it a little likelier.
    if (!sim.rng.chance(dreaming(a, 'family') || dreaming(b, 'family') ? 0.06 : 0.04)) continue;
    const baby = createAgent(sim, { role: 'child', household: a.household, age: 0, parents: [a, b], cell: a.at });
    sim.agents.push(baby);
    sim.populationVersion++;
    for (const p of [a, b]) {
      addMemory(sim, p, 'newBaby', baby);
      think(sim, p, `Welcome to the world, little ${first(baby)}.`, 'good');
    }
    for (const gp of [...a.parents, ...b.parents].map((id) => sim.agent(id)).filter(Boolean) as Agent[]) addMemory(sim, gp, 'newBaby', baby);
    sim.log(`${first(a)} and ${first(b)} welcomed a baby, ${first(baby)}`, 'family', 'good', a, b).weight = HEADLINE;
    sim.milestone(`${baby.name} was born`);
  }
}

export function die(sim: Sim, a: Agent, cause: string): void {
  if (a.action.propId !== undefined && sim.reserved.get(a.action.propId) === a.id) sim.reserved.delete(a.action.propId);
  const wasMayor = sim.mayor === a.id;
  a.diedAt = sim.time;
  // Their savings and any business pass to family before they're gone from the list.
  inherit(sim, a);
  succession(sim, a);
  sim.agents = sim.agents.filter((x) => x.id !== a.id);
  sim.deceased.push(a);
  sim.populationVersion++;
  const partner = sim.agent(a.partner ?? undefined);
  if (partner) partner.partner = null;
  // Whoever they were courting or engaged to is free again (and grieves below, like family).
  const sweetheart = sim.agent(a.court?.with);
  if (sweetheart) sweetheart.court = undefined;
  for (const o of sim.agents) {
    const close = o.id === a.partner || o.id === sweetheart?.id || a.children.includes(o.id) || a.parents.includes(o.id) || (o.relations.get(a.id)?.opinion ?? 0) >= 40;
    if (close) {
      addMemory(sim, o, 'grief', a, o.id === a.partner ? 1.4 : 1);
      think(sim, o, `I can't believe ${first(a)} is gone.`, 'bad');
    }
  }
  sim.log(`${a.name} passed away (${cause})`, 'family', 'bad', a).weight = HEADLINE;
  if (sim.mayor === a.id) {
    sim.mayor = null;
    sim.log(`${sim.name} is without a mayor until the next election`, 'event', 'bad').weight = HEADLINE;
  }
  sim.milestone(`${a.name} passed away`);
  if (bury(sim, a.id)) scheduleFuneral(sim, a, wasMayor);
  else sim.unburied.push(a.id);
  takeInChildren(sim);
}

const isMinor = (sim: Sim, a: Agent) => ageOf(sim, a) < ADULT_AGE;

/** How close a grown-up is to a child, lower is closer: 0 parent, 1 grandparent, 2 sibling, 3 aunt or uncle, 4 other family. */
function kinRank(sim: Sim, kid: Agent, b: Agent): number | null {
  const k = kinship(sim, kid, b);
  if (k === 'parent') return 0;
  if (k === 'grandparent') return 1;
  if (k === 'sibling') return 2;
  if (kid.parents.some((p) => sim.person(p)?.parents.some((gp) => b.parents.includes(gp)))) return 3;
  return k ? 4 : null;
}

const KIN_WORD = ['their parent', 'their grandparent', 'their big sibling', "their parent's sibling", 'their relative'];

/** Children left in a household with no grown-up go to live with the closest kin, else the home with the most spare beds. */
export function takeInChildren(sim: Sim): void {
  for (const h of sim.town.households) {
    const kids = members(sim, h.id);
    if (!kids.length || !kids.every((x) => isMinor(sim, x))) continue;
    const room = (hh: number) => capacity(sim, hh) - members(sim, hh).length;
    let best: { hh: number; rank: number; room: number; host?: Agent } | null = null;
    for (const b of sim.agents) {
      if (b.household === h.id || isMinor(sim, b) || sim.town.households[b.household].building < 0) continue;
      const ranks = kids.map((k) => kinRank(sim, k, b)).filter((r): r is number => r !== null);
      if (!ranks.length) continue;
      const c = { hh: b.household, rank: Math.min(...ranks), room: room(b.household), host: b };
      if (!best || c.rank < best.rank || (c.rank === best.rank && c.room > best.room)) best = c;
    }
    if (!best) {
      for (const o of sim.town.households) {
        // The home with the most spare beds; a crowded one beats a house with no grown-up.
        if (o.id === h.id || o.building < 0) continue;
        if (!members(sim, o.id).some((x) => !isMinor(sim, x))) continue;
        if (!best || room(o.id) > best.room) best = { hh: o.id, rank: 5, room: room(o.id) };
      }
    }
    if (!best) continue;
    moveTo(sim, kids, best.hh);
    const names = kids.map(first).join(' and ');
    const host = best.host;
    for (const k of kids) think(sim, k, host ? `I'm going to live with ${first(host)} now.` : 'A new home, with new people.', 'neutral');
    sim.log(host ? `${names} went to live with ${KIN_WORD[best.rank]} ${first(host)}` : `${names} went to live at ${sim.town.households[best.hh].name}`, 'family', 'neutral', kids[0], host).weight = NOTABLE;
  }
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
    // If they didn't land a home they at least have each other; place them with any room (a kid stays with a parent), else homeless.
    if (!whole && !force && homes[i]) a.household = kid ? made[0].household : homes[Math.min(i, homes.length - 1)].h.id;
  }
  if (family && made.length >= 2) {
    made[0].partner = made[1].id;
    made[1].partner = made[0].id;
    made[0].relations.set(made[1].id, { opinion: 80, familiarity: 95, lastTalk: -Infinity });
    made[1].relations.set(made[0].id, { opinion: 80, familiarity: 95, lastTalk: -Infinity });
  }
  for (const a of made) {
    think(sim, a, `So this is ${sim.name}. Smaller than I pictured.`, 'neutral');
    for (const b of made) if (a.id !== b.id && !a.relations.has(b.id)) a.relations.set(b.id, { opinion: 30, familiarity: 50, lastTalk: -Infinity });
  }
  sim.populationVersion++;
  const names = made.map(first);
  const where = sim.town.households[made[0].household];
  sim.log(`${family ? 'A family' : names.length > 1 ? 'Newcomers' : 'A newcomer'} arrived: ${names.join(', ')}${where.building < 0 ? ', with nowhere to live yet' : ''}`, 'family', 'good', made[0], made[1]).weight = HEADLINE;
  allocateRoles(sim);
  return made;
}
