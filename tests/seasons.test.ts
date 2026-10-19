import { beforeAll, describe, expect, it } from 'vitest';
import { PRIORITY_WEIGHT } from '../src/sim/defs';
import { triggerWorldEvent } from '../src/sim/events';
import { gatherKind, laborPlan } from '../src/sim/labor';
import type { Agent } from '../src/sim/types';
import { loadSim, saveSim } from '../src/sim/save';
import { chill, winterReadiness } from '../src/sim/seasons';
import { Sim } from '../src/sim/sim';

const at = (sim: Sim, day: number, hour: number) => sim.run(day * 1440 + hour * 60 - sim.time);

describe('seasons', () => {
  // One town, simulated to the eve of winter once; each test gets its own copy.
  let eve = '';
  beforeAll(() => {
    const sim = new Sim(7);
    at(sim, 5, 23.9);
    eve = saveSim(sim);
  }, 120_000);
  const winterTown = () => loadSim(eve);

  it('warm summers, a chilly late autumn, and a cold winter', () => {
    const sim = new Sim(7, { agents: false });
    sim.time = 2 * 1440 + 12 * 60;
    expect(chill(sim)).toBe(0);
    sim.time = 5 * 1440 + 22 * 60;
    expect(chill(sim)).toBeGreaterThan(0.2);
    sim.time = 6 * 1440 + 3 * 60;
    expect(chill(sim)).toBe(1);
  });

  it('the first frost clears unripe crops, and nothing grows until spring', () => {
    const sim = winterTown();
    sim.run(10);
    expect(sim.season).toBe(3);
    const crops = sim.map.props.filter((p) => p.use === 'farm');
    expect(crops.every((p) => p.growth === 0 || p.growth === 1)).toBe(true);
    expect(sim.activity.some((e) => e.text.startsWith('First frost'))).toBe(true);
    const before = crops.map((p) => p.growth);
    sim.run(600);
    // Ripe crops can still be harvested (back to 0), but none grows.
    expect(crops.every((p, i) => (p.growth ?? 0) <= (before[i] ?? 0))).toBe(true);
  }, 120_000);

  it('with default priorities, a town gets through its first winter warm and fed', () => {
    const sim = winterTown();
    let freezing = 0;
    let hungriest = Infinity;
    at(sim, 6, 0);
    for (let k = 0; k < 4 * 12; k++) {
      sim.run(60);
      freezing = Math.max(freezing, sim.agents.filter((a) => a.needs.warmth < 15).length);
      hungriest = Math.min(hungriest, sim.stock.food);
    }
    // Hardly anyone is ever freezing, the stores never run dry, and hearths are kept going.
    expect(freezing).toBeLessThanOrEqual(2);
    expect(hungriest).toBeGreaterThan(30);
    const homes = sim.town.households.filter((h) => h.building >= 0);
    expect(homes.filter((h) => sim.fuel[h.id] > 0).length).toBeGreaterThanOrEqual(homes.length - 1);
    expect(sim.activity.some((e) => e.text === 'Winter lights in the park tonight!')).toBe(true);
    expect(winterReadiness(sim).food).toBeGreaterThan(1);
  }, 120_000);

  it('a blizzard sends people indoors', () => {
    const sim = winterTown();
    at(sim, 6, 11);
    triggerWorldEvent(sim, 'snowstorm');
    sim.run(90);
    const outside = sim.agents.filter((a) => !sim.roomOf(a) && !a.moving).length;
    expect(outside).toBeLessThanOrEqual(Math.ceil(sim.agents.length * 0.25));
    expect(sim.agents.every((a) => a.memories.some((m) => m.kind === 'blizzard'))).toBe(true);
  }, 120_000);

  it('an empty hearth in winter makes for a cold, unhappy home', () => {
    const sim = winterTown();
    at(sim, 6, 20);
    const hh = sim.town.households.find((h) => h.building >= 0 && sim.agents.some((a) => a.household === h.id))!;
    sim.fuel[hh.id] = 0;
    sim.stock.firewood = 0;
    sim.stock.wood = 0;
    sim.run(180);
    const home = sim.agents.filter((a) => a.household === hh.id);
    expect(home.some((a) => a.memories.some((m) => m.kind === 'coldHome'))).toBe(true);
  }, 120_000);

  it('gatherers go where the need is worst, not half to each', () => {
    const sim = winterTown();
    sim.projects = [];
    sim.stock.wood = 0;
    sim.stock.firewood = 0;
    sim.stock.stone = 60 * PRIORITY_WEIGHT[sim.priorities.materials] - 1;
    const gatherers = sim.agents.filter((a) => ['woodcutter', 'laborer', 'builder'].includes(a.role) && !a.carry);
    expect(gatherers.some((a) => a.id % 2)).toBe(true);
    const kinds = gatherers.map((a) => laborPlan(sim, a)?.kind).filter((k) => k === 'chop' || k === 'mine');
    expect(kinds.length).toBeGreaterThan(0);
    // One stone short doesn't pull anyone off the wood with winter coming.
    expect(kinds.every((k) => k === 'chop')).toBe(true);
    // When both are about as short, both get worked.
    const crew = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }) as Agent);
    const stone = crew.filter((a) => gatherKind(a, 0.5, 0.5) === 'stone').length;
    expect(stone).toBeGreaterThanOrEqual(7);
    expect(stone).toBeLessThanOrEqual(13);
  }, 120_000);
});
