import { MEMORIES, type MemoryKind, NEED_KEYS, NEEDS, type NeedKey, type TraitKey } from './defs';
import { clamp } from './rng';
import { exposure } from './health';
import type { Agent, Memory, Relation, Tone } from './types';
import type { Sim } from './sim';

export const FRIEND = 35;
export const CLOSE_FRIEND = 70;
export const RIVAL = -30;

export const first = (a: Agent): string => a.name.split(' ')[0];

/** How someone is related to a person by blood or marriage. */
export type Kin = 'partner' | 'parent' | 'child' | 'sibling' | 'grandparent' | 'grandchild' | 'in-law' | 'stepparent' | 'stepchild';

/** How b is related to a, or null if they aren't family. */
export function kinship(sim: Sim, a: Agent, b: Agent): Kin | null {
  if (a.id === b.id) return null;
  if (a.partner === b.id) return 'partner';
  if (a.parents.includes(b.id)) return 'parent';
  if (a.children.includes(b.id)) return 'child';
  if (a.parents.some((p) => b.parents.includes(p))) return 'sibling';
  if (b.children.some((c) => a.parents.includes(c))) return 'grandparent';
  if (a.children.some((c) => b.parents.includes(c))) return 'grandchild';
  if (b.partner !== null && a.parents.includes(b.partner)) return 'stepparent';
  const mate = a.partner !== null ? sim.agent(a.partner) : undefined;
  if (mate?.children.includes(b.id)) return 'stepchild';
  if (mate?.parents.includes(b.id) || (b.partner !== null && a.children.includes(b.partner))) return 'in-law';
  return null;
}

/** The bond level, from opinion and (for family) kinship. Family ranks above close friends. */
export function relationLabel(op: number, kin: Kin | null = null): string {
  if (kin) return op <= RIVAL ? 'Estranged family' : 'Family';
  if (op >= CLOSE_FRIEND) return 'Close friend';
  if (op >= FRIEND) return 'Friend';
  if (op <= -65) return 'Nemesis';
  if (op <= RIVAL) return 'Rival';
  if (op >= 10) return 'Friendly';
  if (op <= -10) return 'Tense';
  return 'Acquaintance';
}

export function rel(a: Agent, b: Agent): Relation {
  let r = a.relations.get(b.id);
  if (!r) {
    r = { opinion: 0, familiarity: 0, lastTalk: -Infinity };
    a.relations.set(b.id, r);
  }
  return r;
}

export function think(sim: Sim, a: Agent, text: string, tone: Tone = 'neutral'): void {
  const last = a.thoughts[a.thoughts.length - 1];
  if (last && last.text === text && sim.time - last.t < 90) return;
  a.thoughts.push({ t: sim.time, text, tone });
  if (a.thoughts.length > 40) a.thoughts.splice(0, a.thoughts.length - 40);
}

export function say(sim: Sim, a: Agent, text: string, tone: Tone = 'neutral', minutes = 6): void {
  a.bubble = { text, until: sim.time + minutes, tone };
}

export function addMemory(sim: Sim, a: Agent, kind: MemoryKind, about?: Agent, scale = 1): void {
  const def = MEMORIES[kind];
  // Counted in place: some memories are refreshed every step (starving, stinky), so no throwaway list.
  let first: Memory | undefined;
  let same = 0;
  for (const m of a.memories) {
    if (m.kind !== kind || m.about !== about?.id) continue;
    first ??= m;
    same++;
  }
  if (same >= def.maxStack) {
    first!.created = sim.time;
    first!.expires = sim.time + def.duration;
    return;
  }
  a.memories.push({
    kind,
    label: about ? `${def.label}: ${about.name}` : def.label,
    mood: Math.round(def.mood * scale),
    created: sim.time,
    expires: sim.time + def.duration,
    about: about?.id,
    major: def.major,
  });
}

export function expireMemories(sim: Sim, a: Agent): void {
  if (a.memories.some((m) => m.expires <= sim.time)) a.memories = a.memories.filter((m) => m.expires > sim.time);
}

/** Traits that make a need weigh more on mood when it runs low. */
const TRAIT_WEIGHT: Partial<Record<NeedKey, [TraitKey, number]>> = {
  hygiene: ['neatFreak', 0.6],
  social: ['extrovert', 0.45],
  work: ['workaholic', 0.45],
};

