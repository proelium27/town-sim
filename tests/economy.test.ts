import { describe, expect, it } from 'vitest';
import { SEASON_DAYS } from '../src/sim/defs';
import { BASE_PRICE, BROKE_RETRY, canAffordGroceries, HARD_DAYS, HARDSHIP_FLOOR, HARDSHIP_KEEP, price, projectCushion, RESERVE_MIN, tickMarket, townPaid, trade } from '../src/sim/market';
import { Sim } from '../src/sim/sim';
import { addMemory, kinship } from '../src/sim/social';
import type { Agent } from '../src/sim/types';

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

  it("doesn't spend the day's payroll on its wares", () => {
    const sim = new Sim(7);
    sim.stock.firewood = 0;
    sim.stock.tools = 0;
    sim.time = 6 * 1440 + 12 * 60;
    sim.lastLedger.wages = 320;
    sim.treasury = 370;
    expect(trade(sim)).toMatch(/bought \d+ firewood/);
    expect(sim.treasury).toBeGreaterThanOrEqual(projectCushion(sim));
    expect(sim.treasury).toBeLessThan(370);
    sim.treasury = 200;
    expect(trade(sim)).toBe('nothing changed hands');
    expect(sim.treasury).toBe(200);
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
    sim.projects = [];
    // Keep it broke: shop takings would otherwise refill it within hours.
    for (let k = 0; k < 12; k++) {
      sim.treasury = 0;
      sim.run(30);
    }
    expect(sim.projects.every((p) => p.blueprint === 'house' && p.forAgents.length > 0)).toBe(true);
  }, 60_000);
});

/** Jumps to just after the next midnight and runs the day's bookkeeping. */
function midnight(sim: Sim): void {
  sim.time = Math.ceil((sim.time + 1) / 1440) * 1440 + 1;
  tickMarket(sim);
}

describe('bonuses', () => {
  it('share a surplus above a few days of payroll with town workers, the poorest getting most', () => {
    const sim = new Sim(7);
    sim.run(60);
    const workers = sim.agents.filter(townPaid);
    const office = sim.agents.find((a) => a.role === 'engineer')!;
    const [poor, rich] = workers;
    poor.money = 1;
    rich.money = 300;
    const officeBefore = office.money;
    sim.ledger.wages = 300;
    sim.treasury = 3000;
    midnight(sim);
    expect(sim.treasury).toBeLessThan(2500);
    expect(sim.treasury).toBeGreaterThan(Math.max(RESERVE_MIN, 3 * 300));
    expect(poor.money - 1).toBeGreaterThan(3 * (rich.money - 300));
    expect(rich.money).toBeGreaterThan(300);
    expect(office.money).toBe(officeBefore);
    expect(sim.lastLedger.bonuses + sim.ledger.bonuses).toBeGreaterThan(0);
    expect(sim.activity.filter((e) => e.text.startsWith('The town paid out $')).length).toBe(1);
  });

  it('are not paid while the treasury is only holding its reserve', () => {
    const sim = new Sim(7);
    sim.run(60);
    for (const a of sim.agents.filter(townPaid)) a.money = 50;
    sim.ledger.wages = 300;
    sim.treasury = 800;
    midnight(sim);
    expect(sim.ledger.bonuses).toBe(0);
    expect(sim.activity.some((e) => e.text.startsWith('The town paid out'))).toBe(false);
  });

  it('top up a town worker down to their last dollars, but not out of the last of the treasury', () => {
    const sim = new Sim(7);
    sim.run(60);
    for (const a of sim.agents) a.money = 100;
    const workers = sim.agents.filter(townPaid);
    const [farmer] = workers;
    farmer.money = 2;
    sim.treasury = 300;
    midnight(sim);
    expect(farmer.money).toBe(HARDSHIP_FLOOR);
    expect(workers[1].money).toBe(100);
    expect(sim.treasury).toBe(300 - (HARDSHIP_FLOOR - 2));
    farmer.money = 2;
    sim.treasury = HARDSHIP_KEEP;
    midnight(sim);
    expect(farmer.money).toBe(2);
    expect(sim.treasury).toBe(HARDSHIP_KEEP);
  });
});

