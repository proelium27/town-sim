import type { Outfit } from '../assets/loader';
import { ageOf, createAgent, distinctName, makeSchedule, surnameOf } from './agents';
import type { Dream, DreamKey } from './aspirations';
import { DREAMS } from './aspirations';
import { ADULT_AGE, MEMORIES, type MemoryKind, MIN_PER_DAY, RETIRE_AGE, ROLES, type RoleKey, SKILL_KEYS, type SkillKey, TRAIT_KEYS, type TraitKey, YEARS_PER_DAY } from './defs';
import { APTITUDES, type Aptitude } from './careers';
import { takeInChildren } from './life';
import { succession } from './business';
import { allocateRoles, newHousehold } from './planner';
import { addMemory, first, think } from './social';
import type { Sim } from './sim';
import { type Agent, HEADLINE, type Memory, NOTABLE } from './types';

/**
 * Travelers between towns. "Send on a journey" packs a person or a household into a small file and they leave town;
 * importing that file in another town (a friend's, or your own) sends a cart down the east road a day or so later.
 * The file is plain data and is checked field by field on the way in: names, ages, traits, skills, their trade, the
 * big memories, a dream, and a small purse. Nothing tied to the old map comes along.
 */

export const TRAVEL_KIND = 'townsfolk-traveler';
export const TRAVEL_VERSION = 1;
/** Most people one cart can carry. */
export const PARTY_MAX = 8;
/** The purse each traveler may bring. */
export const PURSE_MAX = 200;
/** Carts the town will expect in one day. */
export const ARRIVALS_PER_DAY = 2;
/** Game minutes from import to the cart coming down the road. */
export const JOURNEY = 1.5 * MIN_PER_DAY;

export interface TravelerMemory {
  kind: MemoryKind;
  label: string;
  mood: number;
  /** Minutes before leaving that it happened, and that it has left to run. */
  ago: number;
  left: number;
  /** The fellow traveler it's about, by their key in the party. */
  about?: number;
}

export interface Traveler {
  /** Their place in the party, for family ties within it. */
  key: number;
  name: string;
  /** Years, fractional. */
  age: number;
  /** Their trade, or child/retired. */
  role: RoleKey;
  traits: TraitKey[];
  outfit: Outfit;
  skills: Record<SkillKey, number>;
  aptitude: Record<Aptitude, number>;
  money: number;
  partner?: number;
  parents: number[];
  memories: TravelerMemory[];
  dream?: { key: DreamKey; ago: number };
}

export interface TravelerFile {
  kind: typeof TRAVEL_KIND;
  version: number;
  /** Unique per journey, so the same cart can't arrive twice. */
  id: string;
  from: { name: string; seed: number; year: number };
  people: Traveler[];
}

export interface Expected {
  at: number;
  file: TravelerFile;
}

/** The household's people if whole is set, else just this person (and a child never sets off alone). */
export function partyFor(sim: Sim, a: Agent, whole: boolean): Agent[] {
  return whole ? sim.agents.filter((o) => o.household === a.household) : [a];
}

/** Why this party can't set off, or null if it can. */
export function cantTravel(sim: Sim, party: Agent[]): string | null {
  if (!party.length) return 'Nobody to send';
  if (party.length > PARTY_MAX) return `A cart carries at most ${PARTY_MAX} people`;
  if (party.every((a) => ageOf(sim, a) < ADULT_AGE)) return 'Children travel with a grown-up';
  if (party.some((a) => a.illness)) return 'Someone is too ill to travel';
  return null;
}

const keyOf = (party: Agent[], id: number | null | undefined) => {
  const i = party.findIndex((p) => p.id === id);
  return i < 0 ? undefined : i;
};

/** Packs the party for the road. */
export function pack(sim: Sim, party: Agent[]): TravelerFile {
  const people = party.map((a, i): Traveler => {
    const memories = a.memories
      .filter((m) => m.major && m.expires > sim.time)
      .map((m): TravelerMemory => ({ kind: m.kind, label: m.label, mood: m.mood, ago: sim.time - m.created, left: m.expires - sim.time, about: keyOf(party, m.about) }));
    const role = a.role === 'child' || a.role === 'retired' ? a.role : (a.career ?? a.role);
    return {
      key: i,
      name: a.name,
      age: ageOf(sim, a),
      role,
      traits: [...a.traits],
      outfit: { ...a.outfit },
      skills: Object.fromEntries(SKILL_KEYS.map((k) => [k, a.skills[k].level])) as Record<SkillKey, number>,
      aptitude: { ...a.aptitude },
      money: Math.min(PURSE_MAX, Math.max(0, Math.floor(a.money))),
      partner: keyOf(party, a.partner),
      parents: a.parents.map((id) => keyOf(party, id)).filter((k): k is number => k !== undefined),
      memories,
      dream: a.dream && a.dream.done === undefined && a.dream.lost === undefined ? { key: a.dream.key, ago: sim.time - a.dream.since } : undefined,
    };
  });
  return {
    kind: TRAVEL_KIND,
    version: TRAVEL_VERSION,
    id: `${sim.seed.toString(36)}-${Math.floor(sim.time).toString(36)}-${party[0].id.toString(36)}`,
    from: { name: sim.name, seed: sim.seed, year: sim.year },
    people,
  };
}

