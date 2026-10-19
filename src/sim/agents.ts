import type { Outfit } from '../assets/loader';
import {
  ADULT_AGE, MIN_PER_DAY, NEED_KEYS, RETIRE_AGE, ROLES, type RoleKey, SKILL_KEYS, type SkillKey, TRAITS, TRAIT_KEYS, type TraitKey, YEARS_PER_DAY,
} from './defs';
import type { Agent, Schedule, Skill, Task } from './types';
import type { Sim } from './sim';

const FIRST = [
  'Ada', 'Bram', 'Chen', 'Dara', 'Elio', 'Farah', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kofi', 'Lena', 'Mateo', 'Nia', 'Oskar',
  'Priya', 'Quinn', 'Rafa', 'Sana', 'Tomas', 'Uma', 'Vik', 'Wren', 'Ximena', 'Yusuf', 'Zoe', 'Amara', 'Bo', 'Celeste',
  'Dmitri', 'Esme', 'Femi', 'Greta', 'Hiro', 'Isla', 'Jonah', 'Keiko', 'Lior', 'Mina', 'Nikolai', 'Odette', 'Pax',
  'Rosa', 'Sol', 'Tavi', 'Ula', 'Vera', 'Wim', 'Yara', 'Zed', 'Anouk', 'Basil', 'Cyra', 'Dov', 'Eli', 'Fen', 'Gaia',
  'Hal', 'Inez', 'Joss', 'Kai', 'Lumi', 'Milo', 'Noor', 'Otto', 'Pia', 'Remy', 'Sage', 'Teo', 'Vida', 'Wes', 'Yuki',
];
const LAST = [
  'Okafor', 'Lindqvist', 'Reyes', 'Tanaka', 'Haddad', 'Novak', 'Mensah', 'Kowalski', 'Ibarra', 'Sato', 'Varga',
  'Achebe', 'Duarte', 'Falk', 'Holm', 'Iqbal', 'Jensen', 'Kaur', 'Larsen', 'Mbeki', 'Orlov', 'Silva', 'Torres', 'Xu',
];

export const ageOf = (sim: Sim, a: Agent): number => ((sim.time - a.birth) / MIN_PER_DAY) * YEARS_PER_DAY;
export const isChild = (sim: Sim, a: Agent): boolean => ageOf(sim, a) < ADULT_AGE;

function pickTraits(sim: Sim, inherit: TraitKey[] = []): TraitKey[] {
  const out: TraitKey[] = [];
  const n = sim.rng.chance(0.4) ? 3 : 2;
  const pool = [...sim.rng.shuffle([...inherit]), ...sim.rng.shuffle([...TRAIT_KEYS])];
  for (const t of pool) {
    if (out.length >= n) break;
    if (out.includes(t) || out.some((o) => TRAITS[o].conflicts.includes(t) || TRAITS[t].conflicts.includes(o))) continue;
    // Inherited traits are likely but not guaranteed.
    if (inherit.includes(t) && !sim.rng.chance(0.6)) continue;
    out.push(t);
  }
  return out;
}

export function makeSchedule(sim: Sim, role: RoleKey, traits: TraitKey[]): Schedule {
  const r = sim.rng;
  const shift = traits.includes('earlyBird') ? -1 : traits.includes('nightOwl') ? 1.5 : 0;
  const def = ROLES[role];
  if (role === 'child') return { wake: 7 + r.range(0, 0.5), sleep: 20.5 + r.range(0, 1), workStart: 8.5, workEnd: 15, lunch: 12 };
  if (role === 'retired') return { wake: 6.5 + r.range(0, 1.5) + shift, sleep: 21.5 + r.range(0, 1) + shift, workStart: 0, workEnd: 0, lunch: 12 + r.range(0, 1) };
  const workStart =
    def.workplace === 'cafe' ? 7 : def.workplace === 'market' ? 8 : def.workplace === 'library' ? 9
    : def.station === 'labor' ? 7 + r.range(0, 0.75)
    : role === 'teacher' ? 8 : role === 'cook' ? 7.5
    : 8.5 + r.range(0, 1) + shift * 0.5;
  const workEnd = def.workplace === 'cafe' ? 15.5 : def.workplace === 'library' ? 17 : role === 'teacher' ? 15.5 : role === 'cook' ? 19 : workStart + (def.station === 'labor' ? 9 : 8.5) + (traits.includes('workaholic') ? 1.5 : 0);
  return { wake: 6.5 + r.range(0, 1) + shift, sleep: 22.5 + r.range(0, 1) + shift, workStart, workEnd, lunch: 12 + r.range(0, 1) };
}

