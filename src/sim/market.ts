import { type Good, GOOD_KEYS, GOODS, MIN_PER_DAY, ROLES } from './defs';
import { addMemory, first, kinship, shiftOpinion, think } from './social';
import type { Sim } from './sim';
import type { Agent } from './types';
import { targetOf } from './workshop';

/** What a unit of each good is worth when the town has just the right amount. */
export const BASE_PRICE: Record<Good, number> = { food: 3, wood: 1, stone: 1, firewood: 1.5, planks: 2, bricks: 2, furniture: 24, tools: 10, herbs: 1.5, medicine: 8 };
/** The office earns from outside clients and pays this share in tax. */
export const TAX = 0.15;
/** Town jobs are paid from the treasury at this share of the nominal rate. */
export const TOWN_WAGE = 0.45;
/** A trader's cart visits every few days. */
export const TRADER_EVERY = 3;

/** How much of a good the town is comfortable holding; prices rise below it and fall above it. */
export function wantOf(sim: Sim, g: Good): number {
  const people = sim.agents.length;
  const homes = sim.town.households.filter((h) => h.building >= 0).length;
  switch (g) {
    case 'food': {
      // Through autumn and winter, keep enough to eat until the spring crops come in.
      const toSpring = sim.season >= 2 ? (4 - sim.season) * 2 - sim.seasonProgress * 2 : 0;
      return people * (6 + 2.6 * toSpring);
    }
    case 'wood': return 90;
    case 'stone': return 60;
    case 'herbs': return 12;
    case 'medicine': return Math.max(4, Math.ceil(people / 5));
    case 'firewood': return homes * (sim.season >= 2 ? 12 : 4);
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
  if (ROLES[a.role].workplace === 'office') {
    a.money += nominal * (1 - TAX);
    sim.treasury += nominal * TAX;
    sim.ledger.taxes += nominal * TAX;
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

/** Short of money for groceries: someone in the family with savings chips in. */
export function askFamilyForHelp(sim: Sim, a: Agent, amount: number): boolean {
  const giver = sim.agents
    .filter((o) => o.id !== a.id && kinship(sim, a, o) && o.money > amount + 40)
    .sort((x, y) => y.money - x.money)[0];
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

/** The trader buys the town's surplus and sells what it's short of, as far as the treasury allows. */
export function trade(sim: Sim): string {
  const { sell, buy } = tradeList(sim);
  const parts: string[] = [];
  let earned = 0;
  for (const [g, n, p] of sell) {
    sim.stock[g] -= n;
    earned += n * p;
    parts.push(`sold ${n} ${GOODS[g].label.toLowerCase()}`);
  }
  sim.treasury += earned;
  sim.ledger.trade += earned;
  for (const [g, n, p] of buy) {
    const afford = Math.min(n, Math.floor(sim.treasury / p));
    if (afford <= 0) continue;
    sim.stock[g] += afford;
    sim.treasury -= afford * p;
    sim.ledger.trade -= afford * p;
    parts.push(`bought ${afford} ${GOODS[g].label.toLowerCase()}`);
  }
  return parts.length ? parts.join(', ') : 'nothing changed hands';
}

/**
 * Midnight bookkeeping: yesterday's ledger, and households in hard times. A household stuck
 * miserable and broke for a couple of days packs up and leaves town.
 */
export function tickMarket(sim: Sim): void {
  const day = Math.floor(sim.time / MIN_PER_DAY);
  if (sim.ledgerDay === day) return;
  sim.ledgerDay = day;
  sim.lastLedger = { ...sim.ledger };
  sim.ledger = { sales: 0, taxes: 0, wages: 0, trade: 0, projects: 0 };
  for (const h of sim.town.households) {
    const fam = sim.agents.filter((a) => a.household === h.id);
    if (!fam.length) continue;
    const grown = fam.filter((a) => a.role !== 'child');
    const broke = grown.length > 0 && grown.every((a) => a.money < 10 || a.memories.some((m) => m.kind === 'broke'));
    const mood = fam.reduce((s, a) => s + a.mood, 0) / fam.length;
    sim.hardDays[h.id] = broke && mood < 35 ? (sim.hardDays[h.id] ?? 0) + 1 : 0;
    if (sim.hardDays[h.id] >= 2) leaveTown(sim, fam, h.name);
  }
}

function leaveTown(sim: Sim, fam: Agent[], home: string): void {
  for (const a of fam) {
    if (a.action.propId !== undefined && sim.reserved.get(a.action.propId) === a.id) sim.reserved.delete(a.action.propId);
    for (const o of sim.agents) if (o.partner === a.id && !fam.includes(o)) o.partner = null;
  }
  const ids = new Set(fam.map((a) => a.id));
  sim.agents = sim.agents.filter((a) => !ids.has(a.id));
  sim.departed.push(...fam);
  sim.populationVersion++;
  const names = fam.map(first).join(', ');
  sim.log(`Hard times: ${names} packed up and left the ${home}`, 'family', 'bad', fam[0]);
  sim.milestone(`${names} left Northwind`);
}
