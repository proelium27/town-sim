import { emptyStock, NEED_KEYS, NEEDS } from './defs';
import { backfillAgent } from './agents';
import { CLASSIC } from './character';
import { emptyLedger } from './market';
import { Nav } from './nav';
import { Sim } from './sim';
import { HEADLINE } from './types';

/** Bump when the saved shape changes, and add a step to MIGRATIONS that upgrades the old shape. */
export const SAVE_VERSION = 1;

/** Fields that are rebuilt rather than saved: caches and indexes derived from the rest. */
const SKIP = new Set(['nav', 'propsAt', 'byId', 'groundDirty']);

type Typed = Uint8Array | Int16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
const TYPED: Record<string, new (a: number[]) => Typed> = { Uint8Array, Int16Array, Int32Array, Uint32Array, Float32Array, Float64Array };

/** JSON can't hold Maps, Sets, typed arrays or infinities, all of which the sim uses. */
function replacer(this: unknown, key: string, v: unknown): unknown {
  if (SKIP.has(key)) return undefined;
  if (typeof v === 'number' && !Number.isFinite(v)) return { $n: String(v) };
  if (v instanceof Map) return { $map: [...v.entries()] };
  if (v instanceof Set) return { $set: [...v] };
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return { $ta: v.constructor.name, d: Array.from(v as Typed) };
  return v;
}

function reviver(key: string, v: unknown): unknown {
  // A hand-edited file could swap the Sim's prototype through Object.assign.
  if (key === '__proto__' || key === 'constructor') return undefined;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  if ('$n' in o) return Number(o.$n);
  if ('$map' in o) return new Map(o.$map as [unknown, unknown][]);
  if ('$set' in o) return new Set(o.$set as unknown[]);
  if ('$ta' in o) return new TYPED[o.$ta as string](o.d as number[]);
  return v;
}

export interface SaveFile {
  v: number;
  savedAt: string;
  sim: Record<string, unknown>;
}

/** The whole town as a string: map edits, people, projects, stores, weather and the RNG state. */
export function saveSim(sim: Sim): string {
  return `{"v":${SAVE_VERSION},"savedAt":${JSON.stringify(new Date().toISOString())},"sim":${snapshot(sim)}}`;
}

/** Just the town's state, for comparing two towns. */
export function snapshot(sim: Sim): string {
  return JSON.stringify(sim, replacer);
}

/** Upgrades older saves one version at a time. Index i turns version i+1 into i+2. */
const MIGRATIONS: ((s: Record<string, unknown>) => void)[] = [];

/** Rebuilds a running town from saveSim's output. Throws on files it can't read. */
export function loadSim(text: string): Sim {
  const file = JSON.parse(text, reviver) as SaveFile;
  if (!file || typeof file !== 'object' || !Number.isInteger(file.v) || file.v < 1 || !file.sim || typeof file.sim !== 'object') {
    throw new Error('This is not a Townsfolk save file.');
  }
  if (file.v > SAVE_VERSION) throw new Error(`This save was made by a newer version of Townsfolk (save version ${file.v}; this one reads up to ${SAVE_VERSION}).`);
  for (let v = file.v; v < SAVE_VERSION; v++) MIGRATIONS[v - 1](file.sim);

  const { town, rng, ...rest } = file.sim as { town: Record<string, unknown>; rng: { s: number } } & Record<string, unknown>;
  const sim = new Sim(rest.seed as number, { agents: false });
  Object.assign(sim, rest);
  const { map, ...townRest } = town;
  Object.assign(sim.town, townRest);
  Object.assign(sim.town.map, map);
  sim.town.map.reindex();
  (sim.rng as unknown as { s: number }).s = rng.s;
  sim.nav = new Nav(sim.town.map);
  // Anything added since the save was made starts from a sensible default.
  sim.stock = { ...emptyStock(), ...sim.stock };
  sim.departed ??= [];
  for (const a of [...sim.agents, ...sim.deceased, ...sim.departed]) {
    backfillAgent(a);
    // Per-person backfills that set a need go before this generic fallback, or it would fill the need first.
    // Prefer NeedDef.backfill in defs.ts for a need's starting value.
    for (const k of NEED_KEYS) a.needs[k] ??= NEEDS[k].backfill ?? 80;
  }
  // The chronicle starts from whatever headlines the saved feed still holds.
  if (!('chronicle' in rest)) sim.chronicle = sim.activity.filter((e) => (e.weight ?? 0) >= HEADLINE).map(({ t, text, agentId, otherId }) => ({ t, text, agentId, otherId }));
  if (!('chronicleSeen' in rest)) sim.chronicleSeen = sim.activityVersion;
  sim.fires ??= [];
  sim.firesEver ??= 0;
  sim.timers.fire ??= 60;
  sim.events.birthdays ??= [];
  sim.events.weddings ??= [];
  sim.events.funerals ??= [];
  sim.events.wet ??= 0;
  sim.events.seasonal ??= null;
  sim.events.snowstorm ??= null;
  if (sim.fuel.length < sim.town.households.length) sim.fuel = sim.town.households.map((_, i) => sim.fuel[i] ?? 8);
  // Parties saved before joint birthdays had a single host.
  for (const b of sim.events.birthdays as (typeof sim.events.birthdays[number] & { host?: number; age?: number })[]) {
    if (!b.hosts) b.hosts = b.host !== undefined ? [b.host] : [];
    delete b.host;
    delete b.age;
  }
  sim.tier ??= 0;
  sim.hardDays ??= [];
  // Towns saved before characters grew up as the original Northwind, whatever their seed would roll now.
  if (!('character' in rest)) sim.character = CLASSIC;
  else {
    // Dials added since the save was made start neutral, the way the original town had them.
    const { classic: _, ...neutral } = CLASSIC;
    sim.character = { ...neutral, ...sim.character };
  }
  // The Sim starts at 0 terms, so check the file itself: a mayor in an older save has served one term.
  if (!('mayorTerms' in rest)) sim.mayorTerms = sim.mayor === null ? 0 : 1;
  sim.ledger = { ...emptyLedger(), ...sim.ledger };
  sim.lastLedger = { ...emptyLedger(), ...sim.lastLedger };
  return sim;
}
