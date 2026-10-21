import { ageOf } from './agents';
import { MIN_PER_DAY, SEASON_DAYS, SEASONS, YEAR_DAYS } from './defs';
import { andList } from './events';
import { eulogy } from './rites';
import type { Sim } from './sim';
import { first } from './social';
import { type Agent, HEADLINE } from './types';

/**
 * The town chronicle: every headline the town has had (the feed only keeps its last few hundred lines), a snapshot
 * at the start of each year, and from those, year pages, obituaries and family trees. Nothing here is invented:
 * every sentence is built from something the sim recorded.
 */

export interface ChronicleEntry {
  t: number;
  text: string;
  agentId?: number;
  otherId?: number;
}

/** The town as it stood on the first morning of a year. */
export interface Annal {
  year: number;
  pop: number;
  buildings: number;
}

const yearOf = (t: number) => Math.floor(t / (YEAR_DAYS * MIN_PER_DAY)) + 1;
const seasonOf = (t: number) => SEASONS[Math.floor(t / (SEASON_DAYS * MIN_PER_DAY)) % SEASONS.length];

/** Each step: copy new headlines into the chronicle, and note the town at the start of a new year. */
export function tickChronicle(sim: Sim): void {
  const fresh = sim.activityVersion - sim.chronicleSeen;
  if (fresh > 0) {
    // The newest `fresh` lines; weights are set as soon as a line is logged, within the same step.
    for (const e of sim.activity.slice(-Math.min(fresh, sim.activity.length))) {
      if ((e.weight ?? 0) >= HEADLINE) sim.chronicle.push({ t: e.t, text: e.text, agentId: e.agentId, otherId: e.otherId });
    }
    sim.chronicleSeen = sim.activityVersion;
  }
  if (sim.annals[sim.annals.length - 1]?.year !== sim.year) sim.annals.push({ year: sim.year, pop: sim.agents.length, buildings: sim.map.buildings.length });
}

export interface YearPage {
  year: number;
  current: boolean;
  summary: string;
  lines: { season: string; text: string; agentId?: number; otherId?: number }[];
  byline: string;
  closing: string;
}

/** One year of the town, written up from what it recorded. */
export function yearPage(sim: Sim, year: number): YearPage {
  const current = year === sim.year;
  const start = sim.annals.find((a) => a.year === year);
  const end = sim.annals.find((a) => a.year === year + 1);
  const pop0 = start?.pop;
  const pop1 = current ? sim.agents.length : end?.pop;
  const counted = (re: RegExp) => sim.history.filter((h) => yearOf(h.t) === year && re.test(h.text)).length;
  const births = counted(/ was born$/);
  const deaths = counted(/ passed away$/);
  const weddings = counted(/ were married$/);
  const built = counted(/^Built /);
  const left = counted(/ left Northwind$/);

  const parts: string[] = [];
  if (pop0 !== undefined && pop1 !== undefined) {
    parts.push(pop1 > pop0 ? `Northwind grew from ${pop0} to ${pop1} people` : pop1 < pop0 ? `Northwind shrank from ${pop0} to ${pop1} people` : `Northwind held steady at ${pop1} people`);
  }
  const n = (k: number, one: string, many: string) => (k === 1 ? `one ${one}` : `${k} ${many}`);
  const counts = [
    births && n(births, 'birth', 'births'),
    weddings && n(weddings, 'wedding', 'weddings'),
    deaths && n(deaths, 'death', 'deaths'),
    built && n(built, 'new building', 'new buildings'),
    left && n(left, 'family moving away', 'families moving away'),
  ].filter(Boolean) as string[];
  if (counts.length) parts.push(`${parts.length ? 'with' : 'There were'} ${andList(counts)}`);
  const summary = parts.length ? `${parts.join(', ')}${current ? ', so far' : ''}.` : current ? 'The year has only just begun.' : 'A quiet year.';

  const lines = sim.chronicle.filter((e) => yearOf(e.t) === year).map((e) => ({ season: seasonOf(e.t), text: e.text, agentId: e.agentId, otherId: e.otherId }));

  // The office writer keeps the chronicle, if the town has one.
  const writer = sim.agents.find((a) => a.role === 'writer');
  const byline = writer ? `Kept by ${writer.name}, writer` : 'Pieced together from the town records';
  const closing =
    births > deaths && births >= 2 ? 'More cradles than graves.'
      : deaths > births && deaths >= 2 ? 'A year of goodbyes.'
        : built >= 3 ? 'The hammers hardly stopped.'
          : weddings >= 2 ? 'A year for weddings.'
            : '';
  return { year, current, summary, lines, byline, closing: current ? '' : closing };
}

