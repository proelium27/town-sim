import { ageOf } from './agents';
import { dreaming } from './aspirations';
import { DAY_NAMES, MIN_PER_DAY, ROLES, type SkillKey } from './defs';
import { andList, parkEventUntil } from './events';
import { capacity, familyOf, members, moveTo } from './planner';
import { addMemory, FRIEND, first, kinship, rel, say, shiftOpinion, think } from './social';
import type { Sim } from './sim';
import { type Agent, HEADLINE, NOTABLE } from './types';

/**
 * Courtship, weddings and funerals. Two people who like each other court for a while, one proposes, and the
 * wedding is held the next evening in the park (or at home in bad weather) with both families and their friends.
 * A death with a cemetery to bury in is followed by a funeral there the next morning, where the closest mourner
 * says a few words. Ages run two years a day, so all of this happens in hours, not months.
 */

export interface Courtship {
  with: number;
  stage: 'courting' | 'engaged';
  since: number;
}

export interface Wedding {
  couple: [number, number];
  at: number;
  until: number;
  started: boolean;
  /** Household whose home hosts it; unset means the park. */
  home?: number;
  guests: Set<number>;
}

export interface Funeral {
  dead: number;
  at: number;
  until: number;
  started: boolean;
  /** They were mayor when they died. */
  mayor: boolean;
  guests: Set<number>;
  speaker?: number;
}

/** Courting at least this long (game minutes) before anyone proposes. */
export const COURT_MIN = 6 * 60;
export const WEDDING_HOUR = 17;
export const WEDDING_LENGTH = 150;
export const FUNERAL_HOUR = 10;
export const FUNERAL_LENGTH = 90;
/** The closest mourner speaks this long after the funeral starts. */
const EULOGY_AFTER = 30;
/** Toddlers don't go to funerals. */
const MOURNER_AGE = 4;
/** A funeral for someone buried later is held only if they died within this many days. */
const LATE_FUNERAL = 10;
/** A wedding pushed back by a park event still starts if that's over by this hour. */
const WEDDING_LATEST = 20;

/** Nobody proposes outside these hours. */
const PROPOSE_FROM = 8;
const PROPOSE_UNTIL = 22;

const related = (a: Agent, b: Agent) =>
  a.parents.includes(b.id) || b.parents.includes(a.id) || a.parents.some((p) => b.parents.includes(p));

const grieving = (a: Agent) => a.memories.some((m) => m.kind === 'grief' || m.kind === 'heartbroken');

/** Up and about in the waking hours, not asleep or on the way to bed. */
const awake = (sim: Sim, a: Agent) => sim.hour >= PROPOSE_FROM && sim.hour < PROPOSE_UNTIL && a.action.kind !== 'sleep';

/** The next `hour` o'clock at least `ahead` minutes away. */
function nextAt(sim: Sim, hour: number, ahead: number): number {
  let t = sim.day * MIN_PER_DAY + hour * 60;
  while (t < sim.time + ahead) t += MIN_PER_DAY;
  return t;
}

/** "this evening", "tomorrow evening", "Friday evening", "tomorrow morning". */
function when(sim: Sim, t: number, part: string): string {
  const ahead = Math.floor(t / MIN_PER_DAY) - sim.day;
  return ahead <= 0 ? `this ${part}` : ahead === 1 ? `tomorrow ${part}` : `${DAY_NAMES[Math.floor(t / MIN_PER_DAY) % 7]} ${part}`;
}

/** The first evening at or after `t` with no other wedding on it, so guests aren't split between two. */
function freeEvening(sim: Sim, t: number, except?: Wedding): number {
  while (sim.events.weddings.some((o) => o !== except && Math.floor(o.at / MIN_PER_DAY) === Math.floor(t / MIN_PER_DAY))) t += MIN_PER_DAY;
  return t;
}

