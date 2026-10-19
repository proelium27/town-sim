import { ageOf } from './agents';
import { ADULT_AGE, MIN_PER_DAY, PRIORITY_LABEL, type PriorityKey, SEASON_DAYS, YEAR_DAYS } from './defs';
import { foodBalance } from './economy';
import { addMemory, first, kinship, say, shiftOpinion, think } from './social';
import type { Sim } from './sim';
import type { Agent } from './types';

/** How much the mayor's agenda leans the town meetings, on top of the player's priorities. */
export const AGENDA_WEIGHT = 1.25;
/** Elections fall on the first day of summer: the campaign opens at 9, the rally is at 17, the vote at 20. */
const ELECTION_DAY = SEASON_DAYS;

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

/** What someone wants from the town, most pressing first, from where they stand. */
export function concernsOf(sim: Sim, a: Agent): PriorityKey[] {
  const pop = Math.max(1, sim.agents.length);
  const hh = sim.town.households[a.household];
  const beds = sim.map.props.filter((p) => p.use === 'sleep' && p.household === a.household).length;
  const crowded = hh.building < 0 || sim.agents.filter((o) => o.household === a.household).length > beds;
  const homeless = sim.agents.filter((o) => sim.town.households[o.household].building < 0).length;
  const fb = foodBalance(sim, true);
  const mem = (k: string) => a.memories.some((m) => m.kind === k);
  const score: Record<PriorityKey, number> = {
    housing: (crowded ? 2 : 0) + (homeless / pop) * 5,
    food: (mem('broke') || mem('starving') ? 2 : 0) + (sim.stock.food < pop * 4 ? 1 : 0) + (fb.produce < fb.eat ? 0.8 : 0) + (a.role === 'farmer' ? 0.5 : 0),
    materials: (mem('coldHome') ? 1.5 : 0) + (sim.stock.wood < 60 || sim.stock.stone < 40 ? 0.8 : 0) + (['builder', 'woodcutter', 'carpenter', 'mason'].includes(a.role) ? 0.7 : 0),
    community: 0.3 + (a.needs.fun < 50 ? 0.8 : 0) + (a.traits.includes('extrovert') || a.traits.includes('creative') ? 0.4 : 0) + (a.children.length ? 0.3 : 0),
  };
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
  if (cur.stage === 'campaign' && h >= 17) {
    cur.stage = 'rally';
    cur.rallyUntil = sim.time + 120;
    sim.log(`The election rally is on in the park: ${cur.candidates.map((c) => first(sim.agent(c.id)!)).join(', ')} make their case`, 'event', 'neutral');
  }
  if (cur.stage === 'rally' && sim.time >= cur.rallyUntil) vote(sim, cur);
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
  // Each runs on what matters most to them that nobody else is already running on.
  const taken = new Set<PriorityKey>();
  const candidates = field.map((a) => {
    const platform = concernsOf(sim, a).find((k) => !taken.has(k)) ?? concernOf(sim, a);
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

/** Each adult backs the candidate they like best, weighed by whether the platform speaks to them. */
function vote(sim: Sim, e: ElectionState): void {
  const tally = new Map<number, number>(e.candidates.map((c) => [c.id, 0]));
  const backed = new Map<number, number>();
  // The rally moves a few hearts.
  for (const id of e.attendees) {
    const a = sim.agent(id);
    if (!a) continue;
    for (const c of e.candidates) if (c.id !== id) shiftOpinion(sim, a, sim.agent(c.id)!, sim.rng.range(-2, 4));
  }
  for (const v of sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE)) {
    const want = concernOf(sim, v);
    let best = e.candidates[0];
    let bestScore = -Infinity;
    for (const c of e.candidates) {
      const cand = sim.agent(c.id);
      if (!cand) continue;
      const s = c.id === v.id ? 9 : (v.relations.get(c.id)?.opinion ?? 0) / 100 + (c.platform === want ? 0.4 : 0) + (kinship(sim, v, cand) ? 0.3 : 0) + sim.rng.range(0, 0.1);
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
  for (const c of e.candidates) if (c.id !== winnerId) addMemory(sim, sim.agent(c.id)!, 'lostElection');
  for (const [voter, cand] of backed) if (cand === winnerId && voter !== winnerId) addMemory(sim, sim.agent(voter)!, 'myCandidateWon');
  const others = votes.slice(1).map(([id, n]) => `${first(sim.agent(id)!)} ${n}`).join(', ');
  sim.log(`${winner.name} ${was === winnerId ? 'was re-elected' : 'was elected'} mayor with ${votes[0][1]} votes (${others}), promising ${PITCH[platform]}`, 'event', 'good', winner);
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

export const ELECTION_TIME = { day: ELECTION_DAY, minutes: ELECTION_DAY * MIN_PER_DAY };
