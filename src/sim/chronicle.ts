import { ageOf } from './agents';
import { MIN_PER_DAY, ROLES, SEASON_DAYS, SEASONS, type SkillKey, YEAR_DAYS } from './defs';
import { andList } from './events';
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
  /** Who kept the chronicle that year (the last office writer seen), so a page never credits someone who wasn't there. */
  writer?: { id: number; name: string };
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
  const annal = sim.annals[sim.annals.length - 1];
  if (!annal.writer || !sim.agent(annal.writer.id)) {
    const writer = sim.agents.find((a) => a.role === 'writer');
    if (writer) annal.writer = { id: writer.id, name: writer.name };
  }
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
  const left = sim.history.filter((h) => yearOf(h.t) === year && h.text.endsWith(` left ${sim.name}`)).length;
  const arrivals = sim.chronicle
    .filter((e) => yearOf(e.t) === year)
    .reduce((sum, e) => {
      const m = /^(?:A family|Newcomers|A newcomer) arrived: (.*?)(?:, with nowhere to live yet)?$/.exec(e.text);
      return sum + (m ? m[1].split(', ').length : 0);
    }, 0);

  const parts: string[] = [];
  if (pop0 !== undefined && pop1 !== undefined) {
    parts.push(pop1 > pop0 ? `${sim.name} grew from ${pop0} to ${pop1} people` : pop1 < pop0 ? `${sim.name} shrank from ${pop0} to ${pop1} people` : `${sim.name} held steady at ${pop1} people`);
  }
  const n = (k: number, one: string, many: string) => (k === 1 ? `one ${one}` : `${k} ${many}`);
  const counts = [
    births && n(births, 'birth', 'births'),
    arrivals && n(arrivals, 'newcomer', 'newcomers'),
    weddings && n(weddings, 'wedding', 'weddings'),
    deaths && n(deaths, 'death', 'deaths'),
    built && n(built, 'new building', 'new buildings'),
    left && n(left, 'family moving away', 'families moving away'),
  ].filter(Boolean) as string[];
  if (counts.length) parts.push(`${parts.length ? 'with' : 'There were'} ${andList(counts)}`);
  const summary = parts.length ? `${parts.join(', ')}${current ? ', so far' : ''}.` : current ? 'The year has only just begun.' : 'A quiet year.';

  const lines = sim.chronicle.filter((e) => yearOf(e.t) === year).map((e) => ({ season: seasonOf(e.t), text: e.text, agentId: e.agentId, otherId: e.otherId }));

  // The office writer who kept the chronicle that year, if the town had one then.
  const writer = start?.writer;
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

/** Several ways to say each skill, so a page of obituaries doesn't repeat itself; one is chosen by who the person was. */
const SKILL_WORDS: Record<SkillKey, string[]> = {
  craft: ['could make anything with their hands', 'had a gift for making things', 'built things to last'],
  cooking: ['cooked like nobody else', 'never let a guest leave hungry', 'was known for their table'],
  charisma: ['could talk anyone round', 'was never short of a friend', 'had a way with people'],
  athletics: ['never sat still', 'could outwalk anyone in town', 'was always on the move'],
  music: ['filled the house with music', 'kept the town singing', 'never went a day without a tune'],
};

/** The skill that set them apart from the rest of the town, not just their highest: craft tops almost everyone's list. */
export function standout(sim: Sim, dead: Agent): string | undefined {
  const everyone = [...sim.agents, ...sim.deceased.filter((d) => d.id !== dead.id), dead];
  let best: { key: SkillKey; edge: number } | undefined;
  for (const key of Object.keys(SKILL_WORDS) as SkillKey[]) {
    const level = dead.skills[key].level;
    const mean = everyone.reduce((sum, a) => sum + a.skills[key].level, 0) / everyone.length;
    const edge = level - mean;
    if (level >= 5 && edge >= 1 && (!best || edge > best.edge)) best = { key, edge };
  }
  const words = best && SKILL_WORDS[best.key];
  return words && words[dead.id % words.length];
}

/** What can be said of a life: the trade (their former trade, if retired and known), what stood out, family. */
function lifeWords(sim: Sim, dead: Agent): string[] {
  const out: string[] = [];
  const trade = dead.role === 'retired' ? dead.career : dead.role === 'child' ? undefined : dead.role;
  if (trade && trade !== 'retired' && trade !== 'child') {
    const t = ROLES[trade].title.toLowerCase();
    out.push(`worked as ${/^[aeiou]/.test(t) ? 'an' : 'a'} ${t}`);
  }
  const skill = standout(sim, dead);
  if (skill) out.push(skill);
  const kids = dead.children.length;
  if (kids) out.push(`raised ${kids === 1 ? 'a child' : `${kids} children`}`);
  const grandkids = new Set(dead.children.flatMap((id) => sim.person(id)?.children ?? [])).size;
  if (grandkids) out.push(`saw ${grandkids === 1 ? 'a grandchild' : `${grandkids} grandchildren`} born`);
  return out;
}

/** Who someone leaves behind, as they stand at the moment of death. */
export function survivorsOf(sim: Sim, dead: Agent): string[] {
  const partner = sim.agent(dead.partner ?? undefined);
  const kids = dead.children.filter((id) => sim.agent(id)).length;
  const grandkids = new Set(dead.children.flatMap((id) => sim.person(id)?.children ?? []).filter((id) => sim.agent(id))).size;
  return [
    partner && `${first(partner)}`,
    kids && (kids === 1 ? 'a child' : `${kids} children`),
    grandkids && (grandkids === 1 ? 'a grandchild' : `${grandkids} grandchildren`),
  ].filter(Boolean) as string[];
}

/** "Bram Ellis, Year 1–Year 4, aged 81. Bram worked as a carpenter and raised 3 children. Survived by …" */
export function obituary(sim: Sim, dead: Agent): string {
  const born = dead.birth >= 0 ? `born in Year ${yearOf(dead.birth)}` : `born before ${sim.name} was founded`;
  const died = dead.diedAt !== undefined ? `died in Year ${yearOf(dead.diedAt)}` : 'since passed away';
  const words = lifeWords(sim, dead);
  const life = words.length ? ` ${first(dead)} ${andList(words)}.` : '';
  // Written down at death; older saves work it out from who is alive now.
  const left = dead.survivors ?? survivorsOf(sim, dead);
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
  // A widow or widower keeps their late partner on the tree: die() clears the survivor's link, but not the dead one's.
  const late = a.partner === null ? sim.deceased.filter((d) => d.partner === a.id).sort((x, y) => (y.diedAt ?? 0) - (x.diedAt ?? 0))[0] : undefined;
  const partner = a.partner !== null ? who([a.partner])[0] : late;
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