/** Every year the town has seen, newest first. */
export function years(sim: Sim): number[] {
  return Array.from({ length: sim.year }, (_, i) => sim.year - i);
}

/** "Bram Ellis, Year 1–Year 4, aged 81. Bram worked as a carpenter and raised 3 children. Survived by …" */
export function obituary(sim: Sim, dead: Agent): string {
  const born = dead.birth >= 0 ? `born in Year ${yearOf(dead.birth)}` : 'born before Northwind was founded';
  const died = dead.diedAt !== undefined ? `died in Year ${yearOf(dead.diedAt)}` : 'since passed away';
  // The age is already in the first sentence.
  const words = eulogy(sim, dead, false).filter((w) => !w.startsWith('lived to'));
  const life = words.length ? ` ${first(dead)} ${andList(words)}.` : '';
  const partner = sim.agent(dead.partner ?? undefined);
  const kids = dead.children.filter((id) => sim.agent(id)).length;
  const grandkids = new Set(dead.children.flatMap((id) => sim.person(id)?.children ?? []).filter((id) => sim.agent(id))).size;
  const left = [
    partner && `${first(partner)}`,
    kids && (kids === 1 ? 'a child' : `${kids} children`),
    grandkids && (grandkids === 1 ? 'a grandchild' : `${grandkids} grandchildren`),
  ].filter(Boolean) as string[];
  return `${dead.name}, ${born}, ${died} at ${dead.age}.${life}${left.length ? ` Survived by ${andList(left)}.` : ''}`;
}

export interface TreeNode {
  id: number;
  name: string;
  alive: boolean;
  /** "41" for the living, "Y1–Y4" or "passed away" for the dead. */
  note: string;
}

export interface FamilyTree {
  person: TreeNode;
  partner?: TreeNode;
  grandparents: TreeNode[];
  parents: TreeNode[];
  siblings: TreeNode[];
  children: TreeNode[];
  grandchildren: TreeNode[];
}

function node(sim: Sim, a: Agent): TreeNode {
  const alive = !!sim.agent(a.id);
  const note = alive
    ? String(Math.floor(ageOf(sim, a)))
    : sim.departed.some((d) => d.id === a.id)
      ? 'moved away'
      : a.diedAt !== undefined
        ? `${a.birth >= 0 ? `Y${yearOf(a.birth)}` : 'founder'}–Y${yearOf(a.diedAt)}`
        : 'passed away';
  return { id: a.id, name: a.name, alive, note };
}

/** Three generations around someone, living and dead. */
export function familyTree(sim: Sim, id: number): FamilyTree | null {
  const a = sim.person(id) ?? sim.departed.find((d) => d.id === id);
  if (!a) return null;
  const who = (ids: number[]) => [...new Set(ids)].map((i) => sim.person(i) ?? sim.departed.find((d) => d.id === i)).filter((x): x is Agent => !!x);
  const parents = who(a.parents);
  const children = who(a.children);
  const partner = a.partner !== null ? who([a.partner])[0] : undefined;
  return {
    person: node(sim, a),
    partner: partner && node(sim, partner),
    grandparents: who(parents.flatMap((p) => p.parents)).map((x) => node(sim, x)),
    parents: parents.map((x) => node(sim, x)),
    siblings: who(parents.flatMap((p) => p.children)).filter((x) => x.id !== a.id).map((x) => node(sim, x)),
    children: children.map((x) => node(sim, x)),
    grandchildren: who(children.flatMap((c) => c.children)).map((x) => node(sim, x)),
  };
}
