import { beforeAll, describe, expect, it } from 'vitest';
import { PRIORITY_WEIGHT } from '../src/sim/defs';
import { triggerWorldEvent } from '../src/sim/events';
import { gatherKind, laborPlan } from '../src/sim/labor';
import type { Agent } from '../src/sim/types';
import { loadSim, saveSim } from '../src/sim/save';
import { chill, tickSeasons, winterReadiness } from '../src/sim/seasons';
import { Sim } from '../src/sim/sim';
import { winterLine } from '../src/ui/townPanel';

const at = (sim: Sim, day: number, hour: number) => sim.run(day * 1440 + hour * 60 - sim.time);

describe('seasons', () => {
  // One town, simulated to the start of autumn and the eve of winter once; each test gets its own copy.
  let autumn = '';
  let eve = '';
  beforeAll(() => {
    const sim = new Sim(7);
    at(sim, 4, 0);
    autumn = saveSim(sim);
    at(sim, 5, 23.9);
    eve = saveSim(sim);
  }, 300_000);
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

  it('a homeless family has no hearth to burn', () => {
    const sim = new Sim(7);
    sim.time = 6 * 1440 + 3 * 60;
    const a = sim.agents[0];
    const hh = sim.town.households[a.household];
    hh.room = -1;
    hh.building = -1;
    sim.fuel[hh.id] = 5;
    const m = sim.map;
    a.at = m.room.findIndex((r, i) => r < 0 && m.walkable(m.cx(i), m.cy(i)));
    tickSeasons(sim, 60);
    expect(sim.fuel[hh.id]).toBe(5);
  });

  it('the Town view counts down to winter in autumn, and to spring in winter', () => {
    const sim = new Sim(7, { agents: false });
    sim.time = 0.2 * 1440;
    expect(winterLine(sim)).toBe('');
    sim.time = 5 * 1440;
    expect(winterLine(sim)).toContain('Winter starts in 1.0 days');
    sim.time = 7 * 1440;
    expect(winterLine(sim)).toContain('Winter ends in 1.0 days');
  });

  it('the first frost clears the fields, and nothing grows until spring', () => {
    const sim = winterTown();
    sim.run(10);
    expect(sim.season).toBe(3);
    const crops = sim.map.props.filter((p) => p.use === 'farm');
    expect(crops.every((p) => p.growth === 0)).toBe(true);
    expect(sim.activity.some((e) => e.text.startsWith('First frost'))).toBe(true);
    const before = crops.map((p) => p.growth);
    sim.run(600);
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

  it('a Low food priority through autumn leaves the stores much lower in winter', () => {
    const lowest = (sim: Sim) => {
      let min = Infinity;
      at(sim, 6, 0);
      while (sim.time < 8 * 1440) {
        sim.run(60);
        min = Math.min(min, sim.stock.food);
      }
      return min;
    };
    const normal = lowest(winterTown());
    const low = loadSim(autumn);
    low.priorities.food = 0;
    // Fewer hands bring in the autumn harvest, so more of it freezes in the fields.
    expect(lowest(low)).toBeLessThan(normal * 0.75);
  }, 300_000);

  it('firewood carried to a hearth gets there', () => {
    const sim = winterTown();
    // With the workshop drawing on the wood, this town reaches winter with an empty woodpile;
    // stock one so there are deliveries to watch.
    sim.stock.firewood = Math.max(sim.stock.firewood, 40);
    at(sim, 6, 6);
    // Watch everyone walking firewood to a home: when that errand ends, the load must be by the hearth.
    const out = new Map<number, { action: object; hh: number; fuel: number }>();
    let delivered = 0;
    let dropped = 0;
    for (let k = 0; k < 14 * 60; k++) {
      sim.run(1);
      for (const a of sim.agents) {
        const run = out.get(a.id);
        if (run && a.action !== run.action) {
          out.delete(a.id);
          if (a.carry?.kind === 'firewood' || sim.fuel[run.hh] < run.fuel) dropped++;
          else delivered++;
        }
        if (a.action.kind === 'stoke' && a.action.leg === 'deliver' && a.carry?.kind === 'firewood' && !out.has(a.id)) {
          out.set(a.id, { action: a.action, hh: a.action.household!, fuel: sim.fuel[a.action.household!] + a.carry.amount - 0.5 });
        }
      }
    }
    // A full bladder used to cut deliveries short, with the load still in hand.
    expect(delivered).toBeGreaterThan(0);
    expect(dropped).toBe(0);
  }, 120_000);

  it('winter snow is not rain: nobody gets soaked and the ground stays dry', () => {
    const sim = winterTown();
    at(sim, 6, 10);
    const wet = sim.events.wet;
    const from = sim.time;
    sim.events.rain = null;
    sim.events.plan.push({ at: sim.time + 1, kind: 'rain', length: 150 });
    sim.events.plan.sort((x, y) => x.at - y.at);
    sim.run(180);
    const feed = sim.activity.filter((e) => e.t >= from).map((e) => e.text);
    expect(feed).toContain('It started snowing');
    expect(feed).toContain('It stopped snowing');
    expect(feed).not.toContain('It started raining');
    expect(sim.events.wet).toBeLessThanOrEqual(wet);
    expect(sim.agents.some((a) => a.memories.some((m) => m.kind === 'soaked'))).toBe(false);
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
