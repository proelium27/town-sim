import { ageOf } from './agents';
import { ADULT_AGE, MIN_PER_DAY, type PriorityKey, ROLES, SEASON_DAYS } from './defs';
import { startFestival } from './events';
import { ownedBy } from './business';
import { Rng } from './rng';
import { addMemory, first, kinship, say, think } from './social';
import type { Sim } from './sim';
import { type Agent, HEADLINE, NOTABLE } from './types';

/**
 * A mayor with real power. On taking office they set the town's policies from their platform and their nature (tax,
 * festivals, the workers' bonus, a cap on private prices), each a lever on the economy or the calendar. Everyone keeps
 * an approval of the mayor, from how those policies land on them, how they're doing, and how they feel about the
 * mayor personally. Two days of a sour town and people protest outside the town hall; the mayor may climb down, or a
 * petition can force a recall vote that evening. A year on, the town judges whether the platform was delivered.
 * The player's priorities stay the town meetings' weighting: policies are the mayor's own levers.
 */

export type Tax = 'low' | 'normal' | 'high';
export type Festivals = 'cancelled' | 'normal' | 'twice';
export type Bonus = 'thrifty' | 'normal' | 'generous';
export interface Policies {
  tax: Tax;
  festivals: Festivals;
  bonus: Bonus;
  priceCap: boolean;
}
export type PolicyKey = keyof Policies;

export const DEFAULT_POLICIES: Policies = { tax: 'normal', festivals: 'normal', bonus: 'normal', priceCap: false };
export const TAX_RATE: Record<Tax, number> = { low: 0.1, normal: 0.15, high: 0.22 };
export const BONUS_RATE: Record<Bonus, number> = { thrifty: 0.3, normal: 0.5, generous: 0.7 };
/** What the extra festival costs the treasury. */
export const FETE_COST = 40;

/** Town approval below this for two days running brings people out to protest. */
export const PROTEST_BELOW = 42;
/** A protest this share of grown-ups attend opens a petition. */
const PETITION_TURNOUT = 0.25;
const PROTEST_HOUR = 17.5;
const PROTEST_LENGTH = 90;
const RECALL_HOUR = 19.5;

export interface Protest {
  at: number;
  until: number;
  grievance: PolicyKey | 'homes' | 'food' | 'mayor';
  attendees: Set<number>;
  /** Started: people can come. */
  on: boolean;
}

export interface Promise {
  mayor: number;
  platform: PriorityKey;
  since: number;
  baseline: number;
  /** Set when the town judged it, at the next election. */
  kept?: boolean;
}

export interface Civic {
  policies: Policies;
  /** Each grown-up's approval of the mayor, 0..100. */
  approval: Map<number, number>;
  /** Town approval at each midnight, newest last (a week's worth). */
  history: number[];
  lowDays: number;
  protest: Protest | null;
  lastProtest: number;
  /** A recall vote due at this time, if one has been forced. */
  recallAt: number | null;
  promise: Promise | null;
  /** The season the mayor last changed a policy, so it's one change a season. */
  changedSeason: number;
  festivalsHeld: number;
  lastDay: number;
  /** The day of the last extra fête. */
  feteDay?: number;
}

export function freshCivic(): Civic {
  return { policies: { ...DEFAULT_POLICIES }, approval: new Map(), history: [], lowDays: 0, protest: null, lastProtest: -Infinity, recallAt: null, promise: null, changedSeason: -1, festivalsHeld: 0, lastDay: -1 };
}

const seasonIndex = (sim: Sim) => Math.floor(sim.time / (SEASON_DAYS * MIN_PER_DAY));
const mayorOf = (sim: Sim) => sim.agent(sim.mayor ?? undefined);
const grownUps = (sim: Sim) => sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE);

export const taxRate = (sim: Sim) => TAX_RATE[sim.civic.policies.tax];
export const bonusShare = (sim: Sim) => BONUS_RATE[sim.civic.policies.bonus];