/** Checked a few times a day: new couples start courting, courting couples get engaged or drift apart. */
export function courtship(sim: Sim): void {
  for (const a of sim.agents) {
    const p = a.partner !== null && a.id < a.partner ? sim.agent(a.partner) : undefined;
    if (p && p.household !== a.household) settleCouple(sim, a, p);
  }
  for (const a of sim.agents) {
    const c = a.court;
    if (!c) continue;
    const b = sim.agent(c.with);
    if (!b || b.court?.with !== a.id || a.partner !== null || b.partner !== null) {
      a.court = undefined;
      continue;
    }
    if (a.id > b.id) continue;
    const ra = rel(a, b);
    const rb = rel(b, a);
    const low = Math.min(ra.opinion, rb.opinion);
    if (c.stage === 'courting') {
      if (low < 40) {
        breakUp(sim, a, b);
        continue;
      }
      // Time spent together while courting.
      ra.opinion = Math.min(100, ra.opinion + 1.5);
      rb.opinion = Math.min(100, rb.opinion + 1.5);
      if (sim.time - c.since >= COURT_MIN && low >= 65 && sim.rng.chance(0.35) && awake(sim, a) && awake(sim, b)) propose(sim, a, b);
    } else if (low < 30) breakUp(sim, a, b);
  }

  const singles = sim.agents.filter((a) => a.partner === null && !a.court && ageOf(sim, a) >= 20 && !grieving(a));
  for (const a of singles) {
    if (a.court) continue;
    for (const b of singles) {
      if (b.id <= a.id || b.court || related(a, b)) continue;
      if (Math.abs(ageOf(sim, a) - ageOf(sim, b)) > 15) continue;
      const ra = rel(a, b);
      const rb = rel(b, a);
      if (ra.opinion < 55 || rb.opinion < 55 || ra.familiarity < 30) continue;
      if (!sim.rng.chance(dreaming(a, 'love') || dreaming(b, 'love') ? 0.4 : 0.25)) continue;
      a.court = { with: b.id, stage: 'courting', since: sim.time };
      b.court = { with: a.id, stage: 'courting', since: sim.time };
      ra.opinion = Math.min(100, ra.opinion + 10);
      rb.opinion = Math.min(100, rb.opinion + 10);
      addMemory(sim, a, 'newPartner', b);
      addMemory(sim, b, 'newPartner', a);
      say(sim, a, '♥', 'good', 20);
      say(sim, b, '♥', 'good', 20);
      think(sim, a, `I think I'm falling for ${first(b)}.`, 'good');
      think(sim, b, `${first(a)} makes me smile.`, 'good');
      sim.log(`${first(a)} and ${first(b)} fell in love and are courting`, 'family', 'good', a, b).weight = NOTABLE;
      break;
    }
  }
}

function propose(sim: Sim, a: Agent, b: Agent): void {
  // The bolder of the two asks.
  const [asker, other] = a.skills.charisma.level + (a.traits.includes('extrovert') ? 2 : 0) >= b.skills.charisma.level + (b.traits.includes('extrovert') ? 2 : 0) ? [a, b] : [b, a];
  for (const x of [a, b]) {
    x.court = { with: x === a ? b.id : a.id, stage: 'engaged', since: sim.time };
    addMemory(sim, x, 'engaged', x === a ? b : a);
  }
  const at = freeEvening(sim, nextAt(sim, WEDDING_HOUR, 4 * 60));
  sim.events.weddings.push({ couple: [a.id, b.id], at, until: at + WEDDING_LENGTH, started: false, guests: new Set() });
  say(sim, asker, `marry me, ${first(other)}?`, 'good', 15);
  say(sim, other, 'yes!', 'good', 15);
  think(sim, asker, `I asked ${first(other)} to marry me. They said yes!`, 'good');
  think(sim, other, `${first(asker)} proposed! We're getting married ${when(sim, at, 'evening')}.`, 'good');
  sim.log(`${first(asker)} proposed to ${first(other)}, who said yes. The wedding is ${when(sim, at, 'evening')}`, 'family', 'good', asker, other).weight = NOTABLE;
}

function breakUp(sim: Sim, a: Agent, b: Agent): void {
  const engaged = a.court?.stage === 'engaged';
  a.court = b.court = undefined;
  sim.events.weddings = sim.events.weddings.filter((w) => !w.couple.includes(a.id));
  for (const [x, y] of [[a, b], [b, a]] as const) {
    addMemory(sim, x, 'heartbroken', y);
    shiftOpinion(sim, x, y, -8);
    think(sim, x, engaged ? `The wedding's off. I can't believe it.` : `${first(y)} and I aren't seeing each other anymore.`, 'bad');
  }
  sim.log(engaged ? `${first(a)} and ${first(b)} called off their wedding` : `${first(a)} and ${first(b)} went their separate ways`, 'family', 'bad', a, b).weight = NOTABLE;
}