export function newTask(sim: Sim, a: Agent): Task | null {
  const role = ROLES[a.role];
  if (!role.tasks.length) return null;
  const service = role.station === 'counter';
  const total = service ? sim.rng.range(90, 160) : sim.rng.range(180, 420);
  return {
    title: sim.rng.pick(role.tasks.filter((t) => t !== a.task?.title)),
    progress: 0,
    total,
    due: service ? undefined : sim.time + sim.rng.range(1.2, 3) * 24 * 60,
    started: sim.time,
  };
}

function uniqueFirst(sim: Sim): string {
  const used = new Set([...sim.agents, ...sim.deceased].map((a) => a.name.split(' ')[0]));
  const free = FIRST.filter((n) => !used.has(n));
  return free.length ? sim.rng.pick(free) : `${sim.rng.pick(FIRST)} ${String.fromCharCode(65 + sim.rng.int(0, 25))}.`;
}

export interface NewAgentOpts {
  role: RoleKey;
  household: number;
  age: number;
  surname?: string;
  parents?: Agent[];
  cell: number;
}

/** Creates a person: a founder, a newcomer, or a newborn (pass parents). */
export function createAgent(sim: Sim, o: NewAgentOpts): Agent {
  const rng = sim.rng;
  const m = sim.map;
  const parents = o.parents ?? [];
  const traits = pickTraits(sim, parents.flatMap((p) => p.traits));
  const skills = {} as Record<SkillKey, Skill>;
  const grown = o.age >= ADULT_AGE;
  for (const k of SKILL_KEYS) skills[k] = { level: grown ? (k === 'craft' ? rng.int(3, 8) : rng.int(0, 4)) : 0, xp: 0 };
  if (traits.includes('competitive')) skills.athletics.level += grown ? 2 : 0;
  if (traits.includes('creative')) skills.music.level += grown ? 2 : 0;
  if (traits.includes('foodie')) skills.cooking.level += grown ? 2 : 0;
  // Kids take a parent's build and hair; shirts are their own.
  const look = parents.length ? rng.pick(parents).outfit : null;
  const outfit: Outfit = {
    base: look ? look.base : rng.int(0, 5),
    shirtHue: rng.int(0, 11) * 30,
    hairHue: look ? look.hairHue : rng.pick([0, 0, 20, 200, 300, 40]),
    hairLight: o.age >= RETIRE_AGE ? 1.6 : look ? look.hairLight : rng.pick([0.55, 0.8, 1, 1.25]),
  };
  const surname = o.surname ?? (parents[0] ? parents[0].name.split(' ').slice(1).join(' ') : rng.pick(LAST));
  const a: Agent = {
    id: sim.nextAgentId++,
    name: `${uniqueFirst(sim)} ${surname}`,
    age: Math.floor(o.age),
    role: o.role,
    household: o.household,
    traits,
    outfit,
    schedule: makeSchedule(sim, o.role, traits),
    x: m.cx(o.cell),
    y: m.cy(o.cell),
    px: m.cx(o.cell),
    py: m.cy(o.cell),
    at: o.cell,
    path: [],
    pathPos: 0,
    edgeT: 0,
    facing: 'down',
    moving: false,
    needs: Object.fromEntries(NEED_KEYS.map((k) => [k, rng.range(60, 90)])) as Agent['needs'],
    mood: 62,
    skills,
    relations: new Map(),
    memories: [],
    thoughts: [],
    action: { kind: 'idle', label: 'Idle', reason: '', stage: 'perform', dest: o.cell, timer: 0, started: sim.time, score: 0 },
    thinkIn: rng.range(0, 2),
    task: null,
    tasksDone: 0,
    money: grown ? rng.int(40, 160) : 0,
    deskId: null,
    bubble: null,
    workedToday: 0,
    bladder: rng.range(50, 100),
    mealReady: false,
    coffeeDay: -1,
    lastScare: -Infinity,
    birth: sim.time - (o.age / YEARS_PER_DAY) * MIN_PER_DAY,
    partner: null,
    parents: parents.map((p) => p.id),
    children: [],
    carry: null,
    workBuilding: null,
  };
  a.needs.energy = rng.range(70, 95);
  for (const p of parents) {
    p.children.push(a.id);
    a.relations.set(p.id, { opinion: 60, familiarity: 90, lastTalk: -Infinity });
    p.relations.set(a.id, { opinion: 75, familiarity: 90, lastTalk: -Infinity });
    // The rest of the family meets the baby too.
    const tie = (o: Agent | undefined, mine: number, theirs: number, fam: number) => {
      if (!o || o.id === a.id || a.relations.has(o.id)) return;
      a.relations.set(o.id, { opinion: mine, familiarity: fam, lastTalk: -Infinity });
      o.relations.set(a.id, { opinion: theirs, familiarity: fam, lastTalk: -Infinity });
    };
    for (const id of p.children) tie(sim.agent(id), 40, 45, 75);
    for (const id of p.parents) tie(sim.agent(id), 45, 70, 60);
  }
  return a;
}