export interface MoodPart {
  label: string;
  value: number;
}

/** Itemised mood: baseline, traits, need pressure, memories. */
export function moodParts(a: Agent): MoodPart[] {
  const out: MoodPart[] = [{ label: 'Baseline', value: 55 }];
  if (a.traits.includes('cheerful')) out.push({ label: 'Cheerful', value: 8 });
  if (a.traits.includes('grumpy')) out.push({ label: 'Grumpy', value: -8 });
  const n = a.needs;
  for (const k of NEED_KEYS) {
    if (n[k] >= 30) continue;
    const t = TRAIT_WEIGHT[k];
    const w = t && a.traits.includes(t[0]) ? t[1] : NEEDS[k].weight;
    out.push({ label: NEEDS[k].low, value: -Math.round((30 - n[k]) * w) });
  }
  const met = NEED_KEYS.filter((k) => n[k] > 75).length;
  if (met) out.push({ label: 'Needs met', value: met * 2 });
  for (const m of a.memories) out.push({ label: m.label, value: m.mood });
  return out;
}

/** The sum of moodParts, added up in the same order without building the list (it runs for everyone, every step). */
export function moodTarget(a: Agent): number {
  let s = 55;
  if (a.traits.includes('cheerful')) s += 8;
  if (a.traits.includes('grumpy')) s += -8;
  const n = a.needs;
  let met = 0;
  for (const k of NEED_KEYS) {
    if (n[k] > 75) met++;
    if (n[k] >= 30) continue;
    const t = TRAIT_WEIGHT[k];
    const w = t && a.traits.includes(t[0]) ? t[1] : NEEDS[k].weight;
    s += -Math.round((30 - n[k]) * w);
  }
  if (met) s += met * 2;
  for (const m of a.memories) s += m.mood;
  return clamp(s, 0, 100);
}

export function moodWord(m: number): string {
  if (m >= 80) return 'Great';
  if (m >= 62) return 'Good';
  if (m >= 45) return 'Okay';
  if (m >= 28) return 'Stressed';
  return 'Miserable';
}

function compatibility(a: Agent, b: Agent): number {
  const has = (x: Agent, t: string) => x.traits.includes(t as never);
  const both = (t: string) => has(a, t) && has(b, t);
  const either = (t: string) => has(a, t) || has(b, t);
  const clash = (p: string, q: string) => (has(a, p) && has(b, q)) || (has(a, q) && has(b, p));
  let c = 0;
  if (either('cheerful')) c += 0.2;
  if (either('grumpy')) c -= 0.2;
  if (both('extrovert')) c += 0.15;
  if (both('introvert')) c += 0.1;
  if (clash('workaholic', 'slacker')) c -= 0.25;
  if (clash('earlyBird', 'nightOwl')) c -= 0.1;
  if (clash('neatFreak', 'slacker')) c -= 0.1;
  if (both('competitive')) c -= 0.05;
  if (a.role === b.role) c += 0.1;
  c += a.traits.filter((t) => b.traits.includes(t)).length * 0.08;
  return c;
}

export function shiftOpinion(sim: Sim, a: Agent, b: Agent, delta: number): void {
  const r = rel(a, b);
  const before = r.opinion;
  const kin = kinship(sim, a, b);
  // Family fights blow over: a falling-out with kin stings half as much.
  if (kin && delta < 0) delta *= 0.5;
  r.opinion = clamp(r.opinion + delta, -100, 100);
  const other = rel(b, a).opinion;
  if (kin) {
    if (before > RIVAL && r.opinion <= RIVAL) {
      sim.log(`${first(a)} has fallen out with their ${kin} ${first(b)}`, 'family', 'bad', a, b);
      addMemory(sim, a, 'newRival', b);
      think(sim, a, `Family or not, ${first(b)} and I aren't speaking.`, 'bad');
    } else if (before <= RIVAL && r.opinion > RIVAL) {
      sim.log(`${first(a)} made up with their ${kin} ${first(b)}`, 'family', 'good', a, b);
      think(sim, a, `Things are better with ${first(b)} again. Family is family.`, 'good');
    }
  } else if (before < FRIEND && r.opinion >= FRIEND && other >= FRIEND) {
    sim.log(`${first(a)} and ${first(b)} are friends now`, 'social', 'good', a, b);
    addMemory(sim, a, 'newFriend', b);
    think(sim, a, `${first(b)} is actually great. Glad we clicked.`, 'good');
  } else if (before > RIVAL && r.opinion <= RIVAL) {
    sim.log(`${first(a)} can't stand ${first(b)} anymore`, 'social', 'bad', a, b);
    addMemory(sim, a, 'newRival', b);
    think(sim, a, `Everything ${first(b)} does annoys me.`, 'bad');
  }
}

