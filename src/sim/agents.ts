import { NEED_KEYS, ROLES, type RoleKey, SKILL_KEYS, type SkillKey, TRAITS, TRAIT_KEYS, type TraitKey } from './defs';
import type { Agent, Schedule, Skill, Task } from './types';
import type { Sim } from './sim';

const FIRST = [
  'Ada', 'Bram', 'Chen', 'Dara', 'Elio', 'Farah', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kofi', 'Lena', 'Mateo', 'Nia', 'Oskar',
  'Priya', 'Quinn', 'Rafa', 'Sana', 'Tomas', 'Uma', 'Vik', 'Wren', 'Ximena', 'Yusuf', 'Zoe', 'Amara', 'Bo', 'Celeste',
  'Dmitri', 'Esme', 'Femi', 'Greta', 'Hiro', 'Isla', 'Jonah', 'Keiko', 'Lior', 'Mina', 'Nikolai', 'Odette', 'Pax',
];
const LAST = [
  'Okafor', 'Lindqvist', 'Reyes', 'Tanaka', 'Haddad', 'Novak', 'Mensah', 'Kowalski', 'Ibarra', 'Sato', 'Varga',
  'Achebe', 'Duarte', 'Falk', 'Holm', 'Iqbal', 'Jensen', 'Kaur', 'Larsen', 'Mbeki', 'Orlov', 'Silva', 'Torres', 'Xu',
];

/** Twelve townsfolk: eight at the office, one each at the café, market and library. */
const CAST: RoleKey[] = ['engineer', 'engineer', 'engineer', 'engineer', 'designer', 'designer', 'writer', 'manager', 'receptionist', 'barista', 'shopkeeper', 'librarian'];

function pickTraits(sim: Sim): TraitKey[] {
  const out: TraitKey[] = [];
  const n = sim.rng.chance(0.4) ? 3 : 2;
  for (const t of sim.rng.shuffle([...TRAIT_KEYS])) {
    if (out.length >= n) break;
    if (out.some((o) => TRAITS[o].conflicts.includes(t) || TRAITS[t].conflicts.includes(o))) continue;
    out.push(t);
  }
  return out;
}

function makeSchedule(sim: Sim, role: RoleKey, traits: TraitKey[]): Schedule {
  const r = sim.rng;
  const shift = traits.includes('earlyBird') ? -1 : traits.includes('nightOwl') ? 1.5 : 0;
  const wake = 6.5 + r.range(0, 1) + shift;
  const place = ROLES[role].workplace;
  const workStart = place === 'cafe' ? 7 : place === 'market' ? 8 : place === 'library' ? 9 : 8.5 + r.range(0, 1) + shift * 0.5;
  const workEnd = place === 'cafe' ? 15.5 : place === 'library' ? 17 : workStart + 8.5 + (traits.includes('workaholic') ? 1.5 : 0);
  return {
    wake,
    sleep: 22.5 + r.range(0, 1) + shift,
    workStart,
    workEnd,
    lunch: 12 + r.range(0, 1),
  };
}

export function newTask(sim: Sim, a: Agent): Task {
  const role = ROLES[a.role];
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

export function createAgents(sim: Sim): void {
  const m = sim.town.map;
  const desks = m.props.filter((p) => p.use === 'work' && p.room >= 0 && m.rooms[p.room].kind === 'office');
  const stations: Record<string, number[]> = {
    reception: m.props.filter((p) => p.use === 'work' && m.rooms[p.room]?.kind === 'lobby').map((p) => p.id),
    cafe: m.props.filter((p) => p.use === 'work' && m.rooms[p.room]?.kind === 'cafe').map((p) => p.id),
    market: m.props.filter((p) => p.use === 'work' && m.rooms[p.room]?.kind === 'shop').map((p) => p.id),
    library: m.props.filter((p) => p.use === 'work' && m.rooms[p.room]?.kind === 'library').map((p) => p.id),
  };
  const usedFirst = new Set<string>();
  const deskOrder = sim.rng.shuffle([...desks]);
  CAST.forEach((role, i) => {
    const household = i % sim.town.households.length;
    const h = sim.town.households[household];
    let firstName = sim.rng.pick(FIRST);
    while (usedFirst.has(firstName)) firstName = sim.rng.pick(FIRST);
    usedFirst.add(firstName);
    // First resident gives the home its name; the second is a housemate.
    const last = i < sim.town.households.length ? h.name.replace(' home', '') : sim.rng.pick(LAST);
    const traits = pickTraits(sim);
    const skills = {} as Record<SkillKey, Skill>;
    for (const k of SKILL_KEYS) skills[k] = { level: k === 'craft' ? sim.rng.int(3, 8) : sim.rng.int(0, 4), xp: 0 };
    if (traits.includes('competitive')) skills.athletics.level += 2;
    if (traits.includes('creative')) skills.music.level += 2;
    if (traits.includes('foodie')) skills.cooking.level += 2;
    const station = ROLES[role].station;
    const deskId =
      station === 'desk' ? deskOrder.pop()!.id
      : station === 'reception' ? stations.reception[0]
      : stations[ROLES[role].workplace][0] ?? null;
    const at = m.idx(h.door.x, h.door.y + 2);
    const a: Agent = {
      id: i + 1,
      name: `${firstName} ${last}`,
      age: sim.rng.int(22, 61),
      role,
      household,
      traits,
      outfit: { base: i % 6, shirtHue: sim.rng.int(0, 11) * 30, hairHue: sim.rng.pick([0, 0, 20, 200, 300, 40]), hairLight: sim.rng.pick([0.55, 0.8, 1, 1.25]) },
      schedule: makeSchedule(sim, role, traits),
      x: m.cx(at),
      y: m.cy(at),
      px: m.cx(at),
      py: m.cy(at),
      at,
      path: [],
      pathPos: 0,
      edgeT: 0,
      facing: 'down',
      moving: false,
      needs: Object.fromEntries(NEED_KEYS.map((k) => [k, sim.rng.range(55, 90)])) as Agent['needs'],
      mood: 60,
      skills,
      relations: new Map(),
      memories: [],
      thoughts: [],
      action: { kind: 'idle', label: 'Waking up', reason: '', stage: 'perform', dest: at, timer: 0, started: sim.time, score: 0 },
      thinkIn: sim.rng.range(0, 2),
      task: null,
      tasksDone: 0,
      money: sim.rng.int(40, 160),
      deskId,
      bubble: null,
      workedToday: 0,
      bladder: sim.rng.range(50, 100),
      mealReady: false,
      coffeeDay: -1,
      lastScare: -Infinity,
    };
    a.needs.energy = sim.rng.range(70, 95);
    a.task = newTask(sim, a);
    sim.agents.push(a);
  });
  // Housemates and coworkers already know each other a little.
  for (const a of sim.agents) for (const b of sim.agents) {
    if (a.id === b.id) continue;
    const fam = a.household === b.household ? 40 : ROLES[a.role].workplace === ROLES[b.role].workplace ? 15 : 0;
    if (fam) a.relations.set(b.id, { opinion: a.household === b.household ? sim.rng.range(10, 30) : sim.rng.range(-5, 15), familiarity: fam, lastTalk: -Infinity });
  }
}
