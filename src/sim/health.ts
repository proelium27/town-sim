import { ageOf } from './agents';
import { MIN_PER_DAY } from './defs';
import { die } from './life';
import { chill } from './seasons';
import { addMemory, first, kinship, say, think } from './social';
import type { Sim } from './sim';
import type { Agent } from './types';

export type IllnessKind = 'cold' | 'flu' | 'injury';

export interface IllnessDef {
  label: string;
  /** Chance per close contact of passing it on, before season and frailty. */
  contagion: number;
  /** Worst it gets, 0..1. */
  peak: number;
  /** Days it lasts untreated. */
  days: number;
}

export const ILLNESS: Record<IllnessKind, IllnessDef> = {
  cold: { label: 'a cold', contagion: 0.08, peak: 0.45, days: 0.6 },
  flu: { label: 'the flu', contagion: 0.2, peak: 0.8, days: 1.1 },
  injury: { label: 'an injury', contagion: 0, peak: 0.6, days: 1 },
};

export interface Illness {
  kind: IllnessKind;
  severity: number;
  /** Minutes since it started. */
  age: number;
  /** Seen by the doctor at the clinic. */
  treated: boolean;
  /** Given medicine. */
  medicine: boolean;
  /** Someone in the family sat with them recently; recovery goes better until then. */
  caredUntil: number;
}

/** How worn down by age and past illness someone is, 0..1. Frailty is what old age kills with. */
export function frailty(sim: Sim, a: Agent): number {
  return Math.min(1, Math.max(0, (ageOf(sim, a) - 62) / 32) + a.wear);
}

export function isIll(a: Agent): boolean {
  return !!a.illness;
}

/** Ill enough to stay home from work or school. */
export function offSick(a: Agent): boolean {
  return !!a.illness && (a.illness.severity > 0.3 || a.illness.kind === 'injury');
}

export function fallIll(sim: Sim, a: Agent, kind: IllnessKind, how: string): void {
  if (a.illness || (kind !== 'injury' && sim.time < (a.immuneUntil ?? -Infinity))) return;
  a.illness = { kind, severity: 0.08, age: 0, treated: false, medicine: false, caredUntil: 0 };
  addMemory(sim, a, kind === 'injury' ? 'hurt' : 'feelingIll');
  think(sim, a, kind === 'injury' ? `Ow. ${how}.` : `I think I'm coming down with ${ILLNESS[kind].label}.`, 'bad');
  sim.log(`${first(a)} ${kind === 'injury' ? `got hurt (${how})` : `came down with ${ILLNESS[kind].label}${how ? ` (${how})` : ''}`}`, 'life', 'bad', a);
}

/** Close contact with someone sick: they might pass it on. */
export function exposure(sim: Sim, a: Agent, from: Agent, scale = 1): void {
  const ill = from.illness;
  if (!ill || a.illness || ill.kind === 'injury' || sim.time < (a.immuneUntil ?? -Infinity)) return;
  const def = ILLNESS[ill.kind];
  const winter = sim.season === 3 ? 1.6 : sim.season === 2 ? 1.2 : 1;
  const cold = a.needs.warmth < 40 ? 1.5 : 1;
  const p = def.contagion * winter * cold * (1 + frailty(sim, a)) * scale;
  if (sim.rng.chance(p)) fallIll(sim, a, ill.kind, `caught it from ${first(from)}`);
}

/** Per step: an illness runs its course, faster with rest, care, a doctor and medicine. */
export function tickIllness(sim: Sim, a: Agent, dt: number): void {
  const n = a.needs;
  const ill = a.illness;
  if (!ill) {
    n.health = Math.min(100, n.health + 2 * dt);
    return;
  }
  const def = ILLNESS[ill.kind];
  const span = def.days * MIN_PER_DAY;
  ill.age += dt;
  // Sharing a home with someone ill is how most colds and flus go round a family.
  if (def.contagion > 0) {
    const room = sim.map.room[a.at];
    if (room >= 0) for (const o of sim.agents) if (o.household === a.household && o.id !== a.id && sim.map.room[o.at] === room) exposure(sim, o, a, 0.004 * dt);
  }
  if (ill.age < span * 0.25) {
    ill.severity = Math.min(def.peak, ill.severity + (def.peak / (span * 0.25)) * dt);
  } else {
    const resting = a.action.kind === 'rest' && a.action.stage === 'perform';
    const k = (resting ? 1.6 : 1) * (sim.time < ill.caredUntil ? 1.3 : 1) * (ill.treated ? 2 : 1) * (ill.medicine ? 1.5 : 1);
    ill.severity -= (def.peak / (span * 0.75)) * k * dt;
  }
  n.health = 100 - Math.max(0, ill.severity) * 90;
  if (ill.age > span * 0.25 && ill.severity <= 0) {
    a.illness = undefined;
    if (ill.kind !== 'injury') a.immuneUntil = sim.time + 3 * MIN_PER_DAY;
    // Every illness takes a little out of the old.
    if (ageOf(sim, a) > 60) a.wear = Math.min(0.5, a.wear + 0.04);
    addMemory(sim, a, 'recovered');
    think(sim, a, ill.kind === 'injury' ? 'All healed up.' : 'Finally feeling like myself again.', 'good');
    say(sim, a, 'better!', 'good', 3);
  }
}

/**
 * Every couple of hours: chills turn into colds, and the frail and the very ill may pass away.
 * Frailty, not a birthday, is what ends a life.
 */
export function tickTownHealth(sim: Sim): void {
  const c = chill(sim);
  for (const a of [...sim.agents]) {
    if (!a.illness && c > 0 && (a.needs.warmth < 35 ? sim.rng.chance(0.08) : sim.season === 3 && sim.rng.chance(0.004))) {
      fallIll(sim, a, 'cold', a.needs.warmth < 35 ? 'caught a chill' : '');
    }
    const f = frailty(sim, a);
    const sev = a.illness?.severity ?? 0;
    const risk = f ** 3 * 0.06 + (sev > 0.6 ? f * sev * 0.08 : 0);
    if (risk > 0 && sim.rng.chance(risk)) {
      die(sim, a, a.illness && sev > 0.4 ? `${ILLNESS[a.illness.kind].label.replace(/^(a|the) /, '')}, at ${Math.floor(ageOf(sim, a))}` : `old age at ${Math.floor(ageOf(sim, a))}`);
    } else if (f > 0.75 && !a.memories.some((m) => m.kind === 'frail')) {
      addMemory(sim, a, 'frail');
      think(sim, a, "I'm not as strong as I was.", 'neutral');
      sim.log(`${first(a)} is growing frail; the family is visiting more`, 'family', 'neutral', a);
    }
  }
}

/** Who this person might go and look after: ill or frail family, most in need first. */
export function needsCare(sim: Sim, a: Agent): Agent | undefined {
  return sim.agents
    .filter((o) => o.id !== a.id && kinship(sim, a, o) && ((o.illness?.severity ?? 0) > 0.15 || frailty(sim, o) > 0.75))
    .filter((o) => !a.memories.some((m) => m.kind === 'lookedAfter' && m.about === o.id))
    .sort((x, y) => (y.illness?.severity ?? 0) + frailty(sim, y) - ((x.illness?.severity ?? 0) + frailty(sim, x)))[0];
}
