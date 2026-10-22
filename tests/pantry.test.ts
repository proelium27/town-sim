import { describe, expect, it } from 'vitest';
import { stageOf } from '../src/sim/ai';
import { Sim } from '../src/sim/sim';
import type { Agent } from '../src/sim/types';

const at = (sim: Sim, day: number, hour: number) => sim.run(day * 1440 + hour * 60 - sim.time);

/** A hungry adult at home with money for food and `pantry` meals in the cupboard. */
function hungryAtHome(pantry: number, solo: boolean) {
  const sim = new Sim(11);
  // The first evening moment someone is home and not already at a meal or a party: the test is
  // about a grown-up who has to feed themselves, and evening routines shift from branch to branch.
  let a: Agent | undefined;
  for (let hour = 18; !a && hour <= 21; hour += 0.5) {
    at(sim, 1, hour);
    a = sim.agents.find((x) => stageOf(sim, x) === 'adult' && !['eat', 'cook', 'party'].includes(x.action.kind) && sim.roomOf(x)?.id === sim.town.households[x.household].room);
  }
  if (!a) throw new Error('nobody at home to feed');
  if (solo) {
    // Everyone else in the house moves next door, so nobody else will restock this pantry.
    const next = sim.town.households.findIndex((h, i) => i !== a.household && h.building >= 0);
    for (const x of sim.agents) if (x !== a && x.household === a.household) x.household = next;
  }
  sim.pantry[a.household] = pantry;
  a.needs.hunger = 12;
  a.money = 200;
  sim.stock.food = 200;
  return { sim, a };
}

/** Steps the sim, counting how often `a` starts cooking before their first meal (and how often with less than half a meal in), and noting when they first sit down to eat. */
function watch(sim: Sim, a: Agent, hours: number) {
  let cooks = 0;
  let bareCooks = 0;
  let ateAt = -1;
  let peak = a.needs.hunger;
  let prev = a.action;
  const end = sim.time + hours * 60;
  while (sim.time < end) {
    sim.step();
    if (a.action !== prev && a.action.kind === 'cook') {
      if (ateAt < 0) cooks++;
      if (sim.pantry[a.household] < 0.5) bareCooks++;
    }
    if (ateAt < 0 && a.action.kind === 'eat' && a.action.stage === 'perform') ateAt = sim.time;
    peak = Math.max(peak, a.needs.hunger);
    prev = a.action;
  }
  return { cooks, bareCooks, ateAt, peak };
}

describe('pantry', () => {
  for (const solo of [false, true]) {
    it(`half a meal in the pantry never traps a hungry adult in a cooking loop${solo ? ' (living alone)' : ''}`, () => {
      const { sim, a } = hungryAtHome(0.5, solo);
      const t0 = sim.time;
      const { cooks, bareCooks, ateAt, peak } = watch(sim, a, 6);
      expect(bareCooks).toBe(0);
      expect(ateAt).toBeGreaterThan(0);
      expect(ateAt - t0).toBeLessThan(3 * 60);
      // At most one trip to the stove (with money, dinner at the café is fine too).
      expect(cooks).toBeLessThanOrEqual(1);
      // A proper meal, not a nibble: from 12 to well fed. (Where they end six hours on depends on whether they turned
      // in early, which shifts with any change to the town's day.)
      expect(peak).toBeGreaterThan(60);
    }, 60_000);
  }

  it('a starving kid with nothing at home sends a grown-up out for groceries, even from work, and gets fed', () => {
    const sim = new Sim(11);
    at(sim, 1, 10);
    const kid = sim.agents.find((x) => ['toddler', 'child'].includes(stageOf(sim, x)) && sim.agents.some((p) => p.household === x.household && stageOf(sim, p) === 'adult'));
    if (!kid) throw new Error('no kid living with a grown-up');
    const grownUps = sim.agents.filter((p) => p.household === kid.household && stageOf(sim, p) === 'adult');
    sim.pantry[kid.household] = 0;
    sim.stock.food = 200;
    for (const p of grownUps) p.money = 200;
    kid.needs.hunger = 8;
    let shopped: Agent | undefined;
    const end = sim.time + 8 * 60;
    while (sim.time < end && kid.needs.hunger < 50) {
      sim.step();
      shopped ??= grownUps.find((p) => p.action.kind === 'shop' && p.action.reason === `Nothing at home for ${kid.name.split(' ')[0]}`);
    }
    expect(shopped).toBeDefined();
    expect(kid.needs.hunger).toBeGreaterThanOrEqual(50);
  }, 60_000);

  it('someone living alone with a bare pantry goes out to eat or shop', () => {
    const { sim, a } = hungryAtHome(0, true);
    const t0 = sim.time;
    const { bareCooks, ateAt } = watch(sim, a, 4);
    expect(bareCooks).toBe(0);
    expect(ateAt).toBeGreaterThan(0);
    expect(ateAt - t0).toBeLessThan(3 * 60);
  }, 60_000);
});
