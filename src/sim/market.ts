import { type Good, GOOD_KEYS, goodNoun, MIN_PER_DAY, ROLES, SEASON_DAYS } from './defs';
import { addMemory, first, kinship, shiftOpinion, think } from './social';
import type { Sim } from './sim';
import { depart } from './travel';
import { settleBusinesses } from './business';
import { bonusShare, taxRate } from './civic';
import { HEADLINE, NOTABLE, type Agent } from './types';
import type { Household } from '../world/town';
import { targetOf } from './workshop';

/** What a unit of each good is worth when the town has just the right amount. */
export const BASE_PRICE: Record<Good, number> = { food: 3, wood: 1, stone: 1, firewood: 1.5, planks: 2, bricks: 2, furniture: 24, tools: 10, herbs: 1.5, medicine: 8 };
/** The office earns from outside clients and pays this share in tax. */
export const TAX = 0.15;
/** Town jobs are paid from the treasury at this share of the nominal rate. */
export const TOWN_WAGE = 0.45;
/** A trader's cart visits every few days. */
export const TRADER_EVERY = 3;

/** How far the town is into stocking up for winter: none in spring, ramping up through summer, full from autumn on. */
export function winterPrep(sim: Sim): number {
  return sim.season >= 2 ? 1 : sim.season === 1 ? sim.seasonProgress : 0;
}

/** How much of a good the town is comfortable holding; prices rise below it and fall above it. */
export function wantOf(sim: Sim, g: Good): number {
  const people = sim.agents.length;
  const homes = sim.town.households.filter((h) => h.building >= 0).length;
  switch (g) {
    case 'food': {
      // Through autumn and winter, keep enough to eat until the spring crops come in; summer builds up to it.
      const toSpring = sim.season >= 2 ? (4 - sim.season - sim.seasonProgress) * SEASON_DAYS : winterPrep(sim) * 2 * SEASON_DAYS;
      return people * (6 + 2.6 * toSpring);
    }
    case 'wood': return 90;
    case 'stone': return 60;
    case 'herbs': return 12;
    case 'medicine': return Math.max(4, Math.ceil(people / 5));
    case 'firewood': return homes * (4 + 8 * winterPrep(sim));
    default: return Math.max(2, targetOf(sim, g));
  }
}

export function price(sim: Sim, g: Good): number {
  const ratio = (wantOf(sim, g) + 8) / (sim.stock[g] + 8);
  return Math.round(BASE_PRICE[g] * Math.min(3, Math.max(0.5, ratio)) * 100) / 100;
}

/**
 * Pays someone for a stretch of work. Office staff are paid by outside clients and taxed;
 * everyone else works for the town and is paid from the treasury, if it can.
 */
export function payWage(sim: Sim, a: Agent, nominal: number): void {
  // Owners draw their pay from their own till each night.
  if (a.role === 'baker' || a.role === 'innkeeper') return;
  if (ROLES[a.role].workplace === 'office') {
    const tax = taxRate(sim);
    a.money += nominal * (1 - tax);
    sim.treasury += nominal * tax;
    sim.ledger.taxes += nominal * tax;
    return;
  }
  const w = nominal * TOWN_WAGE;
  if (sim.treasury >= w) {
    sim.treasury -= w;
    a.money += w;
    sim.ledger.wages += w;
  } else if (!a.memories.some((m) => m.kind === 'unpaid')) {
    addMemory(sim, a, 'unpaid');
    think(sim, a, "The town couldn't pay us today.", 'bad');
  }
}

/** Someone buys from a town shop; the money goes to the treasury. False if they can't afford it. */
export function spend(sim: Sim, a: Agent, amount: number): boolean {
  if (a.money < amount) return false;
  a.money -= amount;
  sim.treasury += amount;
  sim.ledger.sales += amount;
  return true;
}

/** The relative with the most savings who could spare this much, if any. */
function familyHelper(sim: Sim, a: Agent, amount: number): Agent | undefined {
  return sim.agents
    .filter((o) => o.id !== a.id && kinship(sim, a, o) && o.money > amount + 40)
    .sort((x, y) => y.money - x.money)[0];
}

