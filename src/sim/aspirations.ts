import { ageOf } from './agents';
import { ADULT_AGE, MIN_PER_DAY, RETIRE_AGE, ROLES } from './defs';
import { TIER_AT } from './growth';
import { Rng } from './rng';
import { addMemory, CLOSE_FRIEND, first, RIVAL, think } from './social';
import type { Sim } from './sim';
import { type ActionKind, type Agent, HEADLINE, NOTABLE } from './types';

/**
 * Life aspirations: every grown-up carries one dream (master their trade, be mayor, raise a big family, see the
 * village become a city...). It leans gently on what they choose to do, shows in the inspector with how close they
 * are, and when it comes true it's the best day of their life. When it's clearly out of reach they let it go and,
 * after a while, find another.
 */

export type DreamKey = 'master' | 'mayor' | 'family' | 'home' | 'love' | 'friend' | 'city' | 'festivals' | 'builder' | 'outlive';

export interface Dream {
  key: DreamKey;
  since: number;
  /** A count at the start, for dreams measured from then (festivals danced at, buildings helped on). */
  base?: number;
  /** The rival they mean to outlive. */
  about?: number;
  /** When it came true, or was let go. */
  done?: number;
  lost?: number;
}

/** Lifetime counts the sim otherwise forgets once the memories fade. */
export interface Deeds {
  built: number;
  festivals: number;
}

/** A dream fulfilled or let go stays on show this long before they find another. */
const BETWEEN = MIN_PER_DAY;
const MASTER = 8;
const BIG_FAMILY = 3;
const FESTIVALS = 4;
const BUILDS = 5;

interface DreamDef {
  /** Inspector: "Dreams of …". */
  text: (sim: Sim, a: Agent, d: Dream) => string;
  /** Feed, on coming true: "Ula's dream came true: …". */
  came: (sim: Sim, a: Agent, d: Dream) => string;
  /** How much this person would want it; 0 if it doesn't fit them. */
  weight: (sim: Sim, a: Agent) => number;
  progress?: (sim: Sim, a: Agent, d: Dream) => string;
  done: (sim: Sim, a: Agent, d: Dream) => boolean;
  /** Why it's out of reach now, or ''. */
  lost?: (sim: Sim, a: Agent, d: Dream) => string;
  /** Extra score for these choices while they hold the dream. */
  leans?: Partial<Record<ActionKind, number>>;
}

export const deeds = (a: Agent): Deeds => (a.deeds ??= { built: 0, festivals: 0 });

const trait = (a: Agent, t: Agent['traits'][number], w: number) => (a.traits.includes(t) ? w : 0);
const working = (a: Agent) => a.role !== 'child' && a.role !== 'retired';
const rivalOf = (sim: Sim, a: Agent) =>
  [...a.relations].filter(([id, r]) => r.opinion <= RIVAL && sim.agent(id)).sort((x, y) => x[1].opinion - y[1].opinion)[0]?.[0];
const bestFriend = (sim: Sim, a: Agent) => Math.max(0, ...[...a.relations].filter(([id]) => sim.agent(id)).map(([, r]) => r.opinion));

