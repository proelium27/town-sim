import type { GroundKey } from '../assets/manifest';
import { BLUEPRINTS, type BlueprintKey } from '../world/blueprints';
import type { Household } from '../world/town';
import { ageOf, makeSchedule, newTask, surnameOf } from './agents';
import { ADULT_AGE, type Bill, billGoods, type Good, GOODS, MIN_PER_DAY, PRIORITY_WEIGHT, ROLES, type PriorityKey, type RoleKey } from './defs';
import { foodBalance } from './economy';
import { bury } from './life';
import { canSupply, CRAFT_ROLES, hasWorkshop, rawOf, RECIPES, shortfall } from './workshop';
import { addMemory, first, think } from './social';
import type { Agent, Project } from './types';
import type { Sim } from './sim';

// ------------------------------------------------------------------ households

export function householdOf(sim: Sim, a: Agent): Household {
  return sim.town.households[a.household];
}

export function members(sim: Sim, hh: number): Agent[] {
  return sim.agents.filter((a) => a.household === hh);
}

export function capacity(sim: Sim, hh: number): number {
  return sim.map.props.filter((p) => p.use === 'sleep' && p.household === hh).length;
}

export function newHousehold(sim: Sim, name: string): Household {
  const h: Household = { id: sim.town.households.length, name, room: -1, door: { x: 0, y: 0 }, building: -1 };
  sim.town.households.push(h);
  sim.pantry.push(0);
  sim.fuel.push(4);
  return h;
}

/** Moves people into another household, bringing a few groceries with them. */
export function moveTo(sim: Sim, people: Agent[], hh: number): void {
  for (const a of people) {
    if (a.household === hh) continue;
    const from = a.household;
    a.household = hh;
    if (sim.pantry[from] > 1) {
      sim.pantry[from]--;
      sim.pantry[hh]++;
    }
    // Release any bed they had reserved at the old place.
    if (a.action.kind === 'sleep' && a.action.propId !== undefined) sim.reserved.delete(a.action.propId);
  }
}

/** Partner, their shared children: the people who move together. */
export function familyOf(sim: Sim, a: Agent): Agent[] {
  const out = [a];
  const p = sim.agent(a.partner ?? undefined);
  if (p) out.push(p);
  for (const kidId of new Set([...a.children, ...(p?.children ?? [])])) {
    const k = sim.agent(kidId);
    if (k && ageOf(sim, k) < ADULT_AGE) out.push(k);
  }
  return out;
}

// ------------------------------------------------------------------ project helpers

const weight = (sim: Sim, k: PriorityKey) => PRIORITY_WEIGHT[sim.priorities[k]];

export function projectArea(pr: Project): { x: number; y: number; w: number; h: number } {
  return { x: pr.x - 1, y: pr.y - 1, w: pr.w + 2, h: pr.h + 2 };
}

/** Trees and rocks still standing on the site or its path. */
export function clutter(sim: Sim, pr: Project) {
  const m = sim.map;
  const a = projectArea(pr);
  const out = new Map<number, ReturnType<typeof m.propsOn>[number]>();
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) for (const p of m.propsOn(x, y)) if (p.resource) out.set(p.id, p);
  for (const i of pr.path) for (const p of m.propsOn(m.cx(i), m.cy(i))) if (p.resource) out.set(p.id, p);
  return [...out.values()];
}

export type Stage = 'clearing' | 'supplying' | 'building';

export function stageOf(sim: Sim, pr: Project): Stage {
  if (clutter(sim, pr).length) return 'clearing';
  if (!supplied(pr)) return pr.progress > 0 ? 'building' : 'supplying';
  return 'building';
}

/** How much of the work the delivered materials allow so far. */
export function buildCap(pr: Project): number {
  let total = 0;
  let have = 0;
  for (const g of billGoods(pr.need)) {
    total += pr.need[g]!;
    have += Math.min(pr.delivered[g] ?? 0, pr.need[g]!);
  }
  return total ? (have / total) * pr.work : pr.work;
}