/**
 * Sees the party off: packs them, takes them out of town (no grief: people who were close miss them instead), and
 * returns the file to hand on. Kids left behind are taken in by family, as when someone dies.
 */
export function sendAway(sim: Sim, party: Agent[]): TravelerFile {
  const file = pack(sim, party);
  depart(sim, party);
  const names = party.map(first);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  sim.log(`${list} set off for another town`, 'family', 'neutral', party[0], party[1]).weight = HEADLINE;
  sim.milestone(`${party.map((a) => a.name).join(', ')} left ${sim.name}`);
  takeInChildren(sim);
  return file;
}

/** Takes people out of town, tidying every tie the town keeps to them. Shared by journeys and hard-times leaving. */
export function depart(sim: Sim, party: Agent[]): void {
  const ids = new Set(party.map((a) => a.id));
  for (const a of party) succession(sim, a);
  for (const a of party) {
    if (a.action.propId !== undefined && sim.reserved.get(a.action.propId) === a.id) sim.reserved.delete(a.action.propId);
  }
  sim.agents = sim.agents.filter((a) => !ids.has(a.id));
  sim.departed.push(...party);
  sim.populationVersion++;
  for (const o of sim.agents) {
    if (o.partner !== null && ids.has(o.partner)) o.partner = null;
    if (o.court && ids.has(o.court.with)) o.court = undefined;
    if (o.mentor !== undefined && ids.has(o.mentor)) {
      o.mentor = undefined;
      o.apprenticeUntil = undefined;
    }
    const close = party.some((a) => o.parents.includes(a.id) || o.children.includes(a.id) || a.partner === o.id || (o.relations.get(a.id)?.opinion ?? 0) >= 40);
    if (close) {
      const dear = party.find((a) => (o.relations.get(a.id)?.opinion ?? 0) >= 40) ?? party[0];
      addMemory(sim, o, 'missYou', dear);
      think(sim, o, `I'll miss ${first(dear)}. I hope they write.`, 'bad');
    }
  }
  for (const p of sim.projects) for (const id of ids) p.builders.delete(id);
  if (sim.mayor !== null && ids.has(sim.mayor)) {
    sim.mayor = null;
    sim.log(`${sim.name} is without a mayor until the next election`, 'event', 'bad').weight = HEADLINE;
  }
}