export const DREAMS: Record<DreamKey, DreamDef> = {
  master: {
    text: (_s, a) => `mastering ${ROLES[a.role].craft.toLowerCase()}`,
    came: (_s, a) => `became a master of ${ROLES[a.role].craft.toLowerCase()}`,
    weight: (_s, a) => (working(a) && a.skills.craft.level < MASTER - 1 ? 1 + trait(a, 'workaholic', 1.5) + trait(a, 'competitive', 0.5) - trait(a, 'slacker', 0.8) : 0),
    progress: (_s, a) => `level ${a.skills.craft.level} of ${MASTER}`,
    done: (_s, a) => a.skills.craft.level >= MASTER,
    lost: (_s, a) => (a.role === 'retired' ? 'retired before mastering it' : ''),
    // Only choices that don't compete with the job the town assigned them (outdoor labor tasks would churn the crews).
    leans: { work: 0.08, craft: 0.08, teach: 0.06 },
  },
  mayor: {
    text: () => 'being elected mayor',
    came: (sim) => `was elected mayor of ${sim.name}`,
    weight: (sim, a) => (working(a) && sim.mayor !== a.id ? 0.25 + a.skills.charisma.level * 0.15 + trait(a, 'extrovert', 0.5) + trait(a, 'competitive', 0.6) - trait(a, 'introvert', 0.2) : 0),
    done: (sim, a) => sim.mayor === a.id,
    lost: (_s, a) => (a.role === 'retired' ? 'retired without ever winning an election' : ''),
    leans: { socialize: 0.1 },
  },
  family: {
    text: () => 'raising a big family',
    came: () => `raised a big family of ${BIG_FAMILY} or more`,
    weight: (sim, a) => (ageOf(sim, a) < 40 && a.children.length < BIG_FAMILY ? 0.8 + (a.partner !== null ? 0.6 : 0) : 0),
    progress: (_s, a) => `${a.children.length} of ${BIG_FAMILY} children`,
    done: (_s, a) => a.children.length >= BIG_FAMILY,
    lost: (sim, a) => (ageOf(sim, a) >= 50 ? 'the years for a big family have passed' : ''),
  },
  home: {
    text: () => 'a home of their own',
    came: () => 'moved into a home of their own',
    weight: (sim, a) => {
      const hh = sim.town.households[a.household];
      const others = sim.agents.some((o) => o.household === a.household && o.id !== a.id && o.id !== a.partner && !a.children.includes(o.id));
      return ageOf(sim, a) >= ADULT_AGE && (hh.building < 0 || others) ? 1.4 : 0;
    },
    done: (_s, a, d) => a.memories.some((m) => m.kind === 'movedIn' && m.created >= d.since),
  },
  love: {
    text: () => 'finding someone to share life with',
    came: (sim, a) => `married ${first(sim.person(a.partner ?? undefined) ?? a)}`,
    weight: (sim, a) => (a.partner === null && !a.court && ageOf(sim, a) >= 20 && ageOf(sim, a) < 45 ? 1.2 + trait(a, 'extrovert', 0.6) : 0),
    progress: (sim, a) => {
      const s = sim.agent(a.court?.with);
      return s ? `${a.court!.stage === 'engaged' ? 'engaged to' : 'courting'} ${first(s)}` : '';
    },
    done: (_s, a) => a.partner !== null,
    lost: (sim, a) => (ageOf(sim, a) >= 60 ? 'made peace with a life on their own' : ''),
    leans: { socialize: 0.05 },
  },
  friend: {
    text: () => 'a true friend',
    came: () => 'found a true friend',
    weight: (sim, a) => (bestFriend(sim, a) < CLOSE_FRIEND ? trait(a, 'introvert', 1.2) + 0.4 : 0),
    progress: (sim, a) => `closest friendship ${Math.round(bestFriend(sim, a))} of ${CLOSE_FRIEND}`,
    done: (sim, a) => bestFriend(sim, a) >= CLOSE_FRIEND,
    leans: { socialize: 0.1 },
  },
  city: {
    text: (sim) => `seeing ${sim.name} become a city`,
    came: (sim) => `saw ${sim.name} become a city`,
    weight: (sim, a) => (sim.tier < 2 ? 0.4 + (ageOf(sim, a) >= 40 ? 0.4 : 0) : 0),
    progress: (sim) => `${sim.agents.length} of ${TIER_AT[2][0]} people`,
    done: (sim) => sim.tier >= 2,
  },
  festivals: {
    text: () => 'dancing at every festival for a year',
    came: () => `danced at ${FESTIVALS} festivals in a row`,
    weight: (_s, a) => 0.3 + trait(a, 'extrovert', 0.8) + trait(a, 'cheerful', 0.3),
    progress: (_s, a, d) => `${deeds(a).festivals - (d.base ?? 0)} of ${FESTIVALS}`,
    done: (_s, a, d) => deeds(a).festivals - (d.base ?? 0) >= FESTIVALS,
    leans: { party: 0.2 },
  },
  builder: {
    text: () => 'helping build the town',
    came: () => `helped raise ${BUILDS} buildings`,
    weight: (_s, a) => (['builder', 'laborer', 'carpenter', 'mason'].includes(a.role) ? 1.3 : working(a) ? 0.2 : 0),
    progress: (_s, a, d) => `${deeds(a).built - (d.base ?? 0)} of ${BUILDS} buildings`,
    done: (_s, a, d) => deeds(a).built - (d.base ?? 0) >= BUILDS,
  },
  outlive: {
    text: (sim, _a, d) => `outliving ${first(sim.person(d.about) ?? _a)}`,
    came: (sim, _a, d) => `outlived ${first(sim.person(d.about) ?? _a)}`,
    weight: (sim, a) => (a.traits.includes('competitive') && rivalOf(sim, a) !== undefined ? 1.5 : 0),
    done: (sim, _a, d) => !sim.agent(d.about) && sim.deceased.some((x) => x.id === d.about),
    lost: (sim, a, d) => ((a.relations.get(d.about!)?.opinion ?? 0) > 0 ? `made peace with ${first(sim.person(d.about) ?? a)}` : !sim.person(d.about) ? 'their rival left town' : ''),
  },
};

