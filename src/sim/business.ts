import { ageOf } from './agents';
import { ADULT_AGE, type Good, MIN_PER_DAY, RETIRE_AGE, type RoleKey, SEASON_DAYS } from './defs';
import { passOnMoney } from './life';
import { BASE_PRICE, price, spend } from './market';
import { taxRate } from './civic';
import { setRole } from './planner';
import { addMemory, first, think } from './social';
import { Rng } from './rng';
import type { Sim } from './sim';
import { type Agent, HEADLINE, NOTABLE } from './types';
import { BLUEPRINTS } from '../world/blueprints';

/**
 * Private businesses. Someone with savings, a head for it and the trade proposes a bakery or a tavern of their own at
 * the town meeting; they pay for the build (borrowing the rest from the treasury) and run it themselves. Customers
 * pay the business, which pays the town its cut and buys its food from the town's stores; the owner draws the profit
 * each night and pays down the loan. Prices float against the town's: cheaper in a glut, dearer in a shortage. A
 * business that loses money over a season closes, and the town buys the building and keeps it open.
 */

export type BusinessKind = 'bakery' | 'tavern';

export interface Business {
  id: number;
  kind: BusinessKind;
  building: number;
  name: string;
  /** Who runs it; null once the town has bought it. */
  owner: number | null;
  opened: number;
  /** Cash on hand; the owner takes anything over FLOAT each night. */
  till: number;
  /** Money in and out this season (out: the town's cut and the food bought). */
  takings: number;
  costs: number;
  /** The season the books above are for, as a count of seasons since the start. */
  season: number;
  today: number;
  yesterday: number;
  served: number;
  /** Still owed to the treasury. */
  loan: number;
  /** The last day there was a music night. */
  musicDay?: number;
  closed?: number;
}

/** pop: people before anyone proposes one; savings: what a founder needs to start; upkeep: a day's flour, firewood and ground rent, to the town. */
export const BUSINESSES: Record<BusinessKind, { role: RoleKey; noun: string; pop: number; savings: number; upkeep: number }> = {
  bakery: { role: 'baker', noun: 'a bakery', pop: 20, savings: 140, upkeep: 14 },
  tavern: { role: 'innkeeper', noun: 'a tavern', pop: 22, savings: 160, upkeep: 10 },
};
/** Cash a business keeps in the till overnight. */
export const FLOAT = 40;
/** Share of each night's profit that goes to the loan while one is owed. */
const REPAY = 0.35;
/** Tavern hours, for customers. */
export const TAVERN_OPEN = 16;
export const TAVERN_CLOSE = 22.75;
/** Traits that make someone want to run their own place. */
const ENTERPRISING = ['workaholic', 'competitive', 'creative', 'extrovert'] as const;

const seasonIndex = (sim: Sim) => Math.floor(sim.time / (SEASON_DAYS * MIN_PER_DAY));

export function businessAt(sim: Sim, building: number | undefined): Business | undefined {
  return building === undefined ? undefined : sim.businesses.find((b) => b.building === building);
}

export function ownedBy(sim: Sim, a: Agent): Business | undefined {
  return sim.businesses.find((b) => b.owner === a.id);
}

/** 0.85 in a glut (they undercut the town), 1.25 in a shortage (they charge what it'll bear), else 1. */
export function priceMood(sim: Sim): number {
  const r = price(sim, 'food') / BASE_PRICE.food;
  // The mayor can cap them at the town's own prices.
  return r < 0.9 ? 0.85 : r > 1.5 && !sim.civic.policies.priceCap ? 1.25 : 1;
}

/** What a meal costs at the café or a town-run place. */
export const townMeal = (sim: Sim) => Math.round(5 + price(sim, 'food') * 1.5);

/**
 * What something costs here: a meal, a coffee, or a drink at the tavern. The owner at their own place only covers the
 * food (a meal is the town's food price; a coffee or a drink is on the house).
 */
export function priceAt(sim: Sim, building: number | undefined, item: 'meal' | 'coffee' | 'drink', who?: Agent): number {
  const base = item === 'meal' ? townMeal(sim) : item === 'coffee' ? 3 : 5;
  const biz = businessAt(sim, building);
  if (biz?.owner != null && who && biz.owner === who.id) return item === 'meal' ? price(sim, 'food') : 0;
  return biz?.owner != null ? Math.max(1, Math.round(base * priceMood(sim))) : base;
}

/**
 * A customer pays. At a privately run place the money goes in the till, less the town's cut, and a meal's food is
 * bought from the town's stores; anywhere else it goes to the treasury as before.
 */
