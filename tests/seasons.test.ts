import { beforeAll, describe, expect, it } from 'vitest';
import { ageOf } from '../src/sim/agents';
import { ADULT_AGE, PRIORITY_WEIGHT, ROLES } from '../src/sim/defs';
import { setRole } from '../src/sim/planner';
import { triggerWorldEvent } from '../src/sim/events';
import { gatherKind, laborPlan } from '../src/sim/labor';
import type { Agent } from '../src/sim/types';
import { loadSim, saveSim } from '../src/sim/save';
import { BURN_PER_HOUR, chill, HEARTH_FULL, tickSeasons, winterReadiness } from '../src/sim/seasons';
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
  // A calm first winter day: tests that want a blizzard call one up, so one the weather sends can't spoil their setup.
  const winterTown = () => {
    const sim = loadSim(eve);
    sim.run(6 * 1440 + 1 - sim.time);
    sim.events.plan = sim.events.plan.filter((e) => e.kind !== 'snowstorm');
    return sim;
  };

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

  it("the Town view's firewood counts logs still to split, and goes red only short of what the town keeps in", () => {
    const sim = new Sim(7, { agents: false });
    const homes = sim.town.households.filter((h) => h.building >= 0);
    expect(homes.length).toBeGreaterThan(0);
    const firewood = () => /class="(\w+)">[\d.]+ of firewood/.exec(winterLine(sim))![1];
    const stock = (wood: number, firewood: number, hearth: number) => {
      sim.stock.wood = wood;
      sim.stock.firewood = firewood;
      for (const h of sim.town.households) sim.fuel[h.id] = h.building >= 0 ? hearth : 0;
    };
    // Early autumn, with every hearth stocked to what the town keeps in for winter: no warning.
    sim.time = 4 * 1440 + 60;
    stock(0, 0, HEARTH_FULL * 1.2);
    expect(firewood()).toBe('pos');
    stock(0, 0, HEARTH_FULL);
    expect(firewood()).toBe('pos');
    // Nothing split yet, but plenty of logs in the store: they count, 4 wood to 6 firewood.
    stock(Math.ceil((homes.length * HEARTH_FULL * 1.2 * 4) / 6) + 4, 0, 0);
    expect(firewood()).toBe('pos');
    // Really short: red.
    stock(8, 0, 2);
    expect(firewood()).toBe('neg');
    // Late winter needs only the days left.
    sim.time = 7 * 1440 + 18 * 60;
    stock(0, 0, BURN_PER_HOUR * 24 * 0.5);
    expect(firewood()).toBe('pos');
    stock(0, 0, BURN_PER_HOUR * 24 * 0.1);
    expect(firewood()).toBe('neg');
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

  it('with default priorities, a town gets through its first winter, blizzard and all, warm and fed', () => {
    const sim = winterTown();
    let freezing = 0;
    let hungriest = Infinity;
    at(sim, 6, 0);
    for (let k = 0; k < 4 * 12; k++) {
      // A blizzard on the first winter morning.
      if (k === 9) triggerWorldEvent(sim, 'snowstorm');
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
      // Surplus sold to the trader still counts: this is about the harvest, not the treasury.
      let sold = 0;
      let seen = sim.activityVersion;
      while (sim.time < 8 * 1440) {
        sim.run(60);
        const fresh = sim.activityVersion - seen;
        seen = sim.activityVersion;
        if (fresh > 0) for (const e of sim.activity.slice(-fresh)) sold += Number(/^The trader stopped.*\bsold (\d+) food/.exec(e.text)?.[1] ?? 0);
        min = Math.min(min, sim.stock.food + sold);
      }
      const frost = sim.activity.find((e) => e.text.startsWith('First frost'))!.text;
      return { min, ripeLost: Number(/(\d+) ripe/.exec(frost)?.[1] ?? 0) };
    };
    // The town as it stood, weather and all, to compare like with like against the Low run below.
    const normal = lowest(loadSim(eve));
    const low = loadSim(autumn);
    low.priorities.food = 0;
    // Fewer hands bring in the autumn harvest, so more of it freezes in the fields. With the
    // economy in, the gap in the stores on this seed is about a fifth rather than a half.
    const short = lowest(low);
    // More ripe crops lost to the frost. The gap swings with each seed's history (who is mayor, which farms got
    // built), so this asks for a clear margin; the stores check below is the outcome that matters.
    expect(short.ripeLost).toBeGreaterThan(normal.ripeLost + 10);
    expect(short.min).toBeLessThan(normal.min * 0.85);
  }, 300_000);

  it('firewood carried to a hearth gets there', () => {
    const sim = winterTown();
    // With the workshop drawing on the wood, this town reaches winter with an empty woodpile;
    // stock one so there are deliveries to watch.
    sim.stock.firewood = Math.max(sim.stock.firewood, 40);
    at(sim, 6, 6);
    // With a woodcutter always on the crew, the hearths start winter well stoked; burn them down
    // so some need a delivery before the day is out.
    for (const h of sim.town.households) sim.fuel[h.id] = Math.min(sim.fuel[h.id], HEARTH_FULL * 0.4);
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
    const there = [...sim.agents];
    triggerWorldEvent(sim, 'snowstorm');
    sim.run(90);
    const outside = sim.agents.filter((a) => !sim.roomOf(a) && !a.moving).length;
    expect(outside).toBeLessThanOrEqual(Math.ceil(sim.agents.length * 0.25));
    // Anyone arriving mid-storm missed the start of it.
    expect(there.every((a) => a.memories.some((m) => m.kind === 'blizzard'))).toBe(true);
  }, 120_000);

  it('a blizzard stops the outdoor work: builders, woodcutters and all come inside', () => {
    const sim = winterTown();
    at(sim, 6, 10);
    // Wait for a crew on site (how the morning goes shifts with any change to town life).
    for (let k = 0; k < 24 && !sim.projects.some((p) => p.builders.size > 0); k++) sim.run(15);
    expect(sim.projects.some((p) => p.builders.size > 0)).toBe(true);
    triggerWorldEvent(sim, 'snowstorm');
    sim.run(30);
    let out = 0;
    let samples = 0;
    for (let k = 0; k < 12; k++) {
      sim.run(10);
      const outside = sim.agents.filter((a) => !sim.roomOf(a));
      // Nobody stays out working or idling in the snow; the few outdoors are on their way somewhere.
      expect(outside.filter((a) => ['build', 'chop', 'mine', 'farm', 'split', 'haul'].includes(a.action.kind) && a.action.leg !== 'deliver')).toEqual([]);
      expect(outside.filter((a) => !a.moving).length).toBeLessThanOrEqual(1);
      out += outside.length;
      samples += sim.agents.length;
    }
    expect(out / samples).toBeLessThan(0.18);
  }, 120_000);

  it('a blizzard holds back the festival, and one that lasts the evening snows it off', () => {
    const sim = winterTown();
    at(sim, 7, 16);
    triggerWorldEvent(sim, 'snowstorm');
    // One that lasts the evening (a natural blizzard may already be blowing, due to clear sooner).
    sim.events.snowstorm!.until = Math.max(sim.events.snowstorm!.until, sim.time + 6 * 60);
    const from = sim.time;
    sim.run(7 * 60);
    const feed = sim.activity.filter((e) => e.t >= from).map((e) => e.text);
    expect(feed).toContain('The blizzard snowed off the winter lights');
    expect(feed).not.toContain('Winter lights in the park tonight!');
  }, 120_000);

  it('a cold worker warms up at home even with the seat by the fire taken, and stays in until warm', () => {
    const sim = winterTown();
    at(sim, 6, 11);
    const a = sim.agents.find((x) => !sim.roomOf(x) && ['builder', 'laborer', 'woodcutter'].includes(x.role) && sim.town.households[x.household].building >= 0 && sim.fuel[x.household] > 1)!;
    expect(a).toBeDefined();
    const hh = sim.town.households[a.household];
    sim.fuel[hh.id] = 12;
    const seat = sim.map.props.find((p) => p.use === 'sit' && p.household === hh.id)!;
    expect(seat).toBeDefined();
    a.needs.warmth = 5;
    a.thinkIn = 0;
    let entered = -1;
    let leftCold = 0;
    let wasHome = false;
    let leftAt = -1;
    for (let t = 0; t < 120; t++) {
      // A housemate has the seat by the fire the whole time.
      sim.reserved.set(seat.id, -1);
      sim.fuel[hh.id] = Math.max(sim.fuel[hh.id], 5);
      sim.run(1);
      const home = sim.roomOf(a)?.id === hh.room;
      if (home && entered < 0) entered = t;
      // Walking out the door still cold (cooling off later, back at work, is fine).
      if (wasHome && !home && a.needs.warmth < 55) leftCold++;
      if (wasHome && !home && leftAt < 0) leftAt = a.needs.warmth;
      wasHome = home;
    }
    expect(entered).toBeGreaterThanOrEqual(0);
    expect(leftCold).toBe(0);
    // Warm when they went back out (or still in, warming up).
    expect(leftAt < 0 ? a.needs.warmth : leftAt).toBeGreaterThanOrEqual(55);
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
    // The crew needs hands of both parities for the split to mean anything, whoever this timeline left on the gathering crew.
    for (const a of sim.agents.filter((x) => ageOf(sim, x) >= ADULT_AGE && ROLES[x.role].flexible && x.id % 2 && !['woodcutter', 'laborer', 'builder'].includes(x.role)).slice(0, 2)) setRole(sim, a, 'laborer', null);
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
