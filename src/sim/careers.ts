import { ageOf, freeStations, newTask, stationFor } from './agents';
import { openSlots } from './planner';
import { ADULT_AGE, MIN_PER_DAY, ROLES, type RoleKey, type TraitKey } from './defs';
import { addMemory, first, kinship, think } from './social';
import type { Sim } from './sim';
import { NOTABLE, type Agent } from './types';

export type Aptitude = 'hands' | 'numbers' | 'people' | 'outdoors';
export const APTITUDES: Aptitude[] = ['hands', 'numbers', 'people', 'outdoors'];
export const APT_LABEL: Record<Aptitude, string> = { hands: 'Hands-on', numbers: 'Numbers', people: 'People', outdoors: 'Outdoors' };

/** How well each aptitude suits each trade. */
export const FIT: Partial<Record<RoleKey, Partial<Record<Aptitude, number>>>> = {
  builder: { hands: 1, outdoors: 0.6 },
  farmer: { outdoors: 1, hands: 0.3 },
  woodcutter: { outdoors: 1, hands: 0.5 },
  carpenter: { hands: 1, numbers: 0.3 },
  mason: { hands: 1, outdoors: 0.3 },
  toolmaker: { hands: 0.8, numbers: 0.6 },
  teacher: { people: 1, numbers: 0.6 },
  doctor: { people: 0.7, numbers: 0.8 },
  cook: { people: 0.6, hands: 0.6 },
  engineer: { numbers: 1 },
  designer: { hands: 0.5, people: 0.4, numbers: 0.3 },
  writer: { people: 0.7, numbers: 0.4 },
};

const TRAIT_BENT: Partial<Record<TraitKey, Aptitude>> = { creative: 'hands', introvert: 'numbers', extrovert: 'people', competitive: 'outdoors', workaholic: 'numbers' };

/** An apprenticeship lasts two days. */
export const APPRENTICESHIP = 2 * MIN_PER_DAY;

/** A newborn's leanings: a little from their traits and a little from what their parents do. */
export function startingAptitude(sim: Sim, traits: TraitKey[], parents: Agent[]): Record<Aptitude, number> {
  const apt = Object.fromEntries(APTITUDES.map((k) => [k, sim.rng.range(8, 24)])) as Record<Aptitude, number>;
  for (const t of traits) if (TRAIT_BENT[t]) apt[TRAIT_BENT[t]!] += 8;
  for (const p of parents) {
    const fit = FIT[p.role];
    if (!fit) continue;
    const best = (Object.entries(fit) as [Aptitude, number][]).sort((a, b) => b[1] - a[1])[0][0];
    apt[best] += 6;
  }
  return apt;
}

/** What today's lesson builds: the teacher's topic, or the kid's own bent. */
export function lessonAptitude(sim: Sim, kid: Agent): Aptitude {
  const teacher = sim.agents.find((a) => a.role === 'teacher' && a.action.kind === 'teach' && a.action.stage === 'perform');
  const topic = teacher?.task?.title ?? '';
  if (/Science|Grade/.test(topic)) return sim.rng.chance(0.6) ? 'numbers' : 'hands';
  if (/Reading/.test(topic)) return 'people';
  const bent = kid.traits.map((t) => TRAIT_BENT[t]).find(Boolean);
  return bent && sim.rng.chance(0.5) ? bent : sim.rng.pick(APTITUDES);
}

/** The building a trade works out of, if it needs one (and whether there is one). */
function workplaceFor(sim: Sim, role: RoleKey): number | null | undefined {
  if (role === 'teacher') return sim.map.buildings.find((b) => b.kind === 'school')?.id;
  if (role === 'cook') return sim.map.buildings.find((b) => b.kind === 'cafe' && b.name.includes('Diner'))?.id;
  if (role === 'doctor') return sim.map.buildings.find((b) => b.kind === 'clinic')?.id;
  return null;
}

export interface CareerPick {
  role: RoleKey;
  why: string;
}

/**
 * Coming of age: weigh each trade by aptitude, by what the parents do, by what the adult they
 * most look up to does, and by what the town is short of.
 */