// ---------------------------------------------------------------- reading a file

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what} isn't a number`);
  return Math.min(hi, Math.max(lo, v));
};
const str = (v: unknown, max: number, what: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${what} is missing`);
  // Plain printable text only: names and labels end up in the feed and the chronicle.
  return v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
};
const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

/** Reads and checks a traveler file. Throws with a reason fit to show if it isn't one. */
export function readTravelers(text: string): TravelerFile {
  if (text.length > 200_000) throw new Error("That file is far too big to be a traveler. Saved towns go in with Import");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That isn't a traveler file (it isn't JSON)");
  }
  if (!isObj(raw) || raw.kind !== TRAVEL_KIND) throw new Error("That isn't a traveler file. Saved towns go in with Import");
  if (raw.version !== TRAVEL_VERSION) throw new Error(`That traveler file is from a different version (${String(raw.version)})`);
  if (!isObj(raw.from)) throw new Error('The file doesn\'t say where they\'re from');
  if (!Array.isArray(raw.people) || !raw.people.length) throw new Error('Nobody is in this cart');
  if (raw.people.length > PARTY_MAX) throw new Error(`A cart carries at most ${PARTY_MAX} people`);
  const n = raw.people.length;
  const key = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n ? v : undefined);
  const people = raw.people.map((p: unknown, i: number): Traveler => {
    if (!isObj(p)) throw new Error(`Traveler ${i + 1} is unreadable`);
    const name = str(p.name, 40, `Traveler ${i + 1}'s name`);
    if (!/^\S+ \S/.test(name)) throw new Error(`"${name}" needs a first and family name`);
    const role = ROLE_KEYS.includes(p.role as RoleKey) ? (p.role as RoleKey) : 'laborer';
    const traits = (Array.isArray(p.traits) ? p.traits : []).filter((t): t is TraitKey => TRAIT_KEYS.includes(t as TraitKey));
    const sk = isObj(p.skills) ? p.skills : {};
    const ap = isObj(p.aptitude) ? p.aptitude : {};
    const o = isObj(p.outfit) ? p.outfit : {};
    const memories = (Array.isArray(p.memories) ? p.memories : []).slice(0, 12).flatMap((m: unknown): TravelerMemory[] => {
      if (!isObj(m) || !((m.kind as string) in MEMORIES)) return [];
      return [{ kind: m.kind as MemoryKind, label: str(m.label, 60, 'A memory'), mood: num(m.mood, -30, 30, 'A memory'), ago: num(m.ago, 0, 10 * MIN_PER_DAY, 'A memory'), left: num(m.left, 0, 10 * MIN_PER_DAY, 'A memory'), about: key(m.about) }];
    });
    const dream = isObj(p.dream) && (p.dream.key as string) in DREAMS ? { key: p.dream.key as DreamKey, ago: num(p.dream.ago ?? 0, 0, 100 * MIN_PER_DAY, 'A dream') } : undefined;
    return {
      key: i,
      name,
      age: num(p.age, 0, 95, `${name}'s age`),
      role,
      traits: [...new Set(traits)].slice(0, 3),
      outfit: {
        base: Math.floor(num(o.base ?? 0, 0, 5, 'Their look')),
        shirtHue: num(o.shirtHue ?? 0, 0, 359, 'Their look'),
        hairHue: num(o.hairHue ?? 0, 0, 359, 'Their look'),
        hairLight: num(o.hairLight ?? 1, 0.4, 1.8, 'Their look'),
      },
      skills: Object.fromEntries(SKILL_KEYS.map((k) => [k, Math.floor(num(sk[k] ?? 0, 0, 10, `${name}'s skills`))])) as Record<SkillKey, number>,
      aptitude: Object.fromEntries(APTITUDES.map((k) => [k, num(ap[k] ?? 15, 0, 100, `${name}'s leanings`)])) as Record<Aptitude, number>,
      money: Math.floor(num(p.money ?? 0, 0, PURSE_MAX, `${name}'s purse`)),
      partner: key(p.partner),
      parents: (Array.isArray(p.parents) ? p.parents : []).map(key).filter((k): k is number => k !== undefined && k !== i).slice(0, 2),
      memories,
      dream,
    };
  });
  // Ties go both ways or not at all.
  for (const p of people) if (p.partner !== undefined && (p.partner === p.key || people[p.partner].partner !== p.key)) p.partner = undefined;
  return {
    kind: TRAVEL_KIND,
    version: TRAVEL_VERSION,
    id: str(raw.id, 60, 'The journey'),
    from: { name: str(raw.from.name, 30, 'Their home town'), seed: num(raw.from.seed ?? 0, -1e12, 1e12, 'Their home town'), year: Math.floor(num(raw.from.year ?? 1, 1, 1e6, 'Their home town')) },
    people,
  };
}

/**
 * Expects a cart: a day and a half on the road. Throws with a reason fit to show if the town can't take it (already
 * here or on the way, or too many carts today).
 */
export function expectCart(sim: Sim, file: TravelerFile): Expected {
  if (sim.travelSeen.includes(file.id)) throw new Error(`${partyName(file)} already came to ${sim.name}`);
  const today = Math.floor(sim.time / MIN_PER_DAY);
  const due = sim.expected.filter((e) => Math.floor((e.at - JOURNEY) / MIN_PER_DAY) === today).length;
  if (due >= ARRIVALS_PER_DAY) throw new Error(`${sim.name} is already expecting ${ARRIVALS_PER_DAY} carts today. Try again tomorrow`);
  const e = { at: sim.time + JOURNEY, file };
  sim.expected.push(e);
  sim.travelSeen.push(file.id);
  sim.log(`Word came that ${partyName(file)} ${file.people.length > 1 ? 'are' : 'is'} on the road from ${fromName(sim, file)}`, 'family', 'good').weight = NOTABLE;
  return e;
}

/** "Mara Okafor", "Mara Okafor and family", or "Mara Okafor and Juno Reyes". */
export function partyName(file: TravelerFile): string {
  const [a, b] = file.people;
  if (!b) return a.name;
  return file.people.length === 2 && surnameOf(a.name) !== surnameOf(b.name) ? `${a.name} and ${b.name}` : `${a.name} and family`;
}