/** How a policy reads in the Town view. */
export function policyText(p: Policies): string[] {
  return [
    `Tax ${Math.round(TAX_RATE[p.tax] * 100)}%`,
    p.festivals === 'cancelled' ? 'Festivals cancelled' : p.festivals === 'twice' ? 'A festival twice a season' : 'A festival every season',
    p.bonus === 'generous' ? 'Generous bonuses for town workers' : p.bonus === 'thrifty' ? 'Thrifty bonuses for town workers' : 'Standard bonuses for town workers',
    ...(p.priceCap ? ['Shop prices capped'] : []),
  ];
}

// ---------------------------------------------------------------- taking office

/** The new mayor's policies: one from what they ran on, the rest from who they are. */
export function takeOffice(sim: Sim, mayor: Agent, platform: PriorityKey, reelected: boolean): void {
  const c = sim.civic;
  const was = { ...c.policies };
  if (!reelected) {
    const p: Policies = { ...DEFAULT_POLICIES };
    if (platform === 'materials') p.tax = 'high';
    if (platform === 'food') p.priceCap = true;
    if (platform === 'community') {
      p.festivals = 'twice';
      p.bonus = 'generous';
    }
    if (platform === 'housing') p.bonus = 'thrifty';
    // Their own nature: the well-off and the competitive cut taxes, the grumpy cut the fun.
    if (p.tax === 'normal' && (mayor.traits.includes('competitive') || mayor.money > 600)) p.tax = 'low';
    if (p.festivals === 'normal' && mayor.traits.includes('extrovert')) p.festivals = 'twice';
    if (p.festivals === 'normal' && (mayor.traits.includes('grumpy') || mayor.traits.includes('workaholic'))) p.festivals = 'cancelled';
    c.policies = p;
  }
  c.promise = { mayor: mayor.id, platform, since: sim.time, baseline: measure(sim, platform) };
  c.lowDays = 0;
  c.changedSeason = seasonIndex(sim);
  for (const a of grownUps(sim)) c.approval.set(a.id, Math.max(c.approval.get(a.id) ?? 55, 55));
  const changed = (Object.keys(c.policies) as PolicyKey[]).filter((k) => c.policies[k] !== was[k]);
  if (changed.length) sim.log(`Mayor ${first(mayor)} sets out their policies: ${policyText(c.policies).join(', ')}`, 'event', 'neutral', mayor).weight = NOTABLE;
}

/** The number a platform is judged by, a year on. */
function measure(sim: Sim, platform: PriorityKey): number {
  if (platform === 'housing') return sim.map.buildings.filter((b) => b.kind === 'house').length;
  if (platform === 'food') return sim.stock.food / Math.max(1, sim.agents.length);
  if (platform === 'materials') return sim.stock.wood + sim.stock.stone;
  // Festivals, and the parks, schools and libraries built for the town to share.
  return sim.civic.festivalsHeld + sim.map.buildings.filter((b) => b.kind === 'park' || b.kind === 'school' || b.kind === 'library').length * 2;
}

const PROMISED: Record<PriorityKey, string> = { housing: 'more homes', food: 'full stores', materials: 'timber and stone to build with', community: 'festivals and a livelier town' };

/** At the next election: did the sitting mayor deliver? Voters weigh the answer. */
export function judgePromise(sim: Sim): void {
  const pr = sim.civic.promise;
  if (!pr || pr.kept !== undefined || pr.mayor !== sim.mayor) return;
  const mayor = sim.agent(pr.mayor);
  if (!mayor) return;
  const now = measure(sim, pr.platform);
  const kept =
    pr.platform === 'housing' ? now - pr.baseline >= 3
      : pr.platform === 'food' ? now >= Math.max(4, pr.baseline * 0.9)
        : pr.platform === 'materials' ? now >= pr.baseline * 1.3
          : now - pr.baseline >= 8;
  pr.kept = kept;
  const how =
    pr.platform === 'housing' ? `${now - pr.baseline} built`
      : pr.platform === 'food' ? `${Math.round(now)} days of food in store`
        : pr.platform === 'materials' ? `${Math.round(now)} wood and stone in store`
          : `${now - pr.baseline} festivals and new places to gather`;
  sim.log(`A year on: Mayor ${first(mayor)} promised ${PROMISED[pr.platform]} (${how}). ${kept ? 'Promise kept.' : 'Promise broken.'}`, 'event', kept ? 'good' : 'bad', mayor).weight = HEADLINE;
}