export function socialGain(a: Agent, base: number): number {
  if (a.traits.includes('extrovert')) return base * 1.3;
  if (a.traits.includes('introvert')) return base * 0.75;
  return base;
}

const TOPICS = ['the weekend', 'that new café drink', 'the sprint', 'a podcast', 'the weather', 'their cat', 'a TV show', 'office plants', 'the ping pong ladder', 'lunch spots'];

/** Resolves a conversation. Returns what happened for the activity feed. */
export function converse(sim: Sim, a: Agent, b: Agent): 'chat' | 'argument' {
  const rng = sim.rng;
  const ra = rel(a, b);
  const rb = rel(b, a);
  const comp = compatibility(a, b);
  const avg = (ra.opinion + rb.opinion) / 2;
  let pArg = 0.12 - comp * 0.35 - avg / 300;
  if (a.traits.includes('grumpy') || b.traits.includes('grumpy')) pArg += 0.1;
  pArg += Math.max(0, 40 - Math.min(a.mood, b.mood)) / 220;
  pArg = clamp(pArg, 0.03, 0.6);
  ra.familiarity = Math.min(100, ra.familiarity + 6);
  rb.familiarity = Math.min(100, rb.familiarity + 6);
  ra.lastTalk = rb.lastTalk = sim.time;
  const topic = rng.pick(TOPICS);
  exposure(sim, a, b);
  exposure(sim, b, a);
  if (rng.chance(pArg)) {
    shiftOpinion(sim, a, b, -rng.range(4, 10));
    shiftOpinion(sim, b, a, -rng.range(4, 10));
    a.needs.social = Math.min(100, a.needs.social + socialGain(a, 8));
    b.needs.social = Math.min(100, b.needs.social + socialGain(b, 8));
    addMemory(sim, a, 'argument', b);
    addMemory(sim, b, 'argument', a);
    say(sim, a, '!', 'bad');
    say(sim, b, '?!', 'bad');
    think(sim, a, `${first(b)} and I got into it about ${topic}.`, 'bad');
    think(sim, b, `${first(a)} picked a fight about ${topic}. Ugh.`, 'bad');
    sim.log(`${first(a)} and ${first(b)} argued about ${topic}`, 'social', 'bad', a, b);
    return 'argument';
  }
  const gain = rng.range(3, 7) * (1 + comp);
  shiftOpinion(sim, a, b, gain);
  shiftOpinion(sim, b, a, gain * rng.range(0.7, 1.2));
  a.needs.social = Math.min(100, a.needs.social + socialGain(a, 30));
  b.needs.social = Math.min(100, b.needs.social + socialGain(b, 30));
  a.needs.fun = Math.min(100, a.needs.fun + 6);
  b.needs.fun = Math.min(100, b.needs.fun + 6);
  addMemory(sim, a, 'goodChat', b);
  addMemory(sim, b, 'goodChat', a);
  say(sim, a, rng.pick(['ha!', '♪', 'right?', 'oh nice']), 'good');
  say(sim, b, rng.pick(['haha', 'totally', 'no way!', '♥']), 'good');
  think(sim, a, `Fun chat with ${first(b)} about ${topic}.`, 'good');
  sim.log(`${first(a)} chatted with ${first(b)} about ${topic}`, 'social', 'good', a, b);
  return 'chat';
}

/** Passive bonding while doing something side by side (eating, playing, meetings). */
export function bondNearby(sim: Sim, a: Agent, b: Agent, dt: number): void {
  const r = rel(a, b);
  r.familiarity = Math.min(100, r.familiarity + 0.04 * dt);
  if (!sim.rng.chance(0.008 * dt)) return;
  exposure(sim, a, b, 0.3);
  const lean = compatibility(a, b) + r.opinion / 150 + sim.rng.range(-0.3, 0.3);
  shiftOpinion(sim, a, b, lean >= -0.05 ? 1 : -1.5);
}