/** Where they're from, telling it apart from this town when the names match. */
export function fromName(sim: Sim, file: TravelerFile): string {
  return file.from.name === sim.name ? `another town called ${file.from.name}` : file.from.name;
}

/** Carts arrive when they're due. */
export function tickTravel(sim: Sim): void {
  if (!sim.expected.length) return;
  for (const e of sim.expected.filter((x) => x.at <= sim.time)) {
    sim.expected = sim.expected.filter((x) => x !== e);
    arrive(sim, e.file);
  }
}

/** The cart comes down the east road: the party joins the town with their trades, skills and memories. */
export function arrive(sim: Sim, file: TravelerFile): Agent[] {
  const m = sim.map;
  // A home with room for all of them, like newcomers; otherwise they're a household waiting on a house.
  const homes = sim.town.households.filter((h) => h.building >= 0 && sim.agents.filter((a) => a.household === h.id).length === 0);
  const surname = surnameOf(file.people[0].name);
  const hh = homes[0]?.id ?? newHousehold(sim, `${surname} family`).id;
  const made: Agent[] = [];
  for (const p of file.people) {
    const cell = m.idx(m.w - 1 - made.length, 27);
    const role: RoleKey = p.age < ADULT_AGE ? 'child' : p.age >= RETIRE_AGE ? 'retired' : 'laborer';
    const a = createAgent(sim, { role, household: hh, age: p.age, cell });
    a.name = distinctName(sim, p.name);
    a.traits = [...p.traits];
    a.schedule = makeSchedule(sim, role, a.traits);
    a.outfit = { ...p.outfit };
    for (const k of SKILL_KEYS) a.skills[k] = { level: p.skills[k], xp: 0 };
    a.aptitude = { ...p.aptitude };
    a.money = p.money;
    a.birth = sim.time - (p.age / YEARS_PER_DAY) * MIN_PER_DAY;
    a.age = Math.floor(p.age);
    if (role === 'laborer' && p.role !== 'child' && p.role !== 'retired') a.career = p.role;
    if (p.dream) a.dream = { key: p.dream.key, since: sim.time - p.dream.ago } as Dream;
    a.from = file.from.name;
    made.push(a);
    sim.agents.push(a);
  }
  // Family ties within the party.
  const tie = (x: Agent, y: Agent, opinion: number, familiarity: number) => x.relations.set(y.id, { opinion, familiarity, lastTalk: -Infinity });
  file.people.forEach((p, i) => {
    const a = made[i];
    if (p.partner !== undefined) a.partner = made[p.partner].id;
    for (const k of p.parents) {
      const parent = made[k];
      a.parents.push(parent.id);
      parent.children.push(a.id);
      tie(a, parent, 60, 90);
      tie(parent, a, 75, 90);
    }
  });
  for (const a of made) {
    for (const b of made) {
      if (a === b || a.relations.has(b.id)) continue;
      tie(a, b, a.partner === b.id ? 80 : 35, a.partner === b.id ? 95 : 60);
    }
  }
  // What they bring with them: the big memories, about each other where they were, otherwise about "someone back home".
  file.people.forEach((p, i) => {
    const a = made[i];
    for (const mem of p.memories) {
      const about = mem.about !== undefined ? made[mem.about] : undefined;
      const def = MEMORIES[mem.kind];
      const label = about || mem.label !== def.label ? mem.label : `${mem.label} (back home)`;
      a.memories.push({ kind: mem.kind, label, mood: mem.mood, created: sim.time - mem.ago, expires: sim.time + mem.left, about: about?.id, major: true } satisfies Memory);
    }
    addMemory(sim, a, 'freshStart');
    think(sim, a, `So this is ${sim.name}. A fresh start.`, 'good');
  });
  sim.populationVersion++;
  const lead = made[0];
  const trade = file.people[0].role;
  const what = trade === 'child' || trade === 'retired' || trade === 'laborer' ? '' : `, ${article(ROLES[trade].title.toLowerCase())}`;
  const others = made.slice(1).map(first);
  const company = others.length ? `, with ${others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}` : others[0]}` : '';
  const homeless = sim.town.households[hh].building < 0;
  sim.log(`A cart came down the east road: ${lead.name}${what} from ${fromName(sim, file)}${company}${homeless ? '. They have nowhere to live yet' : ''}`, 'family', 'good', lead, made[1]).weight = HEADLINE;
  sim.milestone(`${made.map((a) => a.name).join(', ')} came from ${file.from.name}`);
  allocateRoles(sim);
  return made;
}

const article = (w: string) => `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w}`;