/** The smallest grocery basket worth the trip, in units of food. */
export const MIN_BASKET = 2;
/** After coming home empty-handed, don't try the market again for this long. */
export const BROKE_RETRY = 4 * 60;
/** What someone short of grocery money asks the family for. */
export const familyAsk = (sim: Sim): number => Math.ceil(price(sim, 'food') * 5);

/** Whether a grocery trip would come home with at least a small basket, with family help if needed. */
export function canAffordGroceries(sim: Sim, a: Agent): boolean {
  return a.money >= price(sim, 'food') * MIN_BASKET || !!familyHelper(sim, a, familyAsk(sim));
}

/** Short of money for groceries: someone in the family with savings chips in. */
export function askFamilyForHelp(sim: Sim, a: Agent, amount: number): boolean {
  const giver = familyHelper(sim, a, amount);
  if (!giver) return false;
  giver.money -= amount;
  a.money += amount;
  shiftOpinion(sim, a, giver, 4);
  think(sim, a, `${first(giver)} helped me out with money for food.`, 'good');
  sim.log(`${first(giver)} helped ${first(a)} with money for groceries`, 'family', 'good', giver, a);
  return true;
}

/** Goods that would sell or that the town needs, for the trader: [good, amount, price]. */
function tradeList(sim: Sim): { sell: [Good, number, number][]; buy: [Good, number, number][] } {
  const sell: [Good, number, number][] = [];
  const buy: [Good, number, number][] = [];
  for (const g of GOOD_KEYS) {
    const want = wantOf(sim, g);
    const have = sim.stock[g];
    const p = price(sim, g);
    if (have > want * 1.5 + 10) sell.push([g, Math.floor(have - want * 1.2), Math.round(p * 0.8 * 100) / 100]);
    else if (have < want * 0.5 && (g === 'food' || g === 'firewood' || g === 'tools')) buy.push([g, Math.ceil(want * 0.8 - have), Math.round(p * 1.3 * 100) / 100]);
  }
  return { sell, buy };
}

/** What trade() reports when the town had nothing to sell and bought nothing. */
export const NO_TRADE = 'nothing changed hands';

/**
 * The trader buys the town's surplus and sells what it's short of, as far as the treasury allows.
 * Like a new building, the shopping has to leave a day's payroll behind.
 */
export function trade(sim: Sim): string {
  const { sell, buy } = tradeList(sim);
  const parts: string[] = [];
  let earned = 0;
  for (const [g, n, p] of sell) {
    sim.stock[g] -= n;
    earned += n * p;
    parts.push(`sold ${n} ${goodNoun(n, g)}`);
  }
  sim.treasury += earned;
  sim.ledger.trade += earned;
  const keep = projectCushion(sim);
  for (const [g, n, p] of buy) {
    const afford = Math.min(n, Math.floor((sim.treasury - keep) / p));
    if (afford <= 0) continue;
    sim.stock[g] += afford;
    sim.treasury -= afford * p;
    sim.ledger.trade -= afford * p;
    parts.push(`bought ${afford} ${goodNoun(afford, g)}`);
  }
  return parts.length ? parts.join(', ') : NO_TRADE;
}

/** The trader's stop at the market, for the activity log: what changed hands, or a quiet note on why nothing did. */
export function traderVisit(sim: Sim): void {
  const short = tradeList(sim).buy.length > 0;
  const done = trade(sim);
  if (done !== NO_TRADE) sim.log(`The trader stopped at the market: ${done}`, 'event', 'good').weight = NOTABLE;
  else sim.log(`The trader came by, but the town had nothing to sell and ${short ? 'no money to spare' : 'needed nothing'}`, 'event', 'neutral');
}

/** loans: repayments in, less money lent out to business founders. */
export type Ledger = { sales: number; taxes: number; wages: number; trade: number; projects: number; pensions: number; bonuses: number; loans: number };
export const emptyLedger = (): Ledger => ({ sales: 0, taxes: 0, wages: 0, trade: 0, projects: 0, pensions: 0, bonuses: 0, loans: 0 });

/** Days in a row a household has to be broke and miserable before it gives up and leaves. */
export const HARD_DAYS = 3;
/** What the town pays a retiree a day, so the old folks aren't broke by definition. Savers above the cap go without. */
export const PENSION = 12;
export const PENSION_CAP = 60;
/**
 * The treasury keeps this many days of payroll before it shares the rest, and never less than
 * RESERVE_MIN (winter payrolls are small, but spring brings the trader and a busy building season).
 */