/** Fixed desks and counters for the hand-built workplaces. */
export function stationFor(sim: Sim, role: RoleKey, taken: Set<number>): number | null {
  const m = sim.map;
  const def = ROLES[role];
  const kindOf = (p: { room: number }) => (p.room >= 0 ? m.rooms[p.room].kind : undefined);
  const spots = m.props.filter((p) => p.use === 'work' && !taken.has(p.id) && (
    def.station === 'desk' ? kindOf(p) === 'office'
    : def.station === 'reception' ? kindOf(p) === 'lobby'
    : def.workplace === 'cafe' ? kindOf(p) === 'cafe' && p.building === undefined
    : def.workplace === 'market' ? kindOf(p) === 'shop'
    : def.workplace === 'library' ? kindOf(p) === 'library'
    : false));
  const pick = spots.length ? sim.rng.pick(spots) : undefined;
  if (pick) taken.add(pick.id);
  return pick?.id ?? null;
}

interface CastMember {
  role: RoleKey;
  age: [number, number];
  /** Index into the cast of their partner (couples share a household). */
  partner?: number;
  /** Indices of parents in the cast. */
  parents?: number[];
}

/** Founding families: two couples with kids, housemates, an elder. Six homes, three each. */
const CAST: { household: number; members: CastMember[] }[] = [
  { household: 0, members: [{ role: 'engineer', age: [30, 40], partner: 1 }, { role: 'designer', age: [29, 38], partner: 0 }, { role: 'child', age: [5, 8], parents: [0, 1] }] },
  { household: 1, members: [{ role: 'manager', age: [36, 46], partner: 1 }, { role: 'farmer', age: [34, 44], partner: 0 }, { role: 'child', age: [10, 13], parents: [0, 1] }] },
  { household: 2, members: [{ role: 'engineer', age: [24, 32] }, { role: 'barista', age: [22, 28] }, { role: 'laborer', age: [20, 26] }] },
  { household: 3, members: [{ role: 'writer', age: [26, 40] }, { role: 'builder', age: [28, 45] }, { role: 'woodcutter', age: [25, 38] }] },
  { household: 4, members: [{ role: 'receptionist', age: [24, 44] }, { role: 'shopkeeper', age: [40, 58] }, { role: 'builder', age: [23, 35] }] },
  { household: 5, members: [{ role: 'librarian', age: [45, 60] }, { role: 'designer', age: [25, 33] }, { role: 'retired', age: [67, 72] }] },
];

export function createAgents(sim: Sim): void {
  const m = sim.map;
  const taken = new Set<number>();
  for (const home of CAST) {
    const h = sim.town.households[home.household];
    const surname = h.name.replace(' home', '');
    const made: Agent[] = [];
    home.members.forEach((c, i) => {
      const cell = m.idx(h.door.x, h.door.y + 2);
      const parents = (c.parents ?? []).map((k) => made[k]);
      const shareName = i === 0 || c.partner !== undefined || parents.length > 0;
      const a = createAgent(sim, { role: c.role, household: home.household, age: sim.rng.range(...c.age), surname: shareName ? surname : undefined, parents, cell });
      // Spread people across open floor in the home so they don't stack on one tile.
      const room = m.rooms[h.room];
      const floor: number[] = [];
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) if (m.walkable(x, y) && !m.cost[m.idx(x, y)]) floor.push(m.idx(x, y));
      a.at = floor[(i * 5) % floor.length];
      a.x = a.px = m.cx(a.at);
      a.y = a.py = m.cy(a.at);
      made.push(a);
      sim.agents.push(a);
    });
    home.members.forEach((c, i) => {
      if (c.partner === undefined) return;
      const a = made[i];
      const b = made[c.partner];
      a.partner = b.id;
      a.relations.set(b.id, { opinion: sim.rng.range(70, 90), familiarity: 95, lastTalk: -Infinity });
    });
  }
  for (const a of sim.agents) {
    if (ROLES[a.role].station === 'desk' || ROLES[a.role].station === 'reception' || (ROLES[a.role].station === 'counter' && ROLES[a.role].workplace !== 'building')) {
      a.deskId = stationFor(sim, a.role, taken);
    }
    a.task = newTask(sim, a);
  }
  // Housemates and coworkers already know each other a little.
  for (const a of sim.agents) for (const b of sim.agents) {
    if (a.id === b.id || a.relations.has(b.id)) continue;
    const fam = a.household === b.household ? 40 : ROLES[a.role].workplace === ROLES[b.role].workplace && ROLES[a.role].workplace !== 'none' ? 15 : 0;
    if (fam) a.relations.set(b.id, { opinion: a.household === b.household ? sim.rng.range(10, 30) : sim.rng.range(-5, 15), familiarity: fam, lastTalk: -Infinity });
  }
}