export function sell(sim: Sim, a: Agent, building: number | undefined, item: 'meal' | 'coffee' | 'drink'): void {
  const amount = priceAt(sim, building, item, a);
  const biz = businessAt(sim, building);
  // The owner at their own counter pays what the food cost the town and nothing more: no tax, nothing through the till.
  if (!biz || biz.owner === null || biz.owner === a.id) {
    spend(sim, a, amount);
    return;
  }
  const pay = Math.min(Math.max(0, a.money), amount);
  a.money -= pay;
  const tax = pay * taxRate(sim);
  sim.treasury += tax;
  sim.ledger.taxes += tax;
  biz.till += pay - tax;
  biz.takings += pay;
  biz.today += pay;
  biz.costs += tax;
  biz.served++;
  if (item === 'meal') {
    const food = price(sim, 'food');
    biz.till -= food;
    biz.costs += food;
    sim.treasury += food;
    sim.ledger.sales += food;
  }
}

/** Years before retirement inside which nobody starts a place (people age two years a day): they'd hand it on almost at once. */
const RETIRE_MARGIN = 8;

/**
 * Who'd propose a business of this kind, if anyone: the minimum savings, the trade for it, the itch to run something
 * and some years left to work. The best fit and the keenest win, not the richest, so a founder short of the cost
 * borrows the rest from the town.
 */
export function founderFor(sim: Sim, kind: BusinessKind): Agent | undefined {
  const def = BUSINESSES[kind];
  const fit = (a: Agent) => (kind === 'bakery' ? a.skills.cooking.level : a.skills.charisma.level + (a.traits.includes('extrovert') ? 2 : 0));
  const keen = (a: Agent) => a.traits.filter((t) => (ENTERPRISING as readonly string[]).includes(t)).length;
  return sim.agents
    .filter((a) => ageOf(sim, a) >= ADULT_AGE && ageOf(sim, a) < RETIRE_AGE - RETIRE_MARGIN && a.role !== 'retired' && !a.illness && !ownedBy(sim, a) && sim.mayor !== a.id)
    .filter((a) => a.money >= def.savings && fit(a) >= 3 && keen(a) > 0)
    // Of those who qualify the better fit, then the keener; between equals the one with less behind them (and so more reason to try).
    .sort((x, y) => fit(y) * 40 + keen(y) * 15 - (fit(x) * 40 + keen(x) * 15) || x.money - y.money || x.id - y.id)[0];
}

/** What the founder pays for the building: the town's plot fee and the materials at their usual prices. */
export function buildCost(kind: BusinessKind): number {
  const bp = BLUEPRINTS[kind];
  return bp.coins + Object.entries(bp.cost).reduce((n, [g, k]) => n + (k ?? 0) * BASE_PRICE[g as Good], 0);
}

/** Opens the doors once the building is up: the owner takes the counter. */
export function openBusiness(sim: Sim, kind: BusinessKind, building: number, name: string, ownerId: number | undefined, loan: number): Business {
  const owner = sim.agent(ownerId);
  const biz: Business = {
    id: sim.businesses.length + 1,
    kind,
    building,
    name,
    owner: owner?.id ?? null,
    opened: sim.time,
    till: FLOAT,
    takings: 0,
    costs: 0,
    season: seasonIndex(sim),
    today: 0,
    yesterday: 0,
    served: 0,
    loan: owner ? loan : 0,
  };
  sim.businesses.push(biz);
  if (owner) {
    // Their trade now: if it ever closes they rejoin the labor pool without a claim on anyone's old job.
    owner.career = BUSINESSES[kind].role;
    setRole(sim, owner, BUSINESSES[kind].role, building);
    addMemory(sim, owner, 'ownBusiness');
    think(sim, owner, `${name}. My own place, at last.`, 'good');
    sim.log(`${name} opened its doors, run by ${first(owner)}`, 'build', 'good', owner).weight = HEADLINE;
  }
  return biz;
}

/**
 * The town buys a business: half what the building cost, with any loan taken out of it first, and the till's cash, go
 * to the owner, who finds other work. failed is false when the owner is gone for other reasons (they died, retired or
 * left town), so nobody mourns a business that didn't go under.
 */