export function chooseCareer(sim: Sim, a: Agent): CareerPick {
  const parents = a.parents.map((id) => sim.person(id)).filter((p): p is Agent => !!p);
  const idol = [...a.relations.entries()]
    .map(([id, r]) => ({ o: sim.agent(id), r }))
    .filter((x) => x.o && ageOf(sim, x.o) >= ADULT_AGE && !a.parents.includes(x.o.id))
    .sort((x, y) => y.r.opinion - x.r.opinion)[0]?.o;
  const desks = new Set(sim.agents.map((o) => o.deskId ?? -1));
  const open = openSlots(sim);
  let best: CareerPick & { score: number } = { role: 'laborer', why: 'the town always needs a hand', score: -1 };
  for (const [role, fit] of Object.entries(FIT) as [RoleKey, Partial<Record<Aptitude, number>>][]) {
    const def = ROLES[role];
    if (def.station === 'desk' && !freeStations(sim, role, desks).length) continue;
    if (workplaceFor(sim, role) === undefined) continue;
    // The town's flexible trades only take people when they have an opening.
    const slots = open.get(role) ?? 0;
    if (def.flexible && slots <= 0) continue;
    if ((role === 'carpenter' || role === 'mason' || role === 'toolmaker') && !sim.map.buildings.some((b) => b.kind === 'workshop')) continue;
    const weights = Object.entries(fit) as [Aptitude, number][];
    let score = weights.reduce((s, [k, w]) => s + w * a.aptitude[k], 0) / weights.reduce((s, [, w]) => s + w, 0);
    const reasons: string[] = [];
    const strong = weights.sort((x, y) => y[1] - x[1])[0][0];
    if (a.aptitude[strong] >= 50) reasons.push(`good with ${APT_LABEL[strong].toLowerCase()}`);
    const parent = parents.find((p) => p.role === role);
    if (parent) {
      score += 18;
      reasons.push(`like their parent ${first(parent)}`);
    }
    if (idol?.role === role) {
      score += 10;
      reasons.push(`looks up to ${first(idol)}`);
    }
    // A town short of farmers nudges people toward farming.
    if (def.flexible) {
      score += 4 * Math.min(slots, 3);
      if (!sim.agents.some((o) => o.role === role)) reasons.push('the town has nobody doing it');
      else if (slots >= 2) reasons.push(`the town is short of ${def.title.toLowerCase()}s`);
    }
    score += sim.rng.range(0, 6);
    if (score > best.score) best = { role, why: reasons.join(', ') || 'it suits them', score };
  }
  return best;
}

/** Take up a trade; learn it at the elbow of a mentor (a parent, if they do it) for a couple of days. */
export function beginCareer(sim: Sim, a: Agent, pick: CareerPick, setRole: (sim: Sim, a: Agent, role: RoleKey, building: number | null) => void): void {
  const building = workplaceFor(sim, pick.role) ?? null;
  setRole(sim, a, pick.role, building);
  if (ROLES[pick.role].station === 'desk') {
    a.deskId = stationFor(sim, pick.role, new Set(sim.agents.map((o) => o.deskId ?? -1)));
    a.task = newTask(sim, a);
  }
  a.career = pick.role;
  const title = ROLES[pick.role].title.toLowerCase();
  const pool = sim.agents.filter((o) => o.id !== a.id && o.role === pick.role && ageOf(sim, o) >= ADULT_AGE);
  const mentor = pool.find((o) => a.parents.includes(o.id)) ?? pool.sort((x, y) => y.skills.craft.level - x.skills.craft.level)[0];
  if (mentor) {
    a.mentor = mentor.id;
    a.apprenticeUntil = sim.time + APPRENTICESHIP;
    const kin = kinship(sim, a, mentor);
    think(sim, a, `I'm learning to be a ${title} from ${first(mentor)}.`, 'good');
    think(sim, mentor, `${first(a)} is apprenticing with me. Time to pass it on.`, 'good');
    sim.log(`${a.name} came of age and is apprenticing as a ${title} under ${kin ? `their ${kin} ` : ''}${first(mentor)} (${pick.why})`, 'family', 'good', a, mentor).weight = NOTABLE;
  } else {
    sim.log(`${a.name} came of age and became a ${title} (${pick.why})`, 'family', 'good', a).weight = NOTABLE;
  }
}

/** Learning goes faster as an apprentice, and fastest working beside the mentor. */
export function learnBoost(sim: Sim, a: Agent): number {
  if (a.mentor === undefined || a.apprenticeUntil === undefined || sim.time >= a.apprenticeUntil) return 1;
  const m = sim.agent(a.mentor);
  return m && Math.abs(m.x - a.x) < 6 && Math.abs(m.y - a.y) < 6 ? 3 : 2;
}

/** Apprentices who've served their time are their own masters now. */
export function finishApprenticeships(sim: Sim): void {
  for (const a of sim.agents) {
    if (a.apprenticeUntil === undefined || sim.time < a.apprenticeUntil) continue;
    const m = sim.agent(a.mentor);
    a.apprenticeUntil = undefined;
    a.mentor = undefined;
    addMemory(sim, a, 'qualified');
    think(sim, a, `Apprenticeship done${m ? `. Thanks, ${first(m)}` : ''}. I know what I'm doing now.`, 'good');
    const trade = ROLES[a.career ?? a.role].title.toLowerCase();
    const now = a.career && a.career !== a.role && ROLES[a.role].flexible ? ` (helping out as a ${ROLES[a.role].title.toLowerCase()} for now)` : '';
    sim.log(`${first(a)} finished their apprenticeship as a ${trade}${now}`, 'work', 'good', a, m).weight = NOTABLE;
  }
}