/** Opinion of either of the couple that gets someone to the wedding as a well-wisher (the "Friendly" level). */
const WELL_WISHER = 10;
/** Familiarity that counts as knowing someone well enough to come and wish them well. */
const WELL_KNOWN = 15;

/**
 * Who someone is to this wedding: the couple; family or housemates of either; a friend; or a well-wisher who gets
 * on with them. In a young town most guests are the last kind.
 */
export function weddingRole(sim: Sim, w: Wedding, a: Agent): 'couple' | 'kin' | 'friend' | 'guest' | null {
  if (w.couple.includes(a.id)) return 'couple';
  const pair = w.couple.map((id) => sim.agent(id)).filter((x): x is Agent => !!x);
  if (pair.some((p) => kinship(sim, a, p) || p.household === a.household)) return 'kin';
  const best = Math.max(...pair.map((p) => a.relations.get(p.id)?.opinion ?? 0));
  if (best >= FRIEND) return 'friend';
  // Getting on with them, or knowing them well enough with no ill will.
  const known = pair.some((p) => {
    const r = a.relations.get(p.id);
    return !!r && r.opinion >= 0 && r.familiarity >= WELL_KNOWN;
  });
  return best >= WELL_WISHER || known ? 'guest' : null;
}

/** Close enough to the dead to come to the funeral: the same people who grieve. */
export function mourns(a: Agent, dead: Agent): boolean {
  return a.id === dead.partner || dead.children.includes(a.id) || dead.parents.includes(a.id) || (a.relations.get(dead.id)?.opinion ?? 0) >= 40;
}

export function weddingNames(sim: Sim, w: Wedding): string {
  return andList(w.couple.map((id) => sim.person(id)).filter((x): x is Agent => !!x).map(first));
}

/** A death with a grave to go to gets a funeral at the cemetery the next morning. */
export function scheduleFuneral(sim: Sim, dead: Agent, mayor: boolean): void {
  if (!sim.map.buildings.some((b) => b.kind === 'cemetery') || sim.events.funerals.some((f) => f.dead === dead.id)) return;
  const at = nextAt(sim, FUNERAL_HOUR, 8 * 60);
  sim.events.funerals.push({ dead: dead.id, at, until: at + FUNERAL_LENGTH, started: false, mayor, guests: new Set() });
}

/** Each step: start and end weddings and funerals, and have someone speak at each funeral. */
export function tickRites(sim: Sim): void {
  const ev = sim.events;
  for (const w of [...ev.weddings]) {
    if (!w.started && sim.time >= w.at) startWedding(sim, w);
    else if (w.started && sim.time >= w.until) endWedding(sim, w);
  }
  for (const f of [...ev.funerals]) {
    if (!f.started && sim.time >= f.at) startFuneral(sim, f);
    else if (f.started && f.speaker === undefined && sim.time >= f.at + EULOGY_AFTER) speak(sim, f);
    if (f.started && sim.time >= f.until) endFuneral(sim, f);
  }
}

function startWedding(sim: Sim, w: Wedding): void {
  const [a, b] = w.couple.map((id) => sim.agent(id));
  if (!a || !b || a.court?.with !== b.id) {
    sim.events.weddings = sim.events.weddings.filter((x) => x !== w);
    return;
  }
  const ev = sim.events;
  // Rain, snow or winter cold move it indoors, to whichever of their homes there is.
  const indoors = !!(ev.rain || ev.snowstorm) || sim.season === 3;
  const home = [a, b].map((x) => x.household).find((h) => sim.town.households[h].building >= 0);
  w.home = indoors ? home : undefined;
  // Another wedding already has this evening, or a festival or the rally has the park (and with it the well-wishers,
  // even for a wedding at home): start when it's over, or another evening.
  const busy = parkEventUntil(sim);
  const taken = ev.weddings.some((o) => o !== w && o.started);
  if (taken || busy > sim.time) {
    const before = Math.floor(w.at / MIN_PER_DAY);
    w.at = !taken && busy <= sim.day * MIN_PER_DAY + WEDDING_LATEST * 60 ? busy : freeEvening(sim, (sim.day + 1) * MIN_PER_DAY + WEDDING_HOUR * 60, w);
    w.until = w.at + WEDDING_LENGTH;
    if (Math.floor(w.at / MIN_PER_DAY) !== before) sim.log(`${first(a)} and ${first(b)}'s wedding is put off until ${when(sim, w.at, 'evening')}`, 'family', 'neutral', a, b);
    return;
  }
  w.started = true;
  w.until = sim.time + WEDDING_LENGTH;
  w.guests = new Set();
  a.partner = b.id;
  b.partner = a.id;
  a.court = b.court = undefined;
  const where = w.home !== undefined ? `at the ${sim.town.households[w.home].name}` : 'in the park';
  for (const x of [a, b]) think(sim, x, `Today I marry ${first(x === a ? b : a)}.`, 'good');
  sim.log(`${first(a)} and ${first(b)} are getting married ${where}`, 'family', 'good', a, b).weight = NOTABLE;
}

