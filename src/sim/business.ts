import { ageOf } from './agents';
import { ADULT_AGE, MIN_PER_DAY, type RoleKey, SEASON_DAYS } from './defs';
import { BASE_PRICE, price, spend } from './market';
import { taxRate } from './civic';
import { setRole } from './planner';
import { addMemory, first, think } from './social';
import { Rng } from './rng';
import type { Sim } from './sim';
import { type Agent, HEADLINE, NOTABLE } from './types';

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

/** What something costs here: a meal, a coffee, or a drink at the tavern. */
export function priceAt(sim: Sim, building: number | undefined, item: 'meal' | 'coffee' | 'drink'): number {
  const base = item === 'meal' ? townMeal(sim) : item === 'coffee' ? 3 : 5;
  const biz = businessAt(sim, building);
  return biz?.owner != null ? Math.max(1, Math.round(base * priceMood(sim))) : base;
}

/**
 * A customer pays. At a privately run place the money goes in the till, less the town's cut, and a meal's food is
 * bought from the town's stores; anywhere else it goes to the treasury as before.
 */
export function sell(sim: Sim, a: Agent, building: number | undefined, item: 'meal' | 'coffee' | 'drink'): void {
  const amount = priceAt(sim, building, item);
  const biz = businessAt(sim, building);
  if (!biz || biz.owner === null) {
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

/** Who'd propose a business of this kind, if anyone: savings, the trade for it, and the itch to run something. */
export function founderFor(sim: Sim, kind: BusinessKind): Agent | undefined {
  const def = BUSINESSES[kind];
  const fit = (a: Agent) => (kind === 'bakery' ? a.skills.cooking.level : a.skills.charisma.level + (a.traits.includes('extrovert') ? 2 : 0));
  return sim.agents
    .filter((a) => ageOf(sim, a) >= ADULT_AGE && a.role !== 'retired' && !a.illness && !ownedBy(sim, a) && sim.mayor !== a.id)
    .filter((a) => a.money >= def.savings && fit(a) >= 3 && a.traits.some((t) => (ENTERPRISING as readonly string[]).includes(t)))
    .sort((x, y) => fit(y) * 40 + y.money - (fit(x) * 40 + x.money))[0];
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

/** The town buys a business: the owner gets back half what the building cost, less any loan, and finds other work. */
export function closeBusiness(sim: Sim, biz: Business, why: string): void {
  const owner = sim.agent(biz.owner ?? undefined);
  biz.owner = null;
  biz.closed = sim.time;
  const buyout = 60;
  const repaid = Math.min(biz.loan, buyout + Math.max(0, biz.till));
  const unpaid = biz.loan - repaid;
  sim.treasury -= buyout - repaid;
  sim.ledger.loans -= buyout - repaid;
  biz.loan = 0;
  biz.till = 0;
  if (owner) {
    owner.money += Math.max(0, buyout - repaid);
    addMemory(sim, owner, 'businessFailed');
    think(sim, owner, `I put everything into ${biz.name}. It wasn't enough.`, 'bad');
    // Back in the labor pool; the next round of job-filling finds them work, without reshuffling everyone now.
    setRole(sim, owner, 'laborer', null);
  }
  sim.log(`${biz.name} closed (${why}). The town bought the building and keeps it open${unpaid > 0 ? `; $${Math.round(unpaid)} of the town's loan was never repaid` : ''}`, 'event', 'bad', owner).weight = HEADLINE;
  sim.milestone(`${biz.name} closed`);
}

/** When an owner dies or moves away: their partner or a grown child carries on, or the town buys it. */
export function succession(sim: Sim, a: Agent): void {
  const biz = ownedBy(sim, a);
  if (!biz) return;
  const heirs = [sim.agent(a.partner ?? undefined), ...a.children.map((id) => sim.agent(id)).sort((x, y) => (x?.birth ?? 0) - (y?.birth ?? 0))]
    .filter((h): h is Agent => !!h && h.id !== a.id && ageOf(sim, h) >= ADULT_AGE && h.role !== 'retired' && !ownedBy(sim, h));
  const heir = heirs[0];
  if (!heir) return closeBusiness(sim, biz, `${first(a)} is gone and nobody could take it on`);
  biz.owner = heir.id;
  heir.career = BUSINESSES[biz.kind].role;
  setRole(sim, heir, BUSINESSES[biz.kind].role, biz.building);
  addMemory(sim, heir, 'ownBusiness');
  sim.log(`${first(heir)} took over ${biz.name} from ${first(a)}`, 'family', 'neutral', heir, a).weight = NOTABLE;
}

/** Leaves someone's savings to their partner, else their children, else the town. */
export function inherit(sim: Sim, a: Agent): void {
  const money = Math.floor(Math.max(0, a.money));
  a.money = 0;
  if (money <= 0) return;
  const partner = sim.agent(a.partner ?? undefined);
  const kids = a.children.map((id) => sim.agent(id)).filter((k): k is Agent => !!k);
  const heirs = partner ? [partner] : kids;
  if (!heirs.length) {
    sim.treasury += money;
    sim.ledger.sales += money;
    if (money >= 20) sim.log(`${first(a)} left $${money} to the town`, 'family', 'neutral', a).weight = NOTABLE;
    return;
  }
  for (const h of heirs) h.money += money / heirs.length;
  if (money >= 20) sim.log(`${first(a)} left $${money} to ${heirs.map(first).join(' and ')}`, 'family', 'neutral', heirs[0], a).weight = NOTABLE;
}

/** How someone's money reads, beside their neighbours': "the richest person in town", "comfortable", "scraping by". */
export function wealthWord(sim: Sim, a: Agent): string {
  const adults = sim.agents.filter((o) => ageOf(sim, o) >= ADULT_AGE).map((o) => o.money).sort((x, y) => x - y);
  const median = adults.length ? adults[Math.floor(adults.length / 2)] : 0;
  const m = a.money;
  if (m < 3) return 'broke';
  if (m < 20) return 'scraping by';
  if (adults.length >= 4 && m === adults[adults.length - 1] && m > Math.max(150, median * 2)) return 'the richest person in town';
  if (m > Math.max(250, median * 2.2)) return 'well off';
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

/** Once an evening: a well-off household has a struggling one over for dinner. */
export function neighbourlyDinner(sim: Sim): void {
  if (sim.dinnerDay === sim.day || sim.hour < 18 || sim.hour > 19) return;
  sim.dinnerDay = sim.day;
  const adults = sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE);
  const sorted = adults.map((a) => a.money).sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const hosts = adults.filter((a) => a.money >= Math.max(200, median * 2.5) && sim.town.households[a.household].building >= 0).sort((x, y) => y.money - x.money);
  const struggling = sim.town.households.filter((h) => {
    const grown = adults.filter((a) => a.household === h.id);
    // Not the same family two nights running: they were just over.
    const recently = grown.some((a) => a.memories.some((m) => m.kind === 'dinnerGuest' && sim.time - m.created < 2 * MIN_PER_DAY));
    return h.building >= 0 && grown.length > 0 && !recently && grown.every((a) => a.money < Math.max(40, median * 0.25));
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