/** Every material the project needs has arrived. */
export function supplied(pr: Project): boolean {
  return billGoods(pr.need).every((g) => (pr.delivered[g] ?? 0) >= pr.need[g]!);
}

/** How much more of a material the project still needs. */
export function shortOf(pr: Project, g: Good): number {
  return Math.max(0, (pr.need[g] ?? 0) - (pr.delivered[g] ?? 0));
}

// ------------------------------------------------------------------ deciding what to build

interface Proposal {
  bp: BlueprintKey;
  score: number;
  reason: string;
  forAgents: Agent[];
  proposer?: Agent;
  name: string;
}

const HOME_SUFFIX = ['home', 'house', 'cottage', 'place', 'lodge'];

/** "Reyes home", or "Reyes cottage" if that name is taken. */
function homeName(sim: Sim, a: Agent | undefined): string {
  const surname = a ? surnameOf(a.name) : 'Hillside';
  const taken = new Set([...sim.town.households.map((h) => h.name), ...sim.projects.map((p) => p.name), ...sim.map.buildings.map((b) => b.name)]);
  for (const s of HOME_SUFFIX) if (!taken.has(`${surname} ${s}`)) return `${surname} ${s}`;
  return `${a ? first(a) : 'New'}'s place ${sim.nextProjectId}`;
}

