import { ageOf } from './agents';
import { ADULT_AGE, ELECTION_DAY, plural, PRIORITY_LABEL, type PriorityKey, RALLY_HOUR, RALLY_LENGTH, type TraitKey, YEAR_DAYS } from './defs';
import { foodBalance } from './economy';
import { addMemory, first, kinship, say, shiftOpinion, think } from './social';
import type { Sim } from './sim';
import type { Agent } from './types';

/** How much the mayor's agenda leans the town meetings, on top of the player's priorities. */
export const AGENDA_WEIGHT = 1.25;

export interface Candidate {
  id: number;
  platform: PriorityKey;
}

export interface ElectionState {
  year: number;
  candidates: Candidate[];
  stage: 'campaign' | 'rally' | 'done';
  rallyUntil: number;
  attendees: Set<number>;
}

export interface ElectionResult {
  year: number;
  winner: number;
  platform: PriorityKey;
  votes: [number, number][];
}

const FOOD_ROLES = ['farmer', 'cook'];
const TRADE_ROLES = ['builder', 'woodcutter', 'carpenter', 'mason', 'laborer', 'toolmaker'];
const CIVIC_ROLES = ['teacher', 'librarian', 'barista', 'doctor'];
/** The cause each temperament leans toward. */
const TRAIT_CONCERN: Partial<Record<TraitKey, PriorityKey>> = {
  extrovert: 'community', creative: 'community', slacker: 'community',
  foodie: 'food', earlyBird: 'food',
  workaholic: 'materials', competitive: 'materials',
  introvert: 'housing', neatFreak: 'housing', grumpy: 'housing',
};

/**
 * What someone wants from the town, most pressing first, from where they stand.
 * Their own home, trade, family and hardships weigh more than the town's stores, so neighbours don't all want the same thing.
 */
export function concernsOf(sim: Sim, a: Agent): PriorityKey[] {
  const pop = Math.max(1, sim.agents.length);
  const hh = sim.town.households[a.household];
  const beds = sim.map.props.filter((p) => p.use === 'sleep' && p.household === a.household).length;
  const crowded = hh.building < 0 || sim.agents.filter((o) => o.household === a.household).length > beds;
  const homeless = sim.agents.filter((o) => sim.town.households[o.household].building < 0).length;
  const withParents = ageOf(sim, a) >= ADULT_AGE && a.parents.some((id) => sim.agent(id)?.household === a.household);
  const fb = foodBalance(sim, true);
  const mem = (k: string) => a.memories.some((m) => m.kind === k);
  const score: Record<PriorityKey, number> = {
    housing: (crowded ? 1.4 : 0) + (withParents ? 0.7 : 0) + (homeless / pop) * 1.5,
    food:
      (mem('broke') || mem('starving') ? 1.4 : 0) + (a.needs.hunger < 40 ? 0.4 : 0) + (FOOD_ROLES.includes(a.role) ? 0.8 : 0) +
      (sim.stock.food < pop * 4 ? 0.5 : 0) + (fb.produce < fb.eat ? 0.4 : 0),
    materials: (mem('coldHome') ? 1.2 : 0) + (TRADE_ROLES.includes(a.role) ? 0.8 : 0) + (sim.stock.wood < 60 || sim.stock.stone < 40 ? 0.4 : 0),
    community: 0.1 + (a.needs.fun < 40 ? 0.5 : 0) + (a.children.length ? 0.3 : 0) + (CIVIC_ROLES.includes(a.role) ? 0.6 : 0),
  };
  for (const t of a.traits) if (TRAIT_CONCERN[t]) score[TRAIT_CONCERN[t]] += 0.3;
  return (Object.keys(score) as PriorityKey[]).sort((x, y) => score[y] - score[x]);
}

export function concernOf(sim: Sim, a: Agent): PriorityKey {
  return concernsOf(sim, a)[0];
}

const PITCH: Record<PriorityKey, string> = {
  housing: 'a home for every family',
  food: 'full stores and full plates',
  materials: 'timber and stone to build with',
  community: 'parks, schools and festivals',
};

/** Election day: candidates step forward in the morning, rally in the park, and the town votes at night. */
export function tickPolitics(sim: Sim): void {
  const dayOfYear = sim.day % YEAR_DAYS;
  const h = sim.hour;
  const e = sim.election;
  if (dayOfYear === ELECTION_DAY && h >= 9 && (!e || e.year !== sim.year)) openCampaign(sim);
  const cur = sim.election;
  if (!cur || cur.year !== sim.year || cur.stage === 'done') return;
  if (!dropAbsent(sim, cur)) return;
  if (cur.stage === 'campaign' && h >= RALLY_HOUR) {
    cur.stage = 'rally';
    cur.rallyUntil = sim.time + RALLY_LENGTH;
    sim.log(`The election rally is on in the park: ${cur.candidates.map((c) => first(sim.agent(c.id)!)).join(', ')} make their case`, 'event', 'neutral');
  }
  if (cur.stage === 'rally' && sim.time >= cur.rallyUntil) vote(sim, cur);
}

/** Candidates who died or left town since morning drop out of the race; with nobody left it's called off. */
function dropAbsent(sim: Sim, e: ElectionState): boolean {
  const gone = e.candidates.filter((c) => !sim.agent(c.id));
  if (!gone.length) return true;
  e.candidates = e.candidates.filter((c) => sim.agent(c.id));
  for (const id of gone.map((c) => c.id)) e.attendees.delete(id);
  if (e.candidates.length) return true;
  e.stage = 'done';
  sim.log(`With no candidates left, this year's election is called off`, 'event', 'bad');
  return false;
}