/** Vote score for the sitting mayor from their record: kept promises win votes, broken ones lose them (a nudge: at
 * 0.25 most re-elections became landslides). */
export function recordPull(sim: Sim, candidate: number): number {
  const pr = sim.civic.promise;
  if (!pr || pr.mayor !== candidate || pr.kept === undefined) return 0;
  return pr.kept ? 0.12 : -0.12;
}

// ---------------------------------------------------------------- approval

/** How the mayor's policies and the times land on one grown-up, as a raw approval 0..100. */
export function approvalOf(sim: Sim, a: Agent): number {
  const mayor = mayorOf(sim);
  if (!mayor) return 50;
  if (mayor.id === a.id) return 90;
  const p = sim.civic.policies;
  const office = ROLES[a.role].workplace === 'office';
  const owner = !!ownedBy(sim, a);
  const townPaid = !office && !owner && a.role !== 'retired';
  const outgoing = a.traits.includes('extrovert') || a.traits.includes('creative');
  let v = 45 + Math.max(-50, Math.min(50, a.relations.get(mayor.id)?.opinion ?? 0)) * 0.45;
  if (kinship(sim, a, mayor)) v += 12;
  if (p.tax === 'high') v += office || owner ? -14 : townPaid ? 3 : -4;
  if (p.tax === 'low') v += office || owner ? 6 : sim.treasury < 200 && townPaid ? -6 : 0;
  if (p.festivals === 'cancelled') v -= outgoing ? 18 : 10;
  if (p.festivals === 'twice') v += outgoing ? 6 : 2;
  if (p.bonus === 'generous') v += townPaid ? 6 : 0;
  if (p.bonus === 'thrifty') v -= townPaid ? 8 : 0;
  if (p.priceCap) v += owner ? -16 : a.money < 40 ? 6 : 1;
  // The times: a roof, a meal, a wage paid.
  if (sim.town.households[a.household].building < 0) v -= sim.agenda === 'housing' ? 22 : 12;
  if (a.needs.hunger < 25 || sim.stock.food < sim.agents.length * 2) v -= sim.agenda === 'food' ? 14 : 8;
  if (a.memories.some((m) => m.kind === 'unpaid')) v -= 10;
  v += (a.mood - 65) * 0.3;
  return Math.max(0, Math.min(100, v));
}

/** The town's approval of its mayor: the grown-ups' average, mayor aside. */
export function townApproval(sim: Sim): number {
  const vals = grownUps(sim).filter((a) => a.id !== sim.mayor).map((a) => sim.civic.approval.get(a.id) ?? 50);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 50;
}

/** "Most people back Mayor Elio (62%, rising)". */
export function approvalLine(sim: Sim): string | null {
  const mayor = mayorOf(sim);
  if (!mayor) return null;
  const v = townApproval(sim);
  const h = sim.civic.history;
  const before = h.length >= 3 ? h[h.length - 3] : undefined;
  const trend = before === undefined ? '' : v - before > 4 ? ', rising' : before - v > 4 ? ', falling' : ', steady';
  const who = `Mayor ${first(mayor)}`;
  const word = v >= 65 ? `Most people back ${who}` : v >= 52 ? `The town is warm to ${who}` : v >= PROTEST_BELOW ? `Opinion is split on ${who}` : v >= 28 ? `${who} is unpopular` : `The town has turned against ${who}`;
  return `${word} (${Math.round(v)}%${trend})`;
}