function proposals(sim: Sim): Proposal[] {
  const out: Proposal[] = [];
  const adults = sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE);
  const kids = sim.agents.filter((a) => ageOf(sim, a) >= 4 && ageOf(sim, a) < ADULT_AGE);
  const planned = new Set(sim.projects.flatMap((p) => p.forAgents));
  const charismatic = () => [...adults].sort((a, b) => b.skills.charisma.level - a.skills.charisma.level)[0];
  const count = (bp: BlueprintKey) => sim.map.buildings.filter((b) => b.kind === BLUEPRINTS[bp].kind && (bp !== 'diner' || b.name.includes('Diner'))).length + sim.projects.filter((p) => p.blueprint === bp).length;

  // ---- housing
  const hw = weight(sim, 'housing');
  for (const h of sim.town.households) {
    const mem = members(sim, h.id).filter((a) => !planned.has(a.id));
    if (!mem.length) continue;
    if (h.building < 0) {
      out.push({ bp: 'house', score: 2.2 * hw, reason: `${mem.map(first).join(' and ')} have nowhere to live`, forAgents: mem, proposer: mem[0], name: homeName(sim, mem[0]) });
    }
  }
  for (const a of adults) {
    const p = sim.agent(a.partner ?? undefined);
    if (!p || a.id > p.id || planned.has(a.id)) continue;
    const fam = familyOf(sim, a);
    const sharedHome = a.household === p.household && members(sim, a.household).every((m) => fam.includes(m));
    if (sharedHome) continue;
    // A couple living apart, or sharing with housemates, wants a place of their own.
    out.push({ bp: 'house', score: 1.45 * hw, reason: `${first(a)} and ${first(p)} want a home of their own`, forAgents: fam, proposer: a, name: homeName(sim, a) });
  }
  for (const h of sim.town.households) {
    if (h.building < 0) continue;
    const mem = members(sim, h.id).filter((a) => !planned.has(a.id));
    const cap = capacity(sim, h.id);
    if (mem.length > cap) {
      // The grown-up kids (or the newest housemate) move out.
      const movers = mem.filter((a) => ageOf(sim, a) >= ADULT_AGE && !a.partner).sort((x, y) => ageOf(sim, x) - ageOf(sim, y)).slice(0, 1);
      if (movers.length) out.push({ bp: 'house', score: 1.2 * hw, reason: `the ${h.name.replace(' home', '')} home is overcrowded`, forAgents: movers, proposer: movers[0], name: homeName(sim, movers[0]) });
    }
  }
  const spare = sim.town.households.filter((h) => h.building >= 0).reduce((n, h) => n + Math.max(0, capacity(sim, h.id) - members(sim, h.id).length), 0);
  if (spare < 2 && !sim.projects.some((p) => p.blueprint === 'house' && !p.forAgents.length)) {
    out.push({ bp: 'house', score: 0.65 * hw, reason: 'there is no room for anyone new', forAgents: [], proposer: charismatic(), name: homeName(sim, undefined) });
  }

  // ---- food
  const fw = weight(sim, 'food');
  const fb = foodBalance(sim, true);
  const plannedFarms = sim.projects.filter((p) => p.blueprint === 'farm').length;
  const deficit = fb.eat - fb.produce - plannedFarms * 50;
  // Nobody breaks new fields in winter; nothing would grow before spring.
  if (sim.season !== 3 && (deficit > 0 || sim.stock.food < sim.agents.length * 2)) {
    const farmer = sim.agents.find((a) => a.role === 'farmer');
    out.push({ bp: 'farm', score: (0.8 + Math.min(1, deficit / 40) + (sim.stock.food < sim.agents.length * 3 ? 0.6 : 0)) * fw, reason: sim.stock.food < sim.agents.length * 3 ? 'food stores are running low' : 'we will need more food as we grow', forAgents: [], proposer: farmer ?? charismatic(), name: `${['Sunny', 'River', 'Oak', 'Clover', 'Barley', 'Willow'][count('farm') % 6]} Farm` });
  }

  // ---- storage and community
  const mw = weight(sim, 'materials');
  if (count('storehouse') < 1 + Math.floor(sim.agents.length / 35)) {
    out.push({ bp: 'storehouse', score: 0.7 * mw, reason: 'the storehouse is too far for the new neighborhoods', forAgents: [], proposer: sim.agents.find((a) => a.role === 'woodcutter') ?? charismatic(), name: 'East Storehouse' });
  }
  const cw = weight(sim, 'community');
  if (kids.length >= 2 && count('school') === 0) {
    const parent = sim.agent(kids[0].parents[0]);
    out.push({ bp: 'school', score: (0.9 + kids.length * 0.08) * cw, reason: `${kids.length} kids have nowhere to learn`, forAgents: [], proposer: parent ?? charismatic(), name: 'Northwind School' });
  }
  if (sim.agents.length >= 24 && count('diner') < Math.floor(sim.agents.length / 24)) {
    out.push({ bp: 'diner', score: 0.6 * cw, reason: 'the café is packed every lunchtime', forAgents: [], proposer: sim.agents.find((a) => a.traits.includes('foodie')) ?? charismatic(), name: `${['Corner', 'Hilltop', 'Lakeside'][count('diner') % 3]} Diner` });
  }
  // A workshop once the town is big enough to keep one busy and has the timber to spare.
  if (sim.agents.length >= 22 && count('workshop') === 0 && sim.stock.wood >= 40) {
    out.push({ bp: 'workshop', score: 0.6 * mw, reason: 'we could make our own planks, bricks and furniture', forAgents: [], proposer: sim.agents.find((a) => a.role === 'builder') ?? charismatic(), name: 'Northwind Workshop' });
  }
  if (sim.unburied.length && !sim.projects.some((p) => p.blueprint === 'cemetery')) {
    const dead = sim.person(sim.unburied[0])!;
    const mourner = sim.agents.filter((a) => a.id === dead.partner || dead.children.includes(a.id) || dead.parents.includes(a.id)).find((a) => ageOf(sim, a) >= ADULT_AGE);
    const full = count('cemetery') > 0;
    out.push({
      bp: 'cemetery', score: 1.3 * cw,
      reason: full ? 'the cemetery is full' : `we have nowhere to lay ${first(dead)} to rest`,
      forAgents: [], proposer: mourner ?? charismatic(), name: full ? 'Hill Cemetery' : 'Northwind Cemetery',
    });
  }
  const avgFun = sim.agents.reduce((s, a) => s + a.needs.fun, 0) / Math.max(1, sim.agents.length);
  if (sim.agents.length >= 20 && count('park') < Math.floor(sim.agents.length / 20)) {
    out.push({ bp: 'park', score: (0.45 + (avgFun < 45 ? 0.3 : 0)) * cw, reason: 'the new neighborhoods need somewhere green', forAgents: [], proposer: charismatic(), name: `${['Maple', 'Sparrow', 'Fern'][count('park') % 3]} Park` });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ------------------------------------------------------------------ choosing a site

const BUILDABLE = new Set<GroundKey>(['grass', 'sand', 'worn', 'trail']);
const STREET = new Set<GroundKey>(['sidewalk', 'plaza', 'dirt', 'crossH', 'crossV']);

interface Site {
  x: number;
  y: number;
  doorTop: boolean;
  path: number[];
  cost: number;
}

function townCenter(sim: Sim): [number, number] {
  const bs = sim.map.buildings;
  return [bs.reduce((s, b) => s + b.x + b.w / 2, 0) / bs.length, bs.reduce((s, b) => s + b.y + b.h / 2, 0) / bs.length];
}

/** Shortest walk from a door to anything street-like, over ground that could become a path. */
function pathToStreet(sim: Sim, sx: number, sy: number, avoid: (x: number, y: number) => boolean): number[] | null {
  const m = sim.map;
  const start = m.idx(sx, sy);
  const prev = new Map<number, number>([[start, -1]]);
  const queue = [start];
  for (let qi = 0; qi < queue.length && qi < 2500; qi++) {
    const c = queue[qi];
    const x = m.cx(c);
    const y = m.cy(c);
    if (STREET.has(m.ground[c]) && c !== start) {
      const out: number[] = [];
      for (let k = prev.get(c)!; k !== -1 && k !== undefined; k = prev.get(k)!) out.push(k);
      return out;
    }
    if (STREET.has(m.ground[c]) && c === start) return [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!m.inBounds(nx, ny) || avoid(nx, ny)) continue;
      const n = m.idx(nx, ny);
      if (prev.has(n) || m.cell[n] !== 0 || m.room[n] >= 0) continue;
      const g = m.ground[n];
      if (!BUILDABLE.has(g) && !STREET.has(g)) continue;
      if (m.propsOn(nx, ny).some((p) => !p.resource && p.blocks)) continue;
      prev.set(n, c);
      queue.push(n);
    }
  }
  return null;
}