const KEYS = Object.keys(DREAMS) as DreamKey[];

/** Extra score a dream gives one kind of choice. */
export function dreamLean(a: Agent, kind: ActionKind): number {
  const d = a.dream;
  return d && !d.done && !d.lost ? (DREAMS[d.key].leans?.[kind] ?? 0) : 0;
}

/** True while they hold this dream, not yet come true or let go. */
export function dreaming(a: Agent | undefined, key: DreamKey): boolean {
  return !!a?.dream && a.dream.key === key && !a.dream.done && !a.dream.lost;
}

/** For the inspector: "Dreams of · being elected mayor", with progress; or how it ended. */
export function dreamLine(sim: Sim, a: Agent): { label: string; text: string; progress: string; state: 'open' | 'done' | 'lost' } | null {
  const d = a.dream;
  if (!d) return null;
  const def = DREAMS[d.key];
  if (d.done) return { label: 'Dream come true', text: `${first(a)} ${def.came(sim, a, d)}`, progress: '', state: 'done' };
  if (d.lost) return { label: 'Let go of', text: def.text(sim, a, d), progress: '', state: 'lost' };
  return { label: 'Dreams of', text: def.text(sim, a, d), progress: def.progress?.(sim, a, d) ?? '', state: 'open' };
}

/** A few times a day: dreams come true or are let go, and grown-ups without one find one. */
export function tickAspirations(sim: Sim): void {
  for (const a of sim.agents) {
    if (ageOf(sim, a) < ADULT_AGE) continue;
    const d = a.dream;
    if (!d || ((d.done || d.lost) && sim.time - (d.done ?? d.lost!) >= BETWEEN)) {
      a.dream = pick(sim, a, d?.key);
      continue;
    }
    if (d.done || d.lost) continue;
    const def = DREAMS[d.key];
    if (def.done(sim, a, d)) fulfil(sim, a, d);
    else {
      const why = def.lost?.(sim, a, d);
      if (why) letGo(sim, a, d, why);
    }
  }
}

function pick(sim: Sim, a: Agent, last?: DreamKey): Dream | undefined {
  // The old have done their dreaming; nobody new takes one up past retirement, though they keep the one they hold.
  if (ageOf(sim, a) >= RETIRE_AGE + 6) return undefined;
  const options = KEYS.filter((k) => k !== last).map((k) => [k, DREAMS[k].weight(sim, a)] as const).filter(([, w]) => w > 0);
  const total = options.reduce((s, [, w]) => s + w, 0);
  if (!total) return undefined;
  // Dice of its own, from the town, the person and the moment, so taking up dreams doesn't reshuffle the town's.
  let r = new Rng(sim.seed * 7919 + a.id * 104729 + Math.floor(sim.time)).range(0, total);
  const key = (options.find(([, w]) => (r -= w) <= 0) ?? options[options.length - 1])[0];
  const d: Dream = { key, since: sim.time };
  if (key === 'festivals') d.base = deeds(a).festivals;
  if (key === 'builder') d.base = deeds(a).built;
  if (key === 'outlive') d.about = rivalOf(sim, a);
  think(sim, a, `Someday I'd love ${key === 'home' ? 'a home of my own' : DREAMS[key].text(sim, a, d).replace(/ their /, ' my ')}.`, 'good');
  return d;
}

function fulfil(sim: Sim, a: Agent, d: Dream): void {
  d.done = sim.time;
  const what = DREAMS[d.key].came(sim, a, d);
  addMemory(sim, a, 'dreamCameTrue');
  think(sim, a, `I did it. I ${what.replace(/ their /, ' my ')}.`, 'good');
  sim.log(`A dream come true: ${a.name} ${what}`, 'life', 'good', a).weight = HEADLINE;
}

function letGo(sim: Sim, a: Agent, d: Dream, why: string): void {
  d.lost = sim.time;
  const peace = why.startsWith('made peace');
  if (!peace) addMemory(sim, a, 'dreamFaded');
  const e = sim.log(`${first(a)} ${peace ? why : `let go of a dream: ${why}`}`, 'life', peace ? 'good' : 'neutral', a, peace ? sim.agent(d.about) : undefined);
  if (peace) e.weight = NOTABLE;
}