/** What people are unhappiest about: the policy that costs the mayor most, or the times. */
function grievance(sim: Sim): Protest['grievance'] {
  const p = sim.civic.policies;
  const unhappy = grownUps(sim).filter((a) => (sim.civic.approval.get(a.id) ?? 50) < 45);
  const homeless = unhappy.filter((a) => sim.town.households[a.household].building < 0).length;
  const scores: [Protest['grievance'], number][] = [
    ['tax', p.tax === 'high' ? unhappy.filter((a) => ROLES[a.role].workplace === 'office' || ownedBy(sim, a)).length * 1.2 : 0],
    ['festivals', p.festivals === 'cancelled' ? unhappy.length * 0.6 : 0],
    ['bonus', p.bonus === 'thrifty' ? unhappy.filter((a) => ROLES[a.role].workplace !== 'office').length * 0.7 : 0],
    ['priceCap', p.priceCap ? unhappy.filter((a) => ownedBy(sim, a)).length * 2 : 0],
    ['homes', homeless * 1.5],
    ['food', sim.stock.food < sim.agents.length * 2 ? unhappy.length * 0.8 : 0],
  ];
  const [best, n] = scores.sort((x, y) => y[1] - x[1])[0];
  return n > 0 ? best : 'mayor';
}

export const SLOGANS: Record<Protest['grievance'], string[]> = {
  tax: ['lower taxes!', 'our money!', 'tax 15!'],
  festivals: ['bring back the fair!', 'we want music!', 'let us dance!'],
  bonus: ['pay the workers!', 'fair bonuses!'],
  priceCap: ['let shops set prices!', 'free trade!'],
  homes: ['homes now!', 'roofs not promises!'],
  food: ['feed the town!', 'bread not speeches!'],
  mayor: ['recall!', 'time for a change!'],
};

const GRIEVANCE_TEXT: Record<Protest['grievance'], string> = {
  tax: 'the high tax', festivals: 'the cancelled festivals', bonus: 'the thrifty bonuses', priceCap: 'the cap on shop prices',
  homes: 'people without homes', food: 'empty stores', mayor: 'the mayor',
};

// ---------------------------------------------------------------- the day

/** Each step: midnight approval, festivals by policy, protests and what comes of them, recall votes. */
export function tickCivic(sim: Sim): void {
  const c = sim.civic;
  if (c.lastDay !== sim.day) {
    c.lastDay = sim.day;
    dailyApproval(sim);
  }
  festivalPolicy(sim);
  const pr = c.protest;
  if (pr && !pr.on && sim.time >= pr.at) {
    pr.on = true;
    sim.log(`The protest is on outside ${hallName(sim)}: "${SLOGANS[pr.grievance][0]}"`, 'event', 'bad').weight = NOTABLE;
  }
  if (pr && pr.on && sim.time >= pr.until) endProtest(sim, pr);
  if (c.recallAt !== null && sim.time >= c.recallAt) recallVote(sim);
}

function dailyApproval(sim: Sim): void {
  const c = sim.civic;
  const mayor = mayorOf(sim);
  for (const a of grownUps(sim)) c.approval.set(a.id, 0.6 * (c.approval.get(a.id) ?? 55) + 0.4 * approvalOf(sim, a));
  for (const id of [...c.approval.keys()]) if (!sim.agent(id)) c.approval.delete(id);
  if (!mayor) {
    c.lowDays = 0;
    return;
  }
  const v = townApproval(sim);
  c.history = [...c.history, v].slice(-8);
  c.lowDays = v < PROTEST_BELOW ? c.lowDays + 1 : 0;
  // A mayor can change one policy a season: an unpopular one goes first, unprompted, if they're losing the town.
  if (v < 46 && c.changedSeason !== seasonIndex(sim)) {
    const g = grievance(sim);
    if (g !== 'homes' && g !== 'food' && g !== 'mayor' && c.policies[g] !== DEFAULT_POLICIES[g] && new Rng(sim.seed * 31 + sim.day).chance(0.3)) climbDown(sim, mayor, g, 'quietly');
  }
  if (c.lowDays >= 2 && !c.protest && c.recallAt === null && sim.time - c.lastProtest > 3 * MIN_PER_DAY) callProtest(sim);
}