function endWedding(sim: Sim, w: Wedding): void {
  sim.events.weddings = sim.events.weddings.filter((x) => x !== w);
  const [a, b] = w.couple.map((id) => sim.agent(id));
  if (!a || !b) return;
  const guests = [...w.guests].filter((id) => !w.couple.includes(id)).map((id) => sim.agent(id)).filter((x): x is Agent => !!x);
  for (const x of [a, b]) addMemory(sim, x, 'married', x === a ? b : a, 1 + Math.min(0.4, guests.length / 20));
  for (const g of guests) {
    addMemory(sim, g, 'wedding', a);
    for (const x of [a, b]) {
      shiftOpinion(sim, g, x, sim.rng.range(1, 4));
      shiftOpinion(sim, x, g, sim.rng.range(2, 5));
    }
  }
  settleCouple(sim, a, b);
  const text = guests.length ? `${first(a)} and ${first(b)} are married! ${guests.length === 1 ? 'One guest' : `${guests.length} guests`} came to celebrate` : `${first(a)} and ${first(b)} married quietly, just the two of them`;
  sim.log(text, 'family', 'good', a, b).weight = HEADLINE;
  sim.milestone(`${a.name} and ${b.name} were married`);
}

/**
 * Newlyweds move in together if either of their homes has room for the other's family; otherwise the planner
 * builds them one (as a priority), and this is tried again as rooms open up.
 */
export function settleCouple(sim: Sim, a: Agent, b: Agent): void {
  if (a.household === b.household) return;
  for (const [stay, go] of [[a, b], [b, a]] as const) {
    const fam = familyOf(sim, go).filter((x) => x.id !== stay.id && x.household === go.household);
    if (sim.town.households[stay.household].building >= 0 && capacity(sim, stay.household) - members(sim, stay.household).length >= fam.length) {
      moveTo(sim, fam, stay.household);
      for (const f of fam) addMemory(sim, f, 'movedIn');
      sim.log(`${first(go)} moved in with ${first(stay)}`, 'family', 'good', go, stay).weight = NOTABLE;
      return;
    }
  }
}

function startFuneral(sim: Sim, f: Funeral): void {
  const dead = sim.person(f.dead);
  if (!dead || !sim.map.buildings.some((b) => b.kind === 'cemetery')) {
    sim.events.funerals = sim.events.funerals.filter((x) => x !== f);
    return;
  }
  f.started = true;
  f.at = sim.time;
  f.until = sim.time + FUNERAL_LENGTH;
  if (sim.agents.some((x) => mourns(x, dead) && ageOf(sim, x) >= MOURNER_AGE)) sim.log(`Mourners are gathering at the cemetery for ${dead.name}'s funeral`, 'family', 'neutral', dead).weight = NOTABLE;
}

/** The closest mourner present: partner, then a child, a parent, family, then the dearest friend. */
function speakerFor(sim: Sim, f: Funeral, dead: Agent): Agent | undefined {
  const here = [...f.guests].map((id) => sim.agent(id)).filter((x): x is Agent => !!x && ageOf(sim, x) >= 12);
  const rank = (a: Agent) =>
    a.id === dead.partner ? 5 : dead.children.includes(a.id) ? 4 : dead.parents.includes(a.id) ? 3 : kinship(sim, a, dead) ? 2 : 1;
  return here.sort((x, y) => rank(y) - rank(x) || (y.relations.get(dead.id)?.opinion ?? 0) - (x.relations.get(dead.id)?.opinion ?? 0))[0];
}