export function findSite(sim: Sim, key: BlueprintKey): Site | null {
  const m = sim.map;
  const bp = BLUEPRINTS[key];
  const [cx, cy] = townCenter(sim);
  const taken = new Set<number>();
  for (const pr of sim.projects) {
    const a = projectArea(pr);
    for (let y = a.y - 1; y < a.y + a.h + 1; y++) for (let x = a.x - 1; x < a.x + a.w + 1; x++) if (m.inBounds(x, y)) taken.add(m.idx(x, y));
    for (const i of pr.path) taken.add(i);
  }
  const cands: { x: number; y: number; score: number }[] = [];
  for (let y = 1; y + bp.h + 2 < m.h; y += 2) {
    for (let x = 1; x + bp.w + 2 < m.w; x += 2) {
      const d = Math.hypot(x + bp.w / 2 - cx, y + bp.h / 2 - cy);
      if (d > 70) continue;
      let ok = true;
      let clear = 0;
      for (let yy = y - 1; yy <= y + bp.h && ok; yy++) {
        for (let xx = x - 1; xx <= x + bp.w && ok; xx++) {
          const i = m.idx(xx, yy);
          if (!BUILDABLE.has(m.ground[i]) || m.cell[i] !== 0 || m.room[i] >= 0 || taken.has(i)) ok = false;
          else for (const p of m.propsOn(xx, yy)) {
            if (!p.resource) ok = false;
            else clear++;
          }
        }
      }
      if (!ok) continue;
      // Farms like open land a bit out of town; everything else hugs the center.
      const score = (bp.kind === 'farm' ? Math.abs(d - 30) : d) + clear * 3;
      cands.push({ x, y, score });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  const inFootprint = (c: { x: number; y: number }) => (xx: number, yy: number) => xx >= c.x - 1 && xx <= c.x + bp.w && yy >= c.y - 1 && yy <= c.y + bp.h;
  let best: Site | null = null;
  for (const c of cands.slice(0, 10)) {
    for (const doorTop of [true, false]) {
      const dx = c.x + bp.doorX;
      const dy = doorTop ? c.y - 1 : c.y + bp.h;
      const fp = inFootprint(c);
      // The door tile itself sits in the margin; the path may start there.
      const path = pathToStreet(sim, dx, dy, (xx, yy) => fp(xx, yy) && !(xx === dx && yy === dy));
      if (!path) continue;
      const cost = c.score + path.length * 0.6;
      if (!best || cost < best.cost) best = { x: c.x, y: c.y, doorTop, path: [m.idx(dx, dy), ...path].filter((i) => BUILDABLE.has(m.ground[i])), cost };
    }
    if (best && best.cost < c.score + 3) break;
  }
  return best;
}

// ------------------------------------------------------------------ project lifecycle

/** What a new project will take: the refined bill if the workshop can keep it supplied, else plain wood and stone. */
export function billFor(sim: Sim, key: BlueprintKey): Bill {
  const bp = BLUEPRINTS[key];
  return { ...(bp.refined && canSupply(sim, bp.refined) ? bp.refined : bp.cost) };
}

const RAW: Good[] = ['wood', 'stone'];

/**
 * A build that has sat a whole day waiting on workshop goods nobody is making gives up on them:
 * whatever is still owed is swapped for the wood and stone it would have been made from.
 */
export function unstick(sim: Sim): void {
  for (const pr of sim.projects) {
    const owed = billGoods(pr.need).filter((g) => !RAW.includes(g) && shortOf(pr, g) > 0);
    const waiting = owed.some((g) => sim.stock[g] < 1) && pr.progress >= buildCap(pr) - 0.5 && stageOf(sim, pr) !== 'clearing';
    if (!waiting) {
      pr.stalled = undefined;
      continue;
    }
    pr.stalled ??= sim.time;
    if (sim.time - pr.stalled < MIN_PER_DAY) continue;
    const raw: Bill = {};
    for (const g of owed) {
      rawOf(g, shortOf(pr, g), raw);
      pr.need[g] = pr.delivered[g] ?? 0;
    }
    for (const g of billGoods(raw)) pr.need[g] = (pr.need[g] ?? 0) + Math.ceil(raw[g]!);
    pr.stalled = undefined;
    sim.log(`Tired of waiting on ${owed.map((g) => GOODS[g].label.toLowerCase()).join(' and ')}, the builders will finish ${pr.name} with plain wood and stone`, 'build', 'neutral');
  }
}

function startProject(sim: Sim, p: Proposal): Project | null {
  const site = findSite(sim, p.bp);
  if (!site) return null;
  const bp = BLUEPRINTS[p.bp];
  const pr: Project = {
    id: sim.nextProjectId++,
    blueprint: p.bp,
    name: p.name,
    x: site.x,
    y: site.y,
    w: bp.w,
    h: bp.h,
    doorTop: site.doorTop,
    path: site.path,
    need: billFor(sim, p.bp),
    delivered: {},
    work: bp.work,
    progress: 0,
    reason: p.reason,
    proposedBy: p.proposer?.id,
    forAgents: p.forAgents.map((a) => a.id),
    started: sim.time,
    builders: new Set(),
  };
  sim.projects.push(pr);
  const who = p.proposer;
  sim.log(`Town meeting: ${who ? first(who) : 'the town'} proposed ${bp.noun} because ${p.reason}`, 'build', 'good', who);
  if (who) {
    addMemory(sim, who, 'proposed');
    think(sim, who, `They liked my idea: ${bp.noun}.`, 'good');
  }
  return pr;
}

export function completeProject(sim: Sim, pr: Project): void {
  const m = sim.map;
  const bp = BLUEPRINTS[pr.blueprint];
  for (const p of clutter(sim, pr)) m.removeProp(p);
  let hhId: number | undefined;
  const residents = pr.forAgents.map((id) => sim.agent(id)).filter((a): a is Agent => !!a);
  if (pr.blueprint === 'house') {
    const homeless = residents.length && sim.town.households[residents[0].household].building < 0 && residents.every((r) => r.household === residents[0].household);
    hhId = homeless ? residents[0].household : newHousehold(sim, pr.name).id;
  }
  const b = bp.stamp(m, pr.x, pr.y, pr.doorTop, pr.name, hhId);
  for (const i of pr.path) if (BUILDABLE.has(m.ground[i])) m.setGround(m.cx(i), m.cy(i), 'dirt');
  m.setGround(b.door.x, b.door.y, 'plaza');
  // Anyone standing where a wall now is steps out the front door.
  for (const a of sim.agents) {
    if (!m.walkable(m.cx(a.at), m.cy(a.at))) {
      a.at = m.idx(b.door.x, b.door.y);
      a.x = a.px = b.door.x;
      a.y = a.py = b.door.y;
      a.path = [];
      a.action.stage = 'perform';
      a.thinkIn = 0;
    }
  }
  sim.projects = sim.projects.filter((p) => p.id !== pr.id);
  if (hhId !== undefined) {
    const h = sim.town.households[hhId];
    h.building = b.id;
    h.room = b.rooms[0];
    h.door = b.door;
    if (residents.length) {
      moveTo(sim, residents, hhId);
      sim.pantry[hhId] += 3;
      for (const r of residents) {
        addMemory(sim, r, 'movedIn');
        think(sim, r, 'Our own place at last!', 'good');
      }
    }
    h.name = pr.name;
  }
  for (const id of pr.builders) {
    const a = sim.agent(id);
    if (a) addMemory(sim, a, 'builtSomething');
  }
  for (const a of sim.agents) addMemory(sim, a, 'townGrowing');
  const names = residents.map(first);
  sim.log(`${pr.name} is finished${names.length ? `. ${names.join(', ')} moved in` : ''}`, 'build', 'good', residents[0]);
  sim.milestone(`Built ${pr.name}`);
  if (pr.blueprint === 'cemetery') {
    const laid = sim.unburied.filter((id) => bury(sim, id));
    sim.unburied = sim.unburied.filter((id) => !laid.includes(id));
    if (laid.length) sim.log(`${laid.map((id) => sim.person(id)!.name).join(', ')} ${laid.length > 1 ? 'were' : 'was'} laid to rest at ${pr.name}`, 'family', 'neutral');
  }
  if (pr.blueprint !== 'house') allocateRoles(sim);
}

// ------------------------------------------------------------------ jobs


/** Shifts people in flexible jobs toward what the town needs right now. */
export function allocateRoles(sim: Sim): void {
  const m = sim.map;
  const adults = sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE && a.role !== 'retired');
  const pool = adults.filter((a) => ROLES[a.role].flexible);
  if (!pool.length) return;
  const schools = m.buildings.filter((b) => b.kind === 'school');
  const diners = m.buildings.filter((b) => b.kind === 'cafe' && b.name.includes('Diner'));
  const farms = m.buildings.filter((b) => b.kind === 'farm').length;
  const kids = sim.agents.filter((a) => ageOf(sim, a) >= 5 && ageOf(sim, a) < ADULT_AGE).length;
  const demand: [RoleKey, number, number | null][] = [];
  for (const s of schools) if (kids) demand.push(['teacher', 1, s.id]);
  for (const d of diners) demand.push(['cook', 1, d.id]);
  const hw = PRIORITY_WEIGHT[sim.priorities.housing];
  const mw = PRIORITY_WEIGHT[sim.priorities.materials];
  const fw = PRIORITY_WEIGHT[sim.priorities.food];
  demand.push(['farmer', Math.max(1, Math.round(farms * 1.5 * fw)), null]);
  if (hasWorkshop(sim)) demand.push(['carpenter', 1, null]);
  demand.push(['builder', Math.max(1, Math.round((1 + sim.projects.length * 0.8) * hw)), null]);
  // Once there's a workshop, the trades it needs (one carpenter is staffed even before builders, above).
  if (hasWorkshop(sim)) {
    for (const role of CRAFT_ROLES) {
      const batches = RECIPES.filter((r) => r.role === role).reduce((s, r) => s + shortfall(sim, r) / r.out, 0);
      if (role === 'carpenter') {
        if (batches > 6) demand.push(['carpenter', 1, null]);
      } else if (batches > 0) demand.push([role, 1, null]);
    }
  }
  // Autumn and winter need firewood split and carried to every hearth.
  const cold = sim.season >= 2 ? 1 : 0;
  const shop = hasWorkshop(sim) ? 1 : 0;
  demand.push(['woodcutter', Math.max(1, Math.round((sim.stock.wood < 60 || sim.stock.stone < 40 ? 2 : 1) * mw) + cold + shop), null]);

  const assigned = new Set<number>();
  const changes: string[] = [];
  for (const [role, n, building] of demand) {
    // Keep people where they are when possible; then pull from the least-needed.
    const already = pool.filter((a) => !assigned.has(a.id) && a.role === role && (building === null || a.workBuilding === building));
    const pick = [...already];
    for (const a of pool) {
      if (pick.length >= n) break;
      if (assigned.has(a.id) || pick.includes(a)) continue;
      pick.push(a);
    }
    for (const a of pick.slice(0, n)) {
      assigned.add(a.id);
      if (a.role !== role || (building !== null && a.workBuilding !== building)) setRole(sim, a, role, building);
      if (!already.includes(a)) changes.push(`${first(a)} is now a ${ROLES[role].title.toLowerCase()}`);
    }
  }
  for (const a of pool) if (!assigned.has(a.id) && a.role !== 'laborer') {
    setRole(sim, a, 'laborer', null);
    changes.push(`${first(a)} is helping out as a laborer`);
  }
  if (changes.length) sim.log(changes.join('; '), 'work', 'neutral');
}

export function setRole(sim: Sim, a: Agent, role: RoleKey, building: number | null): void {
  a.role = role;
  a.workBuilding = building;
  a.deskId = null;
  if (building !== null) {
    const use = role === 'teacher' ? 'teach' : 'work';
    a.deskId = sim.map.props.find((p) => p.building === building && p.use === use)?.id ?? null;
  }
  a.schedule = makeSchedule(sim, role, a.traits);
  a.task = newTask(sim, a);
}

// ------------------------------------------------------------------ tick

export function tickPlanner(sim: Sim, dt: number): void {
  sim.timers.roles -= dt;
  if (sim.timers.roles <= 0) {
    sim.timers.roles = 6 * 60;
    allocateRoles(sim);
  }
  sim.timers.plan -= dt;
  if (sim.timers.plan > 0) return;
  sim.timers.plan = 120;
  unstick(sim);
  const builders = sim.agents.filter((a) => a.role === 'builder' || a.role === 'laborer').length;
  const capacityProjects = Math.min(3, 1 + Math.floor(builders / 2));
  if (sim.projects.length >= capacityProjects) return;
  for (const p of proposals(sim)) {
    if (p.score < 0.5) break;
    if (startProject(sim, p)) return;
  }
}