/** A protest for this evening (or tomorrow's, if it's late). */
export function callProtest(sim: Sim): Protest | null {
  const mayor = mayorOf(sim);
  if (!mayor) return null;
  const c = sim.civic;
  const day = sim.hour < PROTEST_HOUR - 1 ? sim.day : sim.day + 1;
  const at = day * MIN_PER_DAY + PROTEST_HOUR * 60;
  const g = grievance(sim);
  c.protest = { at, until: at + PROTEST_LENGTH, grievance: g, attendees: new Set(), on: false };
  c.lastProtest = at;
  sim.log(`Unhappy with Mayor ${first(mayor)} over ${GRIEVANCE_TEXT[g]}, people are planning a protest outside ${hallName(sim)} at ${PROTEST_HOUR === 17.5 ? '17:30' : ''}`, 'event', 'bad', mayor).weight = HEADLINE;
  return c.protest;
}

/** Where protests gather: the town hall if there is one, else the park. */
export function hallName(sim: Sim): string {
  const hall = sim.map.buildings.find((b) => b.kind === 'townhall');
  return hall ? `the ${hall.name}` : 'the park';
}

/** The protest disperses: enough people and the mayor climbs down, or a petition goes round. */
function endProtest(sim: Sim, pr: Protest): void {
  const c = sim.civic;
  c.protest = null;
  const mayor = mayorOf(sim);
  const adults = grownUps(sim).filter((a) => a.id !== sim.mayor);
  const turnout = [...pr.attendees].filter((id) => sim.agent(id)).length;
  for (const id of pr.attendees) {
    const a = sim.agent(id);
    if (a) addMemory(sim, a, 'protested');
  }
  if (!mayor) return;
  if (turnout < Math.max(2, adults.length * PETITION_TURNOUT)) {
    sim.log(`Only ${turnout} turned out to protest; Mayor ${first(mayor)} carries on`, 'event', 'neutral', mayor).weight = NOTABLE;
    return;
  }
  // A big crowd: the mayor may give ground on what brought them out.
  const g = pr.grievance;
  const stubborn = mayor.traits.includes('competitive') || mayor.traits.includes('grumpy');
  const canGive = g !== 'homes' && g !== 'food' && g !== 'mayor' && c.policies[g] !== DEFAULT_POLICIES[g];
  if (canGive && new Rng(sim.seed * 53 + sim.day).chance(stubborn ? 0.3 : 0.6)) {
    climbDown(sim, mayor, g, `after ${turnout} people protested`);
    for (const id of pr.attendees) c.approval.set(id, Math.min(100, (c.approval.get(id) ?? 50) + 10));
    return;
  }
  // Otherwise a petition: everyone unhappy signs; a majority forces a recall vote tonight.
  const signed = adults.filter((a) => (c.approval.get(a.id) ?? 50) < 45).length;
  if (signed > adults.length / 2) {
    c.recallAt = sim.day * MIN_PER_DAY + RECALL_HOUR * 60;
    if (c.recallAt <= sim.time) c.recallAt = sim.time + 60;
    sim.log(`A petition to recall Mayor ${first(mayor)} has ${signed} of ${adults.length} signatures: a recall vote tonight`, 'event', 'bad', mayor).weight = HEADLINE;
  } else {
    sim.log(`The petition to recall Mayor ${first(mayor)} fell short: ${signed} of ${adults.length} signed`, 'event', 'neutral', mayor).weight = NOTABLE;
  }
}

function climbDown(sim: Sim, mayor: Agent, g: PolicyKey, why: string): void {
  const c = sim.civic;
  (c.policies as unknown as Record<PolicyKey, unknown>)[g] = DEFAULT_POLICIES[g];
  c.changedSeason = seasonIndex(sim);
  const now = { tax: `tax back to ${Math.round(TAX_RATE.normal * 100)}%`, festivals: 'the festivals are back on', bonus: 'bonuses back to normal', priceCap: 'shops may set their own prices again' }[g];
  think(sim, mayor, 'Fine. They made their point.', 'neutral');
  sim.log(`Mayor ${first(mayor)} climbed down ${why}: ${now}`, 'event', 'good', mayor).weight = HEADLINE;
}