function openCampaign(sim: Sim): void {
  const adults = sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE && a.role !== 'retired');
  if (adults.length < 4) return;
  // The well-liked and the persuasive stand; a sitting mayor stands again.
  const liked = (a: Agent) => sim.agents.reduce((s, o) => s + (o.relations.get(a.id)?.opinion ?? 0), 0) / sim.agents.length;
  const ranked = [...adults].sort((x, y) => y.skills.charisma.level * 6 + liked(y) + y.mood / 10 - (x.skills.charisma.level * 6 + liked(x) + x.mood / 10));
  const field = ranked.slice(0, 3);
  const incumbent = sim.agent(sim.mayor ?? undefined);
  if (incumbent && !field.includes(incumbent)) field[field.length - 1] = incumbent;
  // A sitting mayor picks first and runs on what matters most to them; the rest run on their own first or second
  // concern, whichever nobody has claimed yet, or share a platform rather than run on something they don't hold.
  const order = incumbent ? [incumbent, ...field.filter((a) => a !== incumbent)] : field;
  const taken = new Set<PriorityKey>();
  const candidates = order.map((a) => {
    const wants = concernsOf(sim, a);
    const platform = wants.slice(0, 2).find((k) => !taken.has(k)) ?? wants[0];
    taken.add(platform);
    return { id: a.id, platform };
  });
  sim.election = { year: sim.year, candidates, stage: 'campaign', rallyUntil: 0, attendees: new Set() };
  for (const c of candidates) {
    const a = sim.agent(c.id)!;
    think(sim, a, `I'm standing for mayor. This town needs ${PITCH[c.platform]}.`, 'good');
  }
  sim.log(`Election day! Standing for mayor: ${candidates.map((c) => `${first(sim.agent(c.id)!)} (${PRIORITY_LABEL[c.platform].toLowerCase()})`).join(', ')}. Rally at 17:00, votes at 19:00`, 'event', 'good');
}

/** Opinion points worth one unit of vote score: a candidate liked 10 points better is worth about a platform match. */
export const OPINION_SCALE = 25;
/** Vote score for a platform that matches the voter's first or second concern. */
export const PLATFORM_PULL = [0.3, 0.15];
const KIN_PULL = 0.3;

/** How much a voter warms to a candidate: how well they like them, whether the platform speaks to them, and family. */
export function voteScore(sim: Sim, v: Agent, c: Candidate, wants: PriorityKey[] = concernsOf(sim, v)): number {
  if (c.id === v.id) return 9;
  const cand = sim.agent(c.id);
  const rank = wants.indexOf(c.platform);
  return (v.relations.get(c.id)?.opinion ?? 0) / OPINION_SCALE + (PLATFORM_PULL[rank] ?? 0) + (cand && kinship(sim, v, cand) ? KIN_PULL : 0);
}

/** Each adult backs the candidate they like best, weighed by whether the platform speaks to them. */
function vote(sim: Sim, e: ElectionState): void {
  const tally = new Map<number, number>(e.candidates.map((c) => [c.id, 0]));
  const backed = new Map<number, number>();
  // The rally moves a few hearts.
  for (const id of e.attendees) {
    const a = sim.agent(id);
    if (!a) continue;
    for (const c of e.candidates) {
      const cand = sim.agent(c.id);
      if (cand && c.id !== id) shiftOpinion(sim, a, cand, sim.rng.range(-2, 4));
    }
  }
  for (const v of sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE)) {
    const wants = concernsOf(sim, v);
    let best = e.candidates[0];
    let bestScore = -Infinity;
    for (const c of e.candidates) {
      if (!sim.agent(c.id)) continue;
      const s = voteScore(sim, v, c, wants) + sim.rng.range(0, 0.15);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    tally.set(best.id, (tally.get(best.id) ?? 0) + 1);
    backed.set(v.id, best.id);
  }
  const votes = [...tally.entries()].sort((x, y) => y[1] - x[1]);
  const [winnerId] = votes[0];
  const winner = sim.agent(winnerId)!;
  const platform = e.candidates.find((c) => c.id === winnerId)!.platform;
  const was = sim.mayor;
  sim.mayor = winnerId;
  sim.agenda = platform;
  e.stage = 'done';
  sim.lastElection = { year: e.year, winner: winnerId, platform, votes };
  addMemory(sim, winner, 'wonElection');
  say(sim, winner, 'thank you, Northwind!', 'good', 8);
  for (const c of e.candidates) {
    const loser = sim.agent(c.id);
    if (loser && c.id !== winnerId) addMemory(sim, loser, 'lostElection');
  }
  for (const [voter, cand] of backed) if (cand === winnerId && voter !== winnerId) addMemory(sim, sim.agent(voter)!, 'myCandidateWon');
  const others = votes.slice(1).map(([id, n]) => `${first(sim.agent(id)!)} ${n}`).join(', ');
  sim.log(`${winner.name} ${was === winnerId ? 'was re-elected' : 'was elected'} mayor with ${plural(votes[0][1], 'vote')}${others ? ` (${others})` : ', unopposed'}, promising ${PITCH[platform]}`, 'event', 'good', winner);
  sim.milestone(`${winner.name} became mayor`);
}

/** The mayor's agenda leans meetings toward it, a little. */
export function agendaWeight(sim: Sim, k: PriorityKey): number {
  return sim.mayor !== null && sim.agent(sim.mayor) && sim.agenda === k ? AGENDA_WEIGHT : 1;
}

/** Day and year of the next election, for the Town view. */
export function nextElection(sim: Sim): { day: number; year: number } {
  const passed = sim.day % YEAR_DAYS > ELECTION_DAY || (sim.day % YEAR_DAYS === ELECTION_DAY && sim.election?.year === sim.year && sim.election.stage === 'done');
  return { day: ELECTION_DAY, year: sim.year + (passed ? 1 : 0) };
}