describe('the town economy over a few weeks', () => {
  // Long runs are slow, so this covers a couple of game years (14 days) rather than a month.
  for (const seed of [7, 11]) {
    it(`seed ${seed}: the treasury stays solvent, shares its surplus, and no town worker stays broke`, () => {
      const sim = new Sim(seed);
      let low = Infinity;
      let bonuses = 0;
      const broke = new Map<number, number>();
      let longest = 0;
      for (let d = 0; d < 14; d++) {
        for (let h = 0; h < 24; h++) {
          sim.run(60);
          low = Math.min(low, sim.treasury);
          if (Math.floor(sim.hour) === 0) bonuses += sim.ledger.bonuses;
        }
        for (const a of sim.agents.filter(townPaid)) {
          const days = a.money < 5 ? (broke.get(a.id) ?? 0) + 1 : 0;
          broke.set(a.id, days);
          longest = Math.max(longest, days);
        }
      }
      expect(low).toBeGreaterThan(50);
      expect(bonuses).toBeGreaterThan(50);
      expect(longest).toBeLessThan(2);
    }, 600_000);
  }
});

describe('hard times', () => {
  it('a household broke and miserable for several days in a row packs up and leaves town', () => {
    const sim = new Sim(7);
    sim.run(60);
    const hh = sim.town.households.find((h) => h.building >= 0 && sim.agents.filter((a) => a.household === h.id).length >= 2)!;
    const fam = sim.agents.filter((a) => a.household === hh.id);
    const pop = sim.agents.length;
    expect(HARD_DAYS).toBeGreaterThanOrEqual(3);
    for (let d = 0; d < HARD_DAYS; d++) {
      expect(sim.agents.length).toBe(pop);
      for (const a of fam) {
        a.money = 0;
        a.mood = 10;
        addMemory(sim, a, 'broke');
      }
      midnight(sim);
    }
    expect(sim.agents.length).toBe(pop - fam.length);
    expect(sim.departed).toEqual(expect.arrayContaining(fam));
    expect(sim.activity.some((e) => e.text.startsWith('Hard times:'))).toBe(true);
    // Whoever moves into that home later starts with a clean slate.
    expect(sim.hardDays[hh.id]).toBe(0);
  });

  it('retirees draw a pension, so a grieving pensioner is not broke by definition', () => {
    const sim = new Sim(7);
    sim.run(60);
    const old = sim.agents.find((a) => a.role === 'retired')!;
    for (let d = 0; d < HARD_DAYS + 1; d++) {
      old.money = 0;
      old.mood = 10;
      midnight(sim);
      expect(old.money).toBeGreaterThanOrEqual(10);
    }
    expect(sim.hardDays[old.household]).toBe(0);
  });
});

describe('the grocery run', () => {
  /** A retiree whose fridge, family and housemates are all out of money and food. */
  function squeeze(sim: Sim, old: Agent, money: number): void {
    for (const o of sim.agents) if (o !== old && (o.household === old.household || kinship(sim, old, o))) o.money = 0;
    old.money = money;
    sim.pantry[old.household] = 0;
  }

  it("isn't attempted when nobody could pay for even a small basket", () => {
    const sim = new Sim(7);
    sim.run(60);
    const old = sim.agents.find((a) => a.role === 'retired')!;
    let shopped = 0;
    for (let i = 0; i < 6 * 6; i++) {
      squeeze(sim, old, 1);
      expect(canAffordGroceries(sim, old)).toBe(false);
      sim.run(10);
      if (old.action.kind === 'shop') shopped++;
    }
    expect(shopped).toBe(0);
    expect(sim.activity.some((e) => e.agentId === old.id && e.text.includes("couldn't afford"))).toBe(false);
  }, 60_000);

  it('waits a few hours after coming home empty-handed, then tries again', () => {
    const sim = new Sim(7);
    sim.run(60);
    const old = sim.agents.find((a) => a.role === 'retired')!;
    addMemory(sim, old, 'broke');
    const since = sim.time;
    let first = -1;
    for (let i = 0; i < 7 * 6 && first < 0; i++) {
      squeeze(sim, old, 100);
      sim.run(10);
      if (old.action.kind === 'shop') first = sim.time;
    }
    expect(first).toBeGreaterThan(0);
    expect(first - since).toBeGreaterThanOrEqual(BROKE_RETRY);
  }, 60_000);
});