export function closeBusiness(sim: Sim, biz: Business, why: string, failed = true): void {
  const owner = sim.agent(biz.owner ?? undefined);
  biz.owner = null;
  biz.closed = sim.time;
  const buyout = Math.round(buildCost(biz.kind) / 2);
  const cash = Math.max(0, biz.till);
  const repaid = Math.min(biz.loan, buyout + cash);
  const unpaid = biz.loan - repaid;
  sim.treasury -= buyout - repaid;
  sim.ledger.loans -= buyout - repaid;
  biz.loan = 0;
  biz.till = 0;
  if (owner) {
    owner.money += buyout + cash - repaid;
    // Back in the labor pool; the next round of job-filling finds them work, without reshuffling everyone now.
    setRole(sim, owner, 'laborer', null);
    if (failed) {
      addMemory(sim, owner, 'businessFailed');
      think(sim, owner, `I put everything into ${biz.name}. It wasn't enough.`, 'bad');
    }
  }
  sim.log(`${biz.name} closed (${why}). The town bought the building and keeps it open${unpaid > 0 ? `; $${Math.round(unpaid)} of the town's loan was never repaid` : ''}`, 'event', failed ? 'bad' : 'neutral', owner).weight = HEADLINE;
  sim.milestone(`${biz.name} closed`);
}

/** Why an owner is giving a place up, for the feed. */
export type Parting = 'died' | 'retired' | 'left';
const PARTING_WORD: Record<Parting, string> = { died: 'passed away', retired: 'retired', left: 'left town' };

/** When an owner dies, retires or moves away: their partner or eldest grown child carries on (not one leaving too), or the town buys it. */
export function succession(sim: Sim, a: Agent, parting: Parting = 'died', leaving: readonly Agent[] = []): void {
  const biz = ownedBy(sim, a);
  if (!biz) return;
  const heirs = [sim.agent(a.partner ?? undefined), ...a.children.map((id) => sim.agent(id)).sort((x, y) => (x?.birth ?? 0) - (y?.birth ?? 0))]
    .filter((h): h is Agent => !!h && h.id !== a.id && !leaving.includes(h) && ageOf(sim, h) >= ADULT_AGE && h.role !== 'retired' && !ownedBy(sim, h));
  const heir = heirs[0];
  if (!heir) return closeBusiness(sim, biz, `${first(a)} ${PARTING_WORD[parting]} and nobody could take it on`, false);
  biz.owner = heir.id;
  heir.career = BUSINESSES[biz.kind].role;
  setRole(sim, heir, BUSINESSES[biz.kind].role, biz.building);
  addMemory(sim, heir, 'ownBusiness');
  sim.log(`${first(heir)} took over ${biz.name} from ${first(a)}`, 'family', 'neutral', heir, a).weight = NOTABLE;
}

/** Leaves someone's savings to their partner, else their children, else the town. */
export function inherit(sim: Sim, a: Agent): void {
  const money = a.money;
  a.money = 0;
  passOnMoney(sim, a, money);
}

/** The share of grown-ups who count as well off: the top of the town's own distribution, so it stays scarce. */
const WELL_OFF_SHARE = 0.12;

/** How someone's money reads, beside their neighbours': "the richest person in town", "well off", "comfortable", "scraping by". */
export function wealthWord(sim: Sim, a: Agent): string {
  const adults = sim.agents.filter((o) => ageOf(sim, o) >= ADULT_AGE).map((o) => o.money).sort((x, y) => x - y);
  const median = adults.length ? adults[Math.floor(adults.length / 2)] : 0;
  const m = a.money;
  if (m < 3) return 'broke';
  if (m < 20) return 'scraping by';
  if (adults.length >= 4 && m === adults[adults.length - 1] && m > Math.max(150, median * 2)) return 'the richest person in town';
  // Well off is the top slice of the town, and only where it really is well above the middle.
  const above = adults.filter((x) => x > m).length;
  if (adults.length >= 4 && above / adults.length < WELL_OFF_SHARE && m > Math.max(150, median * 1.5)) return 'well off';
  if (m > median * 0.7) return 'comfortable';
  return 'getting by';
}

/** Midnight: the day's books, the owner's draw and loan payments, and a season's verdict on each business. */
export function settleBusinesses(sim: Sim): void {
  const season = seasonIndex(sim);
  for (const biz of sim.businesses) {
    biz.yesterday = biz.today;
    biz.today = 0;
    const owner = sim.agent(biz.owner ?? undefined);
    if (owner) {
      const upkeep = BUSINESSES[biz.kind].upkeep;
      biz.till -= upkeep;
      biz.costs += upkeep;
      sim.treasury += upkeep;
      sim.ledger.taxes += upkeep;
    }
    if (owner && biz.till > FLOAT) {
      const draw = biz.till - FLOAT;
      biz.till = FLOAT;
      const repay = biz.loan > 0 ? Math.min(biz.loan, draw * REPAY) : 0;
      biz.loan -= repay;
      sim.treasury += repay;
      sim.ledger.loans += repay;
      owner.money += draw - repay;
      if (repay > 0 && biz.loan <= 0.01) {
        biz.loan = 0;
        sim.log(`${first(owner)} paid back the town's loan for ${biz.name}`, 'event', 'good', owner).weight = NOTABLE;
      }
    }
    if (season !== biz.season) {
      // A full season open and still losing money: the books close it.
      const fullSeason = biz.opened <= (season - 1) * SEASON_DAYS * MIN_PER_DAY;
      if (owner && fullSeason && biz.takings - biz.costs < 0) closeBusiness(sim, biz, 'it lost money all season');
      else if (owner && fullSeason && biz.takings > 0) sim.log(`${biz.name} took $${Math.round(biz.takings)} last season, $${Math.round(biz.takings - biz.costs)} after costs`, 'event', 'good', owner);
      biz.season = season;
      biz.takings = 0;
      biz.costs = 0;
    }
  }
}

/**
 * A household is struggling when even its best-off grown member has less than STRUGGLING_SHARE of the town's median
 * savings, or when it's among the poorest fifth of homes and below BEHIND_SHARE of the median.
 */
const STRUGGLING_SHARE = 0.4;
const BEHIND_SHARE = 0.75;

/** Once an evening: a well-off household has a struggling one over for dinner. */
export function neighbourlyDinner(sim: Sim): void {
  if (sim.dinnerDay === sim.day || sim.hour < 18 || sim.hour > 19) return;
  sim.dinnerDay = sim.day;
  const adults = sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE);
  const sorted = adults.map((a) => a.money).sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const hosts = adults.filter((a) => a.money >= Math.max(200, median * 2.5) && sim.town.households[a.household].building >= 0).sort((x, y) => y.money - x.money);
  // Each home's best-off grown member; the poorest fifth of homes (when also well below the middle) count as struggling.
  const best = new Map<number, number>();
  for (const a of adults) best.set(a.household, Math.max(best.get(a.household) ?? -Infinity, a.money));
  const homes = [...best.entries()].filter(([id]) => sim.town.households[id].building >= 0).sort((x, y) => x[1] - y[1]);
  const poorestFifth = homes.length ? homes[Math.max(1, Math.floor(homes.length / 5)) - 1][1] : 0;
  const struggling = sim.town.households.filter((h) => {
    const grown = adults.filter((a) => a.household === h.id);
    // Not the same family two nights running: they were just over.
    const recently = grown.some((a) => a.memories.some((m) => m.kind === 'dinnerGuest' && sim.time - m.created < 2 * MIN_PER_DAY));
    if (h.building < 0 || !grown.length || recently) return false;
    const top = best.get(h.id)!;
    return top < Math.max(40, median * STRUGGLING_SHARE) || (top <= poorestFifth && top < median * BEHIND_SHARE);
  });
  const host = hosts[0];
  const guests = struggling.find((h) => h.id !== host?.household);
  // Dice of its own, so a town's story doesn't shift just because someone could have hosted.
  const dice = new Rng(sim.seed * 4271 + sim.day * 7919);
  dice.next();
  if (!host || !guests || !dice.chance(host.traits.includes('extrovert') || host.money > 600 ? 0.8 : 0.5)) return;
  const hostFam = sim.agents.filter((a) => a.household === host.household);
  const guestFam = sim.agents.filter((a) => a.household === guests.id);
  host.money -= 6 * guestFam.length;
  sim.pantry[guests.id] += 3;
  for (const h of hostFam) {
    addMemory(sim, h, 'hostedDinner');
    for (const g of guestFam) bump(h, g, 6);
  }
  for (const g of guestFam) {
    addMemory(sim, g, 'dinnerGuest');
    think(sim, g, `Dinner at ${first(host)}'s. They sent us home with leftovers.`, 'good');
    for (const h of hostFam) bump(g, h, 10);
  }
  const grownGuests = guestFam.filter((g) => ageOf(sim, g) >= ADULT_AGE).map(first);
  const kids = guestFam.length - grownGuests.length;
  const who = `${grownGuests.join(' and ')}${kids ? ` and ${kids === 1 ? 'their kid' : 'the kids'}` : ''}`;
  sim.log(`${first(host)}${hostFam.length > 1 ? "'s family" : ''} had ${who} over for dinner`, 'social', 'good', host, guestFam[0]).weight = NOTABLE;
}

function bump(a: Agent, b: Agent, by: number): void {
  const r = a.relations.get(b.id) ?? { opinion: 0, familiarity: 0, lastTalk: -Infinity };
  r.opinion = Math.min(100, r.opinion + by);
  r.familiarity = Math.min(100, r.familiarity + 10);
  a.relations.set(b.id, r);
}