export const RESERVE_DAYS = 3;
export const RESERVE_MIN = 900;
/** A new building has to leave a day's payroll in the treasury, and at least this much (spring payrolls run high). */
export const PROJECT_CUSHION = 250;
export const projectCushion = (sim: Sim): number => Math.max(PROJECT_CUSHION, sim.lastLedger.wages);
/** Share of the money above the reserve paid out each midnight as bonuses to town workers. */
export const BONUS_SHARE = 0.5;
/** Town workers below this are topped up to it at midnight, as long as the treasury keeps HARDSHIP_KEEP. */
export const HARDSHIP_FLOOR = 12;
export const HARDSHIP_KEEP = 100;

/** Town jobs: everyone working who isn't paid by the office's outside clients. */
export const townPaid = (a: Agent): boolean => a.role !== 'child' && a.role !== 'retired' && ROLES[a.role].workplace !== 'office';

/** Pensions for retirees, a top-up for town workers who are nearly broke, then part of any surplus back to them, poorest first. */
function payOut(sim: Sim): void {
  for (const a of sim.agents) {
    if (a.role !== 'retired' || a.money >= PENSION_CAP || sim.treasury < PENSION) continue;
    sim.treasury -= PENSION;
    a.money += PENSION;
    sim.ledger.pensions += PENSION;
  }
  const workers = sim.agents.filter(townPaid);
  // Anyone down to their last few dollars (a farmer through the winter, say) is topped up while the town can spare it.
  for (const a of workers) {
    const need = Math.ceil(HARDSHIP_FLOOR - a.money);
    if (need <= 0 || sim.treasury - need < HARDSHIP_KEEP) continue;
    a.money += need;
    sim.treasury -= need;
    sim.ledger.bonuses += need;
    think(sim, a, 'The town helped me out while money is tight.', 'good');
  }
  const reserve = Math.max(RESERVE_MIN, RESERVE_DAYS * sim.lastLedger.wages);
  const pot = Math.floor((sim.treasury - reserve) * bonusShare(sim));
  if (pot < 20 || !workers.length) return;
  // Weighted to those with the least: someone down to their last dollar gets several times a saver's share.
  const weight = (a: Agent) => 1 / (Math.max(0, a.money) + 25);
  const total = workers.reduce((s, a) => s + weight(a), 0);
  for (const a of workers) a.money += (pot * weight(a)) / total;
  sim.treasury -= pot;
  sim.ledger.bonuses += pot;
  sim.log(`The town paid out $${pot} in bonuses`, 'event', 'good');
}

/**
 * Midnight bookkeeping: yesterday's ledger, pensions and bonuses, and households in hard times.
 * A household stuck miserable and broke for several days in a row packs up and leaves town.
 */
export function tickMarket(sim: Sim): void {
  const day = Math.floor(sim.time / MIN_PER_DAY);
  if (sim.ledgerDay === day) return;
  sim.ledgerDay = day;
  sim.lastLedger = { ...sim.ledger };
  sim.ledger = emptyLedger();
  payOut(sim);
  settleBusinesses(sim);
  for (const h of sim.town.households) {
    const fam = sim.agents.filter((a) => a.household === h.id);
    if (!fam.length) continue;
    const grown = fam.filter((a) => a.role !== 'child');
    const broke = grown.length > 0 && grown.every((a) => a.money < 10 || a.memories.some((m) => m.kind === 'broke'));
    const mood = fam.reduce((s, a) => s + a.mood, 0) / fam.length;
    sim.hardDays[h.id] = broke && mood < 35 ? (sim.hardDays[h.id] ?? 0) + 1 : 0;
    if (sim.hardDays[h.id] >= HARD_DAYS) leaveTown(sim, fam, h);
  }
}

function leaveTown(sim: Sim, fam: Agent[], h: Household): void {
  sim.hardDays[h.id] = 0;
  const home = h.name;
  const names = fam.map(first).join(', ');
  sim.log(`Hard times: ${names} packed up and left the ${home}`, 'family', 'bad', fam[0]).weight = HEADLINE;
  depart(sim, fam);
  sim.milestone(`${names} left ${sim.name}`);
}