const SKILL_PHRASE: Record<SkillKey, string> = {
  craft: 'could make anything with their hands',
  cooking: 'cooked like nobody else',
  charisma: 'could talk anyone round',
  athletics: 'never sat still',
  music: 'filled the house with music',
};

/** What the speaker says, from what the town knows of their life. Empty if there's nothing much to tell. */
export function eulogy(sim: Sim, dead: Agent, mayor: boolean): string[] {
  const out: string[] = [];
  const trade = dead.role === 'retired' ? dead.career : dead.role === 'child' ? undefined : dead.role;
  if (trade && trade !== 'retired' && trade !== 'child') {
    const t = ROLES[trade].title.toLowerCase();
    out.push(`worked as ${/^[aeiou]/.test(t) ? 'an' : 'a'} ${t}`);
  }
  if (mayor) out.push('served as mayor');
  const best = (Object.keys(dead.skills) as SkillKey[]).sort((x, y) => dead.skills[y].level - dead.skills[x].level)[0];
  if (best && dead.skills[best].level >= 6) out.push(SKILL_PHRASE[best]);
  const kids = dead.children.length;
  if (kids) out.push(`raised ${kids === 1 ? 'a child' : `${kids} children`}`);
  const grandkids = new Set(dead.children.flatMap((id) => sim.person(id)?.children ?? [])).size;
  if (grandkids) out.push(`saw ${grandkids === 1 ? 'a grandchild' : `${grandkids} grandchildren`} born`);
  if (dead.age >= 75) out.push(`lived to ${dead.age}`);
  return out;
}

function speak(sim: Sim, f: Funeral): void {
  const dead = sim.person(f.dead);
  if (!dead) return;
  const s = speakerFor(sim, f, dead);
  // Nobody here yet: try again next step, while mourners are still walking over.
  if (!s) return;
  f.speaker = s.id;
  const words = eulogy(sim, dead, f.mayor);
  say(sim, s, `goodbye, ${first(dead)}`, 'neutral', 10);
  sim.log(
    words.length ? `${first(s)} spoke at ${first(dead)}'s funeral: ${first(dead)} ${andList(words)}` : `${first(s)} said a few words for ${first(dead)}`,
    'family', 'neutral', s,
  ).weight = NOTABLE;
}

function endFuneral(sim: Sim, f: Funeral): void {
  sim.events.funerals = sim.events.funerals.filter((x) => x !== f);
  const dead = sim.person(f.dead);
  if (!dead) return;
  const guests = [...f.guests].map((id) => sim.agent(id)).filter((x): x is Agent => !!x);
  for (const g of guests) {
    // Saying goodbye together takes the edge off the grief.
    const grief = g.memories.find((m) => m.kind === 'grief' && m.about === dead.id);
    if (grief) grief.mood = Math.round(grief.mood * 0.6);
    addMemory(sim, g, 'funeral', dead);
    for (const o of guests) if (o.id !== g.id) shiftOpinion(sim, g, o, sim.rng.range(0.5, 2));
  }
  sim.log(guests.length ? `${dead.name} was laid to rest. ${guests.length === 1 ? 'One person' : `${guests.length} people`} came to say goodbye` : `${dead.name} was laid to rest with no one there`, 'family', guests.length ? 'neutral' : 'bad', dead).weight = NOTABLE;
}

/** Someone who died before there was a cemetery is buried when it's built; the funeral follows unless it's long past. */
export function layToRest(sim: Sim, dead: Agent): void {
  if (dead.died && sim.time - dead.died.at <= LATE_FUNERAL * MIN_PER_DAY) scheduleFuneral(sim, dead, dead.died.mayor);
}

export function weddingOf(sim: Sim, id: number): Wedding | undefined {
  return sim.events.weddings.find((w) => w.started && w.couple.includes(id));
}

export function funeralOf(sim: Sim, deadId: number): Funeral | undefined {
  return sim.events.funerals.find((f) => f.started && f.dead === deadId);
}
