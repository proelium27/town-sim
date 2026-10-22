import type { GroundKey } from '../assets/manifest';
import { BLUEPRINTS, type BlueprintKey } from '../world/blueprints';
import type { Household } from '../world/town';
import { ageOf, hoursOf, makeSchedule, newTask, surnameOf } from './agents';
import { ADULT_AGE, type Bill, billGoods, type Good, GOODS, MIN_PER_DAY, PRIORITY_SHARE, PRIORITY_WEIGHT, ROLES, SEASON_DAYS, type PriorityKey, type RoleKey, YEAR_DAYS } from './defs';
import { foodBalance } from './economy';
import { BUSINESSES, type BusinessKind, buildCost, founderFor, openBusiness } from './business';
import { checkTier, EXTENSION_W, extensionSite, type ExtensionSite, stampExtension } from './growth';
import { bury } from './life';
import { projectCushion } from './market';
import { agendaWeight } from './politics';
import { deeds, dreaming } from './aspirations';
import { layToRest } from './rites';
import { canSupply, CRAFT_ROLES, hasWorkshop, rawOf, RECIPES, targetOf, wanted } from './workshop';
import { addMemory, first, think } from './social';
import { HEADLINE, NOTABLE, type Agent, type Project } from './types';
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

/** Moves people into another household, bringing a few groceries with them. Children are never left behind without a grown-up. */
export function moveTo(sim: Sim, people: Agent[], hh: number): void {
  const left = new Set<number>();
  for (const a of people) {
    if (a.household === hh) continue;
    const from = a.household;
    left.add(from);
    a.household = hh;
    if (sim.pantry[from] > 1) {
      sim.pantry[from]--;
      sim.pantry[hh]++;
    }
    // Release any bed they had reserved at the old place.
    if (a.action.kind === 'sleep' && a.action.propId !== undefined) sim.reserved.delete(a.action.propId);
  }
  for (const from of left) {
    const rest = members(sim, from);
    if (rest.length && rest.every((x) => ageOf(sim, x) < ADULT_AGE)) moveTo(sim, rest, hh);
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

/** The player's priority, nudged a little toward the mayor's agenda. */
const weight = (sim: Sim, k: PriorityKey) => PRIORITY_WEIGHT[sim.priorities[k]] * agendaWeight(sim, k);

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

export interface Proposal {
  bp: BlueprintKey;
  score: number;
  reason: string;
  forAgents: Agent[];
  proposer?: Agent;
  name: string;
  /** Build near here (grown kids near their parents). */
  near?: { x: number; y: number };
  /** For extensions: where the wing goes. */
  extends?: ExtensionSite;
  /** A private business: the founder pays and will run it. */
  owner?: Agent;
  /** Time-critical: may start one project past the town's usual limit (the dock before the first frost). */
  rush?: boolean;
}

/**
 * The door of the parents' home, to settle near. That's often the very home the mover is
 * leaving (a grown kid moving out), which is exactly where they want to stay close to.
 */
function familyHome(sim: Sim, people: Agent[]): { x: number; y: number } | undefined {
  for (const a of people) {
    for (const id of a.parents) {
      const p = sim.agent(id);
      const h = p && sim.town.households[p.household];
      if (h && h.building >= 0) return h.door;
    }
  }
  return undefined;
}

const HOME_SUFFIX = ['home', 'house', 'cottage', 'place', 'lodge'];

/** "Reyes home", or "Reyes cottage" if that name is taken. */
function homeName(sim: Sim, a: Agent | undefined): string {
  const surname = a ? surnameOf(a.name) : 'Hillside';
  const taken = new Set([...sim.town.households.map((h) => h.name), ...sim.projects.map((p) => p.name), ...sim.map.buildings.map((b) => b.name)]);
  for (const s of HOME_SUFFIX) if (!taken.has(`${surname} ${s}`)) return `${surname} ${s}`;
  return `${a ? first(a) : 'New'}'s place ${sim.nextProjectId}`;
}

export function proposals(sim: Sim): Proposal[] {
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
      out.push({ bp: 'house', score: 2.2 * hw, reason: `${mem.map(first).join(' and ')} ${mem.length === 1 ? 'has' : 'have'} nowhere to live`, forAgents: mem, proposer: mem[0], name: homeName(sim, mem[0]) });
    }
  }
  for (const a of adults) {
    const p = sim.agent(a.partner ?? undefined);
    if (!p || a.id > p.id || planned.has(a.id)) continue;
    const fam = familyOf(sim, a);
    const sharedHome = a.household === p.household && members(sim, a.household).every((m) => fam.includes(m));
    if (sharedHome) continue;
    // A couple living apart, or sharing with housemates, wants a place of their own; apart is pressing.
    const dream = dreaming(a, 'home') || dreaming(p, 'home') ? 1.25 : 1;
    out.push({ bp: 'house', score: (a.household === p.household ? 1.45 : 2.1) * hw * dream, reason: `${first(a)} and ${first(p)} want a home of their own`, forAgents: fam, proposer: a, name: homeName(sim, a), near: familyHome(sim, [a, p]) });
  }
  for (const h of sim.town.households) {
    if (h.building < 0) continue;
    const mem = members(sim, h.id).filter((a) => !planned.has(a.id));
    const cap = capacity(sim, h.id);
    if (mem.length > cap) {
      // A family with young ones builds on a wing; grown-up kids move out (to somewhere nearby).
      const b = sim.building(h.building);
      // A wing already going up is the answer for now; don't also send someone off to build.
      if (b && sim.projects.some((p) => p.extends?.building === b.id)) continue;
      const wing = b ? extensionSite(sim, b) : null;
      const young = mem.some((a) => ageOf(sim, a) < ADULT_AGE);
      if (wing && young) {
        out.push({ bp: 'extension', score: 1.3 * hw, reason: `the ${h.name} is bursting at the seams`, forAgents: [], proposer: mem.find((a) => ageOf(sim, a) >= ADULT_AGE) ?? mem[0], name: `${h.name} extension`, extends: wing });
      } else {
        const movers = mem.filter((a) => ageOf(sim, a) >= ADULT_AGE && !a.partner).sort((x, y) => ageOf(sim, x) - ageOf(sim, y)).slice(0, 1);
        if (movers.length) out.push({ bp: 'house', score: 1.2 * hw, reason: `the ${h.name.replace(' home', '')} home is overcrowded`, forAgents: movers, proposer: movers[0], name: homeName(sim, movers[0]), near: familyHome(sim, movers) });
      }
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
  // With food on High the town breaks new fields until it grows a good margin over what it eats.
  const deficit = fb.eat * (sim.priorities.food === 2 ? 1.3 : 1) - fb.produce - plannedFarms * 50;
  // Nobody breaks new fields in winter; nothing would grow before spring.
  if (sim.season !== 3 && (deficit > 0 || sim.stock.food < sim.agents.length * 2)) {
    const farmer = sim.agents.find((a) => a.role === 'farmer');
    out.push({ bp: 'farm', score: (0.8 + Math.min(1, deficit / 40) + (sim.stock.food < sim.agents.length * 3 ? 0.6 : 0)) * fw, reason: sim.stock.food < sim.agents.length * 3 ? 'food stores are running low' : 'we will need more food as we grow', forAgents: [], proposer: farmer ?? charismatic(), name: `${['Sunny', 'River', 'Oak', 'Clover', 'Barley', 'Willow'][count('farm') % 6]} Farm` });
  }

  // A fishing dock: food from the lake, and the one harvest that doesn't stop at the first frost. Worth it once
  // the town has mouths to feed, most of all with winter coming.
  if (count('dock') === 0 && sim.agents.length >= 14) {
    const fisherly = sim.agents.find((a) => a.role === 'farmer') ?? charismatic();
    const winterSoon = sim.season === 1 || sim.season === 2;
    if (winterSoon || deficit > 0) {
      // The nearer the frost, the more it matters: in autumn it outranks a new home (1.2), and from late summer it's a
      // rush job, started even with the school still going up, so it's built before winter.
      out.push({ bp: 'dock', score: (0.7 + (sim.season === 1 ? 0.2 : 0) + (sim.season === 2 ? 1.2 : 0) + (deficit > 0 ? 0.3 : 0)) * fw, reason: winterSoon ? "fish don't stop at the first frost" : 'the lake is full of fish', forAgents: [], proposer: fisherly, name: 'Lakeside Dock', rush: sim.season === 2 || (sim.season === 1 && sim.day % YEAR_DAYS >= SEASON_DAYS * 1.5) });
    }
  }

  // ---- storage and community
  const mw = weight(sim, 'materials');
  if (count('storehouse') < 1 + Math.floor(sim.agents.length / 35)) {
    out.push({ bp: 'storehouse', score: 0.7 * mw, reason: 'the storehouse is too far for the new neighborhoods', forAgents: [], proposer: sim.agents.find((a) => a.role === 'woodcutter') ?? charismatic(), name: 'East Storehouse' });
  }
  const cw = weight(sim, 'community');
  if (kids.length >= 2 && count('school') === 0) {
    const parent = sim.agent(kids[0].parents[0]);
    out.push({ bp: 'school', score: (0.9 + kids.length * 0.08) * cw, reason: `${kids.length} kids have nowhere to learn`, forAgents: [], proposer: parent ?? charismatic(), name: `${sim.name} School` });
  }
  if (sim.agents.length >= 24 && count('diner') < Math.floor(sim.agents.length / 24)) {
    out.push({ bp: 'diner', score: 0.6 * cw, reason: 'the café is packed every lunchtime', forAgents: [], proposer: sim.agents.find((a) => a.traits.includes('foodie')) ?? charismatic(), name: `${['Corner', 'Hilltop', 'Lakeside'][count('diner') % 3]} Diner` });
  }
  // A town needs a hall for its meetings (and somewhere for protests to gather).
  if (sim.tier >= 1 && count('townhall') === 0) {
    out.push({ bp: 'townhall', score: 0.85 * cw, reason: `${sim.name} is a town now and needs a hall for its meetings`, forAgents: [], proposer: sim.agent(sim.mayor ?? undefined) ?? charismatic(), name: `${sim.name} Town Hall` });
  }
  // After a fire, wells: water close at hand is what saves a building. One for every eight homes or so.
  const homes = sim.map.buildings.filter((b) => b.kind === 'house').length;
  if (sim.firesEver > 0 && count('well') < Math.max(1, Math.ceil(homes / 8))) {
    // A priority, whatever the community lever says: ahead of new homes, and started even with another project going.
    out.push({ bp: 'well', score: 1.6, rush: true, reason: 'the fire showed we need water close at hand', forAgents: [], proposer: charismatic(), name: `${['Market', 'Green', 'Hill', 'Corner'][count('well') % 4]} Well` });
  }
  // Private businesses: someone with savings and the trade for it proposes a place of their own.
  for (const kind of ['bakery', 'tavern'] as const) {
    const def = BUSINESSES[kind];
    // One once the town is big enough, a second past another 20 people; going up counts too, and so does a place the town took over.
    const have = sim.businesses.filter((b) => b.kind === kind).length + sim.projects.filter((pr) => pr.blueprint === kind).length;
    if (sim.agents.length < def.pop || have >= Math.min(2, 1 + Math.floor((sim.agents.length - def.pop) / 20))) continue;
    const founder = founderFor(sim, kind);
    if (!founder) continue;
    const name = kind === 'bakery' ? `${first(founder)}'s Bakery` : `The ${['Old Oak', 'Copper Kettle', 'Red Lantern', 'Three Fiddles'][(sim.businesses.length + founder.id) % 4]}`;
    out.push({ bp: kind, score: 0.72 + (founder.traits.includes('workaholic') || founder.traits.includes('competitive') ? 0.1 : 0), reason: kind === 'bakery' ? `${first(founder)} has saved up for a bakery of their own` : `${first(founder)} wants to give the town somewhere to go of an evening`, forAgents: [], proposer: founder, name, owner: founder });
  }
  // A workshop once the town is big enough to keep one busy and has the timber to spare.
  if (sim.agents.length >= 22 && count('workshop') === 0 && sim.stock.wood >= 40) {
    // Its case grows with every few people past that, so a steady run of couples wanting homes can't starve it.
    const overdue = Math.min(1, (sim.agents.length - 22) * 0.15);
    out.push({ bp: 'workshop', score: (0.6 + overdue) * mw, reason: 'we could make our own planks, bricks and furniture', forAgents: [], proposer: sim.agents.find((a) => a.role === 'builder') ?? charismatic(), name: `${sim.name} Workshop` });
  }
  const sick = sim.agents.filter((a) => a.illness).length;
  if (count('clinic') === 0 && sim.agents.length >= 14 && (sick >= 3 || sim.time - sim.outbreak < 3 * 1440)) {
    const patient = sim.agents.find((a) => a.illness && ageOf(sim, a) >= ADULT_AGE);
    out.push({ bp: 'clinic', score: (1.1 + sick * 0.08) * cw, reason: sick >= 3 ? `${sick} people are sick and there's nowhere to treat them` : 'the flu went through town and there was nowhere to treat anyone', forAgents: [], proposer: patient ?? charismatic(), name: `${sim.name} Clinic` });
  }
  if (sim.unburied.length && !sim.projects.some((p) => p.blueprint === 'cemetery')) {
    const dead = sim.person(sim.unburied[0])!;
    const mourner = sim.agents.filter((a) => a.id === dead.partner || dead.children.includes(a.id) || dead.parents.includes(a.id)).find((a) => ageOf(sim, a) >= ADULT_AGE);
    const full = count('cemetery') > 0;
    out.push({
      bp: 'cemetery', score: 1.3 * cw,
      reason: full ? 'the cemetery is full' : `we have nowhere to lay ${first(dead)} to rest`,
      forAgents: [], proposer: mourner ?? charismatic(), name: full ? 'Hill Cemetery' : `${sim.name} Cemetery`,
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

/** The last dock search, per town: the shore only changes slowly, so it's looked over at most once a day. */
const dockSearch = new WeakMap<Sim, { day: number; site: Site | null }>();

/**
 * A dock goes on the lake shore: a 5x3 lot on dry land with two tiles of open water straight out from the middle of
 * its far side (where the pier runs), its door facing back toward town and a path from there to a street.
 */
export function findDockSite(sim: Sim): Site | null {
  const cached = dockSearch.get(sim);
  if (cached && cached.day === sim.day) return cached.site;
  const m = sim.map;
  const bp = BLUEPRINTS.dock;
  const [tx, ty] = townCenter(sim);
  const water = (x: number, y: number) => m.inBounds(x, y) && m.ground[m.idx(x, y)] === 'water';
  const cands: { x: number; y: number; doorTop: boolean; score: number }[] = [];
  for (let y = 1; y < m.h - 1; y++) {
    for (let x = 3; x < m.w - 4; x++) {
      if (!water(x, y) || !water(x + 1, y)) continue;
      // Water to the south of the lot (door on top), or to the north (door below).
      for (const doorTop of [true, false]) {
        const lx = x - 2;
        const ly = doorTop ? y - bp.h : y + 1;
        let ok = true;
        let clear = 0;
        for (let yy = ly - (doorTop ? 1 : 0); yy < ly + bp.h + (doorTop ? 0 : 1) && ok; yy++) {
          for (let xx = lx - 1; xx <= lx + bp.w && ok; xx++) {
            if (!m.inBounds(xx, yy)) ok = false;
            else {
              const i = m.idx(xx, yy);
              if (!BUILDABLE.has(m.ground[i]) || m.cell[i] !== 0 || m.room[i] >= 0) ok = false;
              else for (const p of m.propsOn(xx, yy)) {
                if (!p.resource) ok = false;
                else clear++;
              }
            }
          }
        }
        if (ok) cands.push({ x: lx, y: ly, doorTop, score: Math.hypot(lx - tx, ly - ty) + clear * 3 });
      }
    }
  }
  cands.sort((a, b) => a.score - b.score);
  let best: Site | null = null;
  for (const c of cands.slice(0, 8)) {
    const dx = c.x + bp.doorX;
    const dy = c.doorTop ? c.y - 1 : c.y + bp.h;
    const inLot = (xx: number, yy: number) => xx >= c.x && xx < c.x + bp.w && yy >= c.y && yy < c.y + bp.h;
    const path = pathToStreet(sim, dx, dy, inLot);
    if (!path) continue;
    const cost = c.score + path.length * 0.6;
    if (!best || cost < best.cost) best = { x: c.x, y: c.y, doorTop: c.doorTop, path: [m.idx(dx, dy), ...path].filter((i) => BUILDABLE.has(m.ground[i])), cost };
  }
  dockSearch.set(sim, { day: sim.day, site: best });
  return best;
}

export function findSite(sim: Sim, key: BlueprintKey, near?: { x: number; y: number }): Site | null {
  if (key === 'dock') return findDockSite(sim);
  const m = sim.map;
  const bp = BLUEPRINTS[key];
  const [tx, ty] = townCenter(sim);
  // Settle near family if there's a home to be near; otherwise hug the town center.
  const [cx, cy] = near && bp.kind !== 'farm' ? [near.x, near.y] : [tx, ty];
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
      if (d > 70 || Math.hypot(x + bp.w / 2 - tx, y + bp.h / 2 - ty) > 70) continue;
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
      // Farms like open land a bit out of town; everything else stays close to the center (or the family).
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

export function startProject(sim: Sim, p: Proposal): Project | null {
  const bp = BLUEPRINTS[p.bp];
  // The treasury has to be able to pay for it and still meet payroll; a home for the homeless gets built on credit,
  // and a cemetery for the unburied only has to be affordable.
  const urgent = p.bp === 'house' && p.forAgents.some((a) => sim.town.households[a.household].building < 0 || (a.partner !== null && sim.agent(a.partner)?.household !== a.household));
  const cushion = p.bp === 'cemetery' && sim.unburied.length ? 0 : projectCushion(sim);
  // A founder pays for the plot and the materials themselves, and borrows what their savings don't cover.
  const total = p.owner ? buildCost(p.bp as BusinessKind) : 0;
  const own = p.owner ? Math.min(total, Math.max(0, Math.floor(p.owner.money - 20))) : 0;
  const loan = total - own;
  // (A rush job, cheap and with the frost coming, only has to leave half the usual cushion.)
  if (p.owner ? sim.treasury - loan < cushion : sim.treasury - bp.coins < (p.rush ? cushion / 2 : cushion) && !urgent) return null;
  const wing = p.extends;
  const site = wing ? { x: wing.x, y: wing.y, doorTop: true, path: [], cost: 0 } : findSite(sim, p.bp, p.near);
  if (!site) return null;
  if (p.owner) {
    p.owner.money -= own;
    sim.treasury += own - loan;
    sim.ledger.sales += own;
    sim.ledger.loans -= loan;
  } else {
    sim.treasury -= bp.coins;
    sim.ledger.projects += bp.coins;
  }
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
    extends: wing,
    owner: p.owner?.id,
    loan: p.owner ? loan : undefined,
    rush: p.rush,
  };
  sim.projects.push(pr);
  const who = p.proposer;
  const chair = sim.agent(sim.mayor ?? undefined);
  const hall = sim.map.buildings.some((b) => b.kind === 'townhall') ? ' at the town hall' : '';
  sim.log(`${chair ? `Mayor ${first(chair)}'s town meeting` : 'Town meeting'}${hall}: ${who ? first(who) : 'the town'} proposed ${bp.noun} because ${p.reason}`, 'build', 'good', who).weight = NOTABLE;
  if (p.owner) sim.log(`${first(p.owner)} put $${own} of their savings into ${p.name}${loan > 0 ? ` and borrowed $${Math.round(loan)} from the town` : ''}`, 'event', 'neutral', p.owner).weight = NOTABLE;
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
  if (pr.extends) return finishExtension(sim, pr, pr.extends);
  let hhId: number | undefined;
  const residents = pr.forAgents.map((id) => sim.agent(id)).filter((a): a is Agent => !!a);
  if (pr.blueprint === 'house') {
    // Kids born (or who moved in) since the house was proposed come along with their parents.
    for (const r of [...residents]) {
      for (const k of familyOf(sim, r)) if (!residents.includes(k) && k.household === r.household && ageOf(sim, k) < ADULT_AGE) residents.push(k);
    }
    const homeless = residents.length && sim.town.households[residents[0].household].building < 0 && residents.every((r) => r.household === residents[0].household);
    hhId = homeless ? residents[0].household : newHousehold(sim, pr.name).id;
  }
  const b = bp.stamp(m, pr.x, pr.y, pr.doorTop, pr.name, hhId);
  if ((pr.need.bricks ?? 0) > 0) b.sturdy = true;
  for (const i of pr.path) if (BUILDABLE.has(m.ground[i])) m.setGround(m.cx(i), m.cy(i), 'dirt');
  m.setGround(b.door.x, b.door.y, 'plaza');
  stepOut(sim, b.door);
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
    if (!a) continue;
    addMemory(sim, a, 'builtSomething');
    deeds(a).built++;
  }
  for (const a of sim.agents) addMemory(sim, a, 'townGrowing');
  const names = residents.map(first);
  sim.log(`${pr.name} is finished${names.length ? `. ${names.join(', ')} moved in` : ''}`, 'build', 'good', residents[0]).weight = HEADLINE;
  sim.milestone(`Built ${pr.name}`);
  if (pr.blueprint === 'bakery' || pr.blueprint === 'tavern') openBusiness(sim, pr.blueprint, b.id, pr.name, pr.owner, pr.loan ?? 0);
  if (pr.blueprint === 'cemetery') {
    const laid = sim.unburied.filter((id) => bury(sim, id));
    sim.unburied = sim.unburied.filter((id) => !laid.includes(id));
    for (const id of laid) layToRest(sim, sim.person(id)!);
    if (laid.length) sim.log(`${laid.map((id) => sim.person(id)!.name).join(', ')} ${laid.length > 1 ? 'were' : 'was'} laid to rest at ${pr.name}`, 'family', 'neutral').weight = NOTABLE;
  }
  if (pr.blueprint !== 'house') allocateRoles(sim);
}

/** Anyone standing where a wall now is steps out the front door. */
function stepOut(sim: Sim, door: { x: number; y: number }): void {
  const m = sim.map;
  for (const a of sim.agents) {
    if (!m.walkable(m.cx(a.at), m.cy(a.at))) {
      a.at = m.idx(door.x, door.y);
      a.x = a.px = door.x;
      a.y = a.py = door.y;
      a.path = [];
      a.action.stage = 'perform';
      a.thinkIn = 0;
    }
  }
}

/** The wing is up: the family spreads out into it. */
function finishExtension(sim: Sim, pr: Project, wing: ExtensionSite): void {
  const hh = sim.town.households.find((h) => h.building === wing.building);
  sim.projects = sim.projects.filter((p) => p.id !== pr.id);
  if (!hh) return;
  stampExtension(sim, wing, hh.id);
  stepOut(sim, sim.building(wing.building)!.door);
  for (const id of pr.builders) {
    const a = sim.agent(id);
    if (!a) continue;
    addMemory(sim, a, 'builtSomething');
    deeds(a).built++;
  }
  const fam = members(sim, hh.id);
  for (const a of fam) addMemory(sim, a, 'roomToBreathe');
  sim.log(`The ${hh.name} has a new wing: ${EXTENSION_W} tiles wider and two more beds`, 'build', 'good', fam[0]).weight = HEADLINE;
  sim.milestone(`Built ${pr.name}`);
}

// ------------------------------------------------------------------ jobs

/** One line of what the town wants from its flexible workers: a role, how many, and where (null: anywhere). */
export type RoleSlot = [role: RoleKey, n: number, building: number | null];

/**
 * Mouths to a fisher in autumn and in winter (the catch through the ice is about half as big, so it takes more of them).
 * Played out, a fisher lands about 4-7 food a day in autumn and 3-5 through the ice, against 2.35 eaten a head, so this is
 * 2 fishers at 20 people (15-20% of intake) and 3 (autumn) or 4 (winter) at 40 (15-20%); it was a flat 2, which was
 * 9-15 food/day, 20% at 20 people and 10% at 40.
 */
export const FISHER_SHARE = [14, 10];

/** What the town needs of its flexible workers right now, in the order jobs are filled. A role can appear more than once. */
export function roleDemand(sim: Sim): RoleSlot[] {
  const m = sim.map;
  const schools = m.buildings.filter((b) => b.kind === 'school');
  const diners = m.buildings.filter((b) => b.kind === 'cafe' && b.name.includes('Diner'));
  const farms = m.buildings.filter((b) => b.kind === 'farm').length;
  const kids = sim.agents.filter((a) => ageOf(sim, a) >= 5 && ageOf(sim, a) < ADULT_AGE).length;
  const demand: RoleSlot[] = [];
  for (const s of schools) if (kids) demand.push(['teacher', 1, s.id]);
  for (const c of m.buildings.filter((b) => b.kind === 'clinic')) demand.push(['doctor', 1, c.id]);
  for (const d of diners) demand.push(['cook', 1, d.id]);
  const hw = PRIORITY_WEIGHT[sim.priorities.housing];
  const mw = PRIORITY_WEIGHT[sim.priorities.materials];
  const fw = PRIORITY_WEIGHT[sim.priorities.food];
  // A skeleton crew comes first, so no lever set to High can strip the town of the hands that grow, build and gather.
  demand.push(['farmer', 1, null], ['builder', 1, null], ['woodcutter', 1, null]);
  // Then the levers tilt the rest of the mix, each claiming no more than its share of the workforce.
  const pool = sim.agents.filter((a) => ROLES[a.role].flexible && ageOf(sim, a) >= ADULT_AGE).length;
  const capped = (n: number, k: PriorityKey) => Math.min(n, Math.max(1, Math.round(pool * PRIORITY_SHARE[sim.priorities[k]]))) - 1;
  // Farms are staffed before building crews, unless housing is the higher priority.
  const tilt: RoleSlot[] = [['farmer', capped(Math.round(farms * 1.5 * fw), 'food'), null], ['builder', capped(Math.round((1 + sim.projects.length * 0.8) * hw), 'housing'), null]];
  if (sim.priorities.housing > sim.priorities.food) tilt.reverse();
  // Fishers: the lake adds to the harvest rather than taking hands from it, so in spring and summer they're staffed
  // after the farm and building crews. From autumn, when the fish are what lasts the winter, they're promised ahead of
  // the building crew (in winter, when nothing grows, ahead of the farm crew as well). How many is sized by the town:
  // before autumn one if the town eats more than it grows or the stores are thin; in autumn a fisher for every
  // FISHER_SHARE[0] mouths (never fewer than two), in winter, when the catch is thinner, one for every FISHER_SHARE[1].
  // The food lever adds or removes one, and no dock takes more fishers than it has places for.
  const fishers: RoleSlot[] = [];
  const docks = m.buildings.filter((b) => b.kind === 'dock');
  if (docks.length) {
    const fb = foodBalance(sim);
    const hungry = fb.eat > fb.produce || sim.stock.food < sim.agents.length * 4;
    const base = sim.season >= 2 ? Math.max(2, Math.ceil(sim.agents.length / FISHER_SHARE[sim.season - 2])) : hungry ? 1 : 0;
    let left = Math.max(0, base + (sim.priorities.food === 2 ? 1 : sim.priorities.food === 0 ? -1 : 0));
    for (const d of docks) {
      const n = Math.min(left, m.props.filter((p) => p.building === d.id && p.use === 'fish').length);
      left -= n;
      fishers.push(['fisher', n, d.id]);
    }
  }
  let fishersIn = false;
  const addFishers = () => {
    if (fishersIn) return;
    fishersIn = true;
    for (const slot of fishers) demand.push(slot);
  };
  if (sim.season === 3) addFishers();
  // In autumn the harvest still needs hands, so only the first fisher goes ahead of the farm crew; the rest come before the builders.
  if (sim.season === 2 && fishers.length && fishers[0][1] > 0) {
    demand.push(['fisher', 1, fishers[0][2]]);
    fishers[0] = ['fisher', fishers[0][1] - 1, fishers[0][2]];
  }
  for (const slot of tilt) {
    if (sim.season === 2 && slot[0] === 'builder') addFishers();
    demand.push(slot);
    if (slot === tilt[0] && hasWorkshop(sim)) demand.push(['carpenter', 1, null]);
  }
  addFishers();
  // Once there's a workshop, the trades it needs (one carpenter is staffed even before builders, above).
  if (hasWorkshop(sim)) {
    for (const role of CRAFT_ROLES) {
      // Batches already at a station still count, so starting one doesn't talk the crafter out of a job.
      const recipes = RECIPES.filter((r) => r.role === role);
      const batches = recipes.reduce((s, r) => s + wanted(sim, r) / r.out, 0);
      // Whoever's in the trade keeps it until the shelves hold a full batch over what's wanted.
      const held = sim.agents.filter((a) => a.role === role && ageOf(sim, a) >= ADULT_AGE).length;
      const stocked = recipes.every((r) => sim.stock[r.good] >= targetOf(sim, r.good) + r.out);
      if (role === 'carpenter') {
        if (batches > 6 || (held >= 2 && batches > 2)) demand.push(['carpenter', 1, null]);
      } else if (batches > 0 || (held && !stocked)) demand.push([role, 1, null]);
    }
  }
  // Autumn and winter need firewood split and carried to every hearth.
  const cold = sim.season >= 2 ? 1 : 0;
  const shop = hasWorkshop(sim) ? 1 : 0;
  demand.push(['woodcutter', Math.max(1, Math.round((sim.stock.wood < 60 || sim.stock.stone < 40 ? 2 : 1) * mw) + cold + shop) - 1, null]);
  return demand.filter(([, n]) => n > 0);
}

/** Unfilled places per demanded role: the total wanted less the adults already doing it (zero or below: full). */
export function openSlots(sim: Sim, demand: RoleSlot[] = roleDemand(sim)): Map<RoleKey, number> {
  const open = new Map<RoleKey, number>();
  for (const [r, n] of demand) open.set(r, (open.get(r) ?? 0) + n);
  for (const a of sim.agents) if (open.has(a.role) && ageOf(sim, a) >= ADULT_AGE) open.set(a.role, open.get(a.role)! - 1);
  return open;
}

/** Someone who changed jobs within a day stays put rather than being stood down again. */
export const MIN_TENURE = MIN_PER_DAY;

/**
 * Shifts people in flexible jobs toward what the town needs right now, moving as few as it can:
 * everyone stays where they are while their trade has room, and only the openings are filled.
 */
export function allocateRoles(sim: Sim): void {
  const adults = sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE && a.role !== 'retired');
  const pool = adults.filter((a) => ROLES[a.role].flexible);
  if (!pool.length) return;
  const demand = roleDemand(sim);
  // How many each line really gets: lines are filled in order until the workforce runs out.
  let left = pool.length;
  const quota = demand.map(([, n]) => {
    const q = Math.min(n, left);
    left -= q;
    return q;
  });
  // Places a trade can actually fill; someone whose own trade has one isn't held in another job.
  const open = new Map<RoleKey, number>();
  demand.forEach(([r], i) => open.set(r, (open.get(r) ?? 0) + quota[i]));
  for (const a of pool) if (open.has(a.role)) open.set(a.role, open.get(a.role)! - 1);
  const calledAway = (a: Agent, role: RoleKey) => a.career !== undefined && a.career !== role && (open.get(a.career) ?? 0) > 0;
  const settling = (a: Agent) => sim.time - (a.roleSince ?? -Infinity) < MIN_TENURE;
  const fits = (a: Agent, [role, , building]: RoleSlot) => a.role === role && (building === null || a.workBuilding === building);

  const line = new Map<number, number>();
  const taken = (i: number) => [...line.values()].filter((x) => x === i).length;
  // Everyone stays put while their line has room (those trained for it first).
  demand.forEach((slot, i) => {
    const stay = pool.filter((a) => !line.has(a.id) && fits(a, slot) && !calledAway(a, slot[0])).sort((x, y) => Number(y.career === slot[0]) - Number(x.career === slot[0]));
    for (const a of stay.slice(0, quota[i])) line.set(a.id, i);
  });
  // The openings go to those who trained for them, then whoever is spare.
  const changes: string[] = [];
  demand.forEach((slot, i) => {
    const [role, , building] = slot;
    let need = quota[i] - taken(i);
    if (need <= 0) return;
    // Anyone who only just took up their trade is asked last, so a dip in one line doesn't bounce them straight back.
    const spare = pool.filter((a) => !line.has(a.id)).sort((x, y) => Number(settling(x)) - Number(settling(y)));
    const order = [...spare.filter((a) => a.career === role), ...spare.filter((a) => a.career !== role && !calledAway(a, role)), ...spare.filter((a) => a.career !== role && calledAway(a, role))];
    for (const a of order) {
      if (need <= 0) break;
      line.set(a.id, i);
      need--;
      if (fits(a, slot)) continue;
      setRole(sim, a, role, building);
      changes.push(`${first(a)} is now a ${ROLES[role].title.toLowerCase()}`);
    }
  });
  // Whoever's left over helps out as a laborer, unless they've only just taken up their trade. Spare builders and
  // crafters keep their trade: they pitch in with the same general work anyway, and are ready when it picks up again.
  const keeps = (a: Agent) => (a.role === 'builder' && demand.some((slot) => fits(a, slot))) || (CRAFT_ROLES.includes(a.role) && hasWorkshop(sim));
  for (const a of pool) {
    if (line.has(a.id) || a.role === 'laborer') continue;
    if (settling(a) || keeps(a)) continue;
    setRole(sim, a, 'laborer', null);
    changes.push(`${first(a)} is helping out as a laborer`);
  }
  if (changes.length) sim.log(changes.join('; '), 'work', 'neutral');
}

export function setRole(sim: Sim, a: Agent, role: RoleKey, building: number | null): void {
  const was = a.role;
  a.role = role;
  a.roleSince = sim.time;
  a.workBuilding = building;
  a.deskId = null;
  if (building !== null) {
    const use = role === 'teacher' ? 'teach' : 'work';
    a.deskId = sim.map.props.find((p) => p.building === building && p.use === use)?.id ?? null;
  }
  // Swapping one outdoor trade for another keeps their own hours.
  if (hoursOf(was) !== hoursOf(role)) a.schedule = makeSchedule(sim, role, a.traits);
  a.task = newTask(sim, a);
}

// ------------------------------------------------------------------ tick

/** How many more homes than the usual limit may go up at once for families who have no home. */
const HOMELESS_EXTRA = 2;

/** A house proposed for people whose household has no building yet. */
const homelessHouse = (sim: Sim, p: Proposal) => p.bp === 'house' && p.forAgents.some((a) => sim.town.households[a.household].building < 0);

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
  checkTier(sim);
  // A bigger town can take on more at once.
  const capacityProjects = Math.min(3 + sim.tier, 1 + Math.floor(builders / 2));
  // A rush job (the dock before the frost, wells after a fire) doesn't wait for a big project like the school to
  // finish, and doesn't hold up the rest either while it's going: it sits outside the limit, one at a time. (Counted
  // inside it, a dock whose lot took three days to clear kept a town of 18 from building a single home.) Families with
  // no roof over their heads may push past the limit by up to HOMELESS_EXTRA at once.
  const regular = sim.projects.filter((pr) => !pr.rush).length;
  const rushing = sim.projects.length - regular;
  const full = regular >= capacityProjects;
  const roomForHomeless = regular < capacityProjects + HOMELESS_EXTRA;
  if (!roomForHomeless && rushing) return;
  for (const p of proposals(sim)) {
    if (p.score < 0.5) break;
    if (p.rush ? rushing > 0 : full && !(roomForHomeless && homelessHouse(sim, p))) continue;
    if (startProject(sim, p)) return;
  }
}