/** Everyone votes: the unhappy to recall. A majority removes the mayor and calls a new election tomorrow. */
export function recallVote(sim: Sim): boolean {
  const c = sim.civic;
  c.recallAt = null;
  const mayor = mayorOf(sim);
  if (!mayor) return false;
  const dice = new Rng(sim.seed * 97 + sim.day);
  const adults = grownUps(sim).filter((a) => a.id !== mayor.id);
  const yes = adults.filter((a) => (c.approval.get(a.id) ?? 50) + dice.range(-6, 6) < 50).length;
  const no = adults.length - yes + 1;
  if (yes > no) {
    sim.mayor = null;
    sim.mayorTerms = 0;
    sim.recalled = mayor.id;
    sim.snapElection = sim.day + 1;
    addMemory(sim, mayor, 'recalled');
    think(sim, mayor, 'Recalled. After everything I did for this town.', 'bad');
    say(sim, mayor, '...', 'bad', 6);
    sim.log(`Mayor ${first(mayor)} was recalled, ${yes} votes to ${no}. A new election tomorrow`, 'event', 'bad', mayor).weight = HEADLINE;
    sim.milestone(`${mayor.name} was recalled`);
    return true;
  }
  for (const a of adults) c.approval.set(a.id, Math.min(100, (c.approval.get(a.id) ?? 50) + 6));
  sim.log(`The recall vote failed, ${yes} to ${no}. Mayor ${first(mayor)} stays`, 'event', 'neutral', mayor).weight = HEADLINE;
  return false;
}

/** Festivals by policy: a cancelled season's fair, or an extra fête on the season's first evening. */
function festivalPolicy(sim: Sim): void {
  const c = sim.civic;
  const ev = sim.events;
  if (c.policies.festivals === 'cancelled' && ev.seasonal && sim.time >= ev.seasonal.at - 60 && mayorOf(sim)) {
    sim.log(`No ${ev.seasonal.name.toLowerCase()} this season: Mayor ${first(mayorOf(sim)!)} cancelled it`, 'event', 'bad').weight = NOTABLE;
    ev.seasonal = null;
  }
  const dayInSeason = sim.day % SEASON_DAYS;
  // Not over an evening that's already spoken for (an office party, a wedding, a funeral).
  const busy = !!ev.party || ev.plan.some((e) => e.kind === 'party') || ev.weddings.length > 0 || ev.funerals.length > 0;
  if (c.policies.festivals === 'twice' && dayInSeason === 0 && sim.hour >= 17 && sim.hour < 17.5 && !ev.festival && !busy && c.feteDay !== sim.day && !ev.snowstorm && sim.treasury >= FETE_COST && mayorOf(sim)) {
    c.feteDay = sim.day;
    sim.treasury -= FETE_COST;
    sim.ledger.projects += FETE_COST;
    startFestival(sim, "Mayor's fête");
    sim.log(`Mayor ${first(mayorOf(sim)!)}'s fête in the park tonight, paid for by the town`, 'event', 'good').weight = NOTABLE;
  }
}

/** Where protesters stand: the street in front of the town hall's door, or the park. */
export function protestArea(sim: Sim): { x: number; y: number; w: number; h: number } {
  const hall = sim.map.buildings.find((b) => b.kind === 'townhall');
  if (!hall) return { x: 45, y: 2, w: 18, h: 20 };
  const below = hall.door.y >= hall.y + hall.h - 1;
  return { x: hall.door.x - 3, y: below ? hall.door.y + 1 : hall.door.y - 4, w: 7, h: 4 };
}

/** Counted for the community promise. */
export function festivalHeld(sim: Sim): void {
  sim.civic.festivalsHeld++;
}
