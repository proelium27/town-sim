import { describe, expect, it } from 'vitest';
import { SEASON_DAYS } from '../src/sim/defs';
import { BASE_PRICE, price, tickMarket, trade } from '../src/sim/market';
import { Sim } from '../src/sim/sim';
import { addMemory } from '../src/sim/social';

describe('prices', () => {
  it('rise when the stores run low and fall in a glut', () => {
    const sim = new Sim(7);
    sim.stock.food = 0;
    expect(price(sim, 'food')).toBeGreaterThan(BASE_PRICE.food * 2);
    sim.stock.food = 2000;
    expect(price(sim, 'food')).toBeLessThan(BASE_PRICE.food * 0.6);
  });

  it('climb through summer toward winter instead of jumping overnight when autumn starts', () => {
    const sim = new Sim(7);
    sim.stock.food = 100;
    sim.stock.firewood = 40;
    const at = (day: number) => {
      sim.time = day * 1440;
      return { food: price(sim, 'food'), firewood: price(sim, 'firewood') };
    };
    const spring = at(SEASON_DAYS - 0.01);
    const midSummer = at(SEASON_DAYS * 1.5);
    const lateSummer = at(2 * SEASON_DAYS - 0.01);
    const autumn = at(2 * SEASON_DAYS + 0.01);
    for (const g of ['food', 'firewood'] as const) {
      expect(midSummer[g]).toBeGreaterThan(spring[g]);
      expect(midSummer[g]).toBeLessThan(autumn[g]);
      expect(Math.abs(autumn[g] - lateSummer[g])).toBeLessThan(lateSummer[g] * 0.05);
    }
  });
});

describe('the trader', () => {
  it('buys surplus for the treasury and sells what the town is short of', () => {
    const sim = new Sim(7);
    sim.stock.stone = 500;
    sim.stock.firewood = 0;
    sim.time = 6 * 1440 + 12 * 60;
    const before = sim.treasury;
    const what = trade(sim);
    expect(what).toMatch(/sold \d+ stone/);
    expect(what).toMatch(/bought \d+ firewood/);
    expect(sim.stock.stone).toBeLessThan(500);
    expect(sim.stock.firewood).toBeGreaterThan(0);
    expect(sim.treasury).not.toBe(before);
  });

  it('turns up by road every few days and trades at the market', () => {
    const sim = new Sim(7);
    sim.run(1440 + 13 * 60 - sim.time);
    expect(sim.activity.some((e) => e.text.startsWith('The trader stopped at the market'))).toBe(true);
  }, 60_000);
});

describe('the treasury', () => {
  it('pays town wages, takes shop sales and taxes, and stays solvent on default settings', () => {
    const sim = new Sim(7);
    sim.run(3 * 1440);
    expect(sim.lastLedger.wages).toBeGreaterThan(0);
    expect(sim.lastLedger.sales).toBeGreaterThan(0);
    expect(sim.lastLedger.taxes).toBeGreaterThan(0);
    expect(sim.treasury).toBeGreaterThan(50);
  }, 60_000);

  it("a broke town can't start new buildings (except homes for the homeless)", () => {
    const sim = new Sim(7);
    sim.run(60);
    sim.treasury = 0;
    sim.projects = [];
    sim.run(6 * 60);
    expect(sim.projects.every((p) => p.blueprint === 'house' && p.forAgents.length > 0)).toBe(true);
  }, 60_000);
});

describe('hard times', () => {
  it('a household broke and miserable for two days packs up and leaves town', () => {
    const sim = new Sim(7);
    sim.run(60);
    const hh = sim.town.households.find((h) => h.building >= 0 && sim.agents.filter((a) => a.household === h.id).length >= 2)!;
    const fam = sim.agents.filter((a) => a.household === hh.id);
    const pop = sim.agents.length;
    for (let d = 0; d < 2; d++) {
      for (const a of fam) {
        a.money = 0;
        a.mood = 10;
        addMemory(sim, a, 'broke');
      }
      sim.time = Math.ceil((sim.time + 1) / 1440) * 1440 + 1;
      tickMarket(sim);
    }
    expect(sim.agents.length).toBe(pop - fam.length);
    expect(sim.departed).toEqual(expect.arrayContaining(fam));
    expect(sim.activity.some((e) => e.text.startsWith('Hard times:'))).toBe(true);
  });
});
