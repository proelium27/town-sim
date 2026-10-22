import { describe, expect, it } from 'vitest';
import { stageOf } from '../src/sim/ai';
import { burns, fireAt, gap, GUTTED, LINE_MAX, NEIGHBOUR_RADIUS, REPAIR_AT, SLEEPER_RADIUS, startFire } from '../src/sim/fire';
import { laborPlan } from '../src/sim/labor';
import { proposals } from '../src/sim/planner';
import { loadSim, saveSim } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import type { Agent } from '../src/sim/types';
import type { Building } from '../src/world/map';

const at = (sim: Sim, day: number, hour: number) => sim.run(day * 1440 + hour * 60 - sim.time);
const homeOf = (sim: Sim) => sim.map.buildings.find((b) => b.kind === 'house' && sim.town.households.some((h) => h.building === b.id))!;

/** Runs until the fire in b is out (or the time runs out), returning how many minutes it took. */
function burnDown(sim: Sim, b: Building, max = 600): number {
  const t0 = sim.time;
  while (fireAt(sim, b.id) && sim.time - t0 < max) sim.run(5);
  return sim.time - t0;
}

describe('fire', () => {
  it('a fire nobody fights burns itself out and leaves a shell, not a gap', () => {
    const sim = new Sim(7, { agents: false });
    const b = homeOf(sim);
    const count = sim.map.buildings.length;
    startFire(sim, b, 'a lamp knocked over');
    burnDown(sim, b);
    expect(fireAt(sim, b.id)).toBeUndefined();
    expect(b.damage).toBe(1);
    expect(sim.map.buildings.length).toBe(count);
    expect(sim.activity.some((e) => /burned itself out/.test(e.text))).toBe(true);
  });

  it('by day the town forms a bucket line and saves the building', () => {
    const sim = new Sim(7);
    at(sim, 0, 11);
    const b = homeOf(sim);
    startFire(sim, b, 'a lamp knocked over');
    let crew = 0;
    const t0 = sim.time;
    while (fireAt(sim, b.id) && sim.time - t0 < 300) {
      sim.run(5);
      crew = Math.max(crew, sim.agents.filter((a) => a.action.kind === 'firefight' && a.action.stage === 'perform').length);
    }
    expect(fireAt(sim, b.id)).toBeUndefined();
    expect(crew).toBeGreaterThanOrEqual(3);
    // A bucket line has only so many places.
    expect(crew).toBeLessThanOrEqual(LINE_MAX);
    expect(b.damage).toBeLessThan(GUTTED);
    // A scorch you can see (the soot tint) and a repair job, not a clean escape.
    expect(b.damage).toBeGreaterThan(0.08);
    expect(b.damage).toBeLessThan(0.4);
    expect(sim.agents.some((a) => a.memories.some((m) => m.kind === 'foughtFire'))).toBe(true);
    expect(sim.activity.some((e) => new RegExp(`The fire at the ${b.name} is out, after \\d+ people fought it`).test(e.text))).toBe(true);
  }, 60_000);

  it('at night the shouting wakes the house and the neighbours, and nobody stays inside', () => {
    const sim = new Sim(7);
    at(sim, 1, 2);
    const b = homeOf(sim);
    const hh = sim.town.households.find((h) => h.building === b.id)!;
    const family = sim.agents.filter((a) => a.household === hh.id);
    expect(family.every((a) => a.action.kind === 'sleep')).toBe(true);
    startFire(sim, b, 'an ember from the hearth');
    sim.run(5);
    // Everyone who lives there is up: out of the house, or at it with a bucket.
    for (const a of family) expect(a.action.kind, a.name).not.toBe('sleep');
    expect(sim.agents.filter((a) => a.action.kind === 'firefight').length).toBeGreaterThanOrEqual(2);
    // The bucket line has only so many places, and the young are left to sleep: not the whole town is up.
    expect(sim.agents.filter((a) => a.action.kind === 'firefight').length).toBeLessThanOrEqual(LINE_MAX);
    expect(sim.agents.some((a) => a.action.kind === 'sleep' && a.household !== hh.id)).toBe(true);
    // Nobody goes back in while it burns; once it's out, back to bed.
    while (fireAt(sim, b.id)) {
      sim.run(1);
      for (const a of family) expect(fireAt(sim, b.id) && sim.roomOf(a) && b.rooms.includes(sim.roomOf(a)!.id), a.name).toBeFalsy();
    }
    sim.run(60);
    expect(family.filter((a) => a.action.kind === 'sleep').length).toBeGreaterThanOrEqual(family.length - 1);
  }, 60_000);

  it('left alone, a fire can jump to a building close by', () => {
    const sim = new Sim(7, { agents: false });
    sim.time = 2 * 1440 + 12 * 60; // summer: dry
    const row = sim.map.buildings.filter((b) => burns(b));
    const b = row.find((x) => row.some((y) => y !== x && gap(x, y) <= 3))!;
    expect(b).toBeDefined();
    startFire(sim, b, 'a lamp knocked over');
    let most = 0;
    for (let k = 0; k < 120 && sim.fires.length; k++) {
      sim.run(5);
      most = Math.max(most, sim.fires.length);
    }
    expect(most).toBeGreaterThan(1);
    expect(sim.activity.some((e) => new RegExp(`sparks from the ${b.name}`).test(e.text))).toBe(true);
  });

  it('a planks-and-bricks building burns slower', () => {
    const heatAfter = (sturdy: boolean) => {
      const sim = new Sim(7, { agents: false });
      const b = homeOf(sim);
      b.sturdy = sturdy;
      const f = startFire(sim, b, 'test')!;
      sim.run(40);
      return f.heat;
    };
    expect(heatAfter(true)).toBeLessThan(heatAfter(false));
  });

  it('builders make a gutted home livable first thing, with wood; the last of the soot can wait', () => {
    const sim = new Sim(7);
    at(sim, 0, 9);
    const b = homeOf(sim);
    b.damage = 0.8;
    let mended = 0;
    const t0 = sim.time;
    while ((b.damage ?? 0) >= GUTTED && sim.time - t0 < 6 * 60) {
      sim.run(5);
      mended += sim.agents.filter((a) => a.action.kind === 'mend' && a.action.stage === 'perform').length;
    }
    expect(b.damage).toBeLessThan(GUTTED);
    expect(sim.time - t0).toBeLessThan(3 * 60);
    expect(mended).toBeGreaterThan(0);
    // The rest gets done when the builders are free, and finishes with a line in the feed.
    b.damage = 0.1;
    sim.time = 1440 + 9 * 60;
    for (let k = 0; k < 48 && b.damage; k++) sim.run(30);
    // (Mended outright, or mended below the point worth a repair and left to fade.)
    expect(b.damage).toBe(0);
  }, 120_000);

  /** A walkable cell outside any building near (x, y), searched outward. */
  const cellNear = (sim: Sim, x: number, y: number) => {
    for (let r = 0; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const cx = Math.round(x + dx);
          const cy = Math.round(y + dy);
          if (sim.map.walkable(cx, cy) && sim.map.room[sim.map.idx(cx, cy)] < 0) return sim.map.idx(cx, cy);
        }
      }
    }
    throw new Error('no free ground');
  };
  const place = (sim: Sim, a: Agent, cell: number) => {
    a.at = cell;
    a.x = a.px = sim.map.cx(cell);
    a.y = a.py = sim.map.cy(cell);
    a.path = [];
  };
  /** Someone able to fight a fire and asleep, from a household other than the burning home's. */
  const sleeper = (sim: Sim, not: number[]) => sim.agents.find((a) => stageOf(sim, a) === 'adult' && a.action.kind === 'sleep' && !not.includes(a.household))!;

  it('a night fire in a quiet corner is heard past the old 15 tiles, and neighbours wake neighbours', () => {
    const sim = new Sim(7);
    at(sim, 1, 2);
    const b = homeOf(sim);
    const hh = sim.town.households.find((h) => h.building === b.id)!;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const near = sleeper(sim, [hh.id]);
    const far = sim.agents.find((a) => a !== near && stageOf(sim, a) === 'adult' && a.action.kind === 'sleep' && a.household !== hh.id && a.household !== near.household)!;
    // Everyone else is off at the far edge of town, out of earshot. One sleeper is 20 tiles off, past the old 15; another is
    // 10 further out, beyond even the new radius but within a neighbour's call of the first.
    const away = cellNear(sim, sim.map.w - 3, 27);
    for (const a of sim.agents) if (a !== near && a !== far && !(sim.roomOf(a) && b.rooms.includes(sim.roomOf(a)!.id))) place(sim, a, away);
    place(sim, near, cellNear(sim, cx + 20, cy));
    place(sim, far, cellNear(sim, cx + 20 + NEIGHBOUR_RADIUS - 4, cy));
    expect(Math.hypot(near.x - cx, near.y - cy)).toBeGreaterThan(15);
    expect(Math.hypot(far.x - cx, far.y - cy)).toBeGreaterThan(SLEEPER_RADIUS);
    startFire(sim, b, 'an ember from the hearth');
    sim.run(5);
    expect(near.action.kind, 'sleeper at 20 tiles').not.toBe('sleep');
    expect(far.action.kind, 'the sleeper past the radius, woken by the one in between').not.toBe('sleep');
  }, 60_000);

  it('the alarm leaves children, elders and the ill asleep; they are only turned out of the burning building', () => {
    const sim = new Sim(7);
    at(sim, 1, 2);
    const b = homeOf(sim);
    const hh = sim.town.households.find((h) => h.building === b.id)!;
    const kid = sim.agents.find((a) => a.role === 'child' && a.action.kind === 'sleep' && a.household !== hh.id)!;
    place(sim, kid, cellNear(sim, b.x + b.w / 2, b.y + b.h + 8));
    kid.needs.hunger = 100;
    kid.mealReady = true; // a plate cooked earlier and never eaten
    startFire(sim, b, 'an ember from the hearth');
    for (let k = 0; k < 6; k++) sim.run(5);
    expect(kid.action.kind).toBe('sleep');
    // The ones who live there are another matter: out they go.
    for (const a of sim.agents.filter((x) => x.household === hh.id && stageOf(sim, x) !== 'adult')) {
      expect(a.action.kind === 'sleep' && sim.roomOf(a) && b.rooms.includes(sim.roomOf(a)!.id), a.name).toBeFalsy();
    }
  }, 60_000);

  it('a full plate goes cold: someone with a full stomach does not keep sitting down to eat', () => {
    const sim = new Sim(7);
    at(sim, 0, 18);
    const kid = sim.agents.find((a) => a.role === 'child')!;
    kid.needs.hunger = 100;
    kid.mealReady = true;
    kid.thinkIn = 0;
    sim.run(30);
    expect(kid.mealReady).toBe(false);
    expect(kid.action.kind === 'eat' && kid.action.reason === 'Food is ready').toBe(false);
  }, 60_000);

  it('barely-scorched buildings are left to fade rather than sending builders out', () => {
    const sim = new Sim(7);
    at(sim, 0, 9);
    const b = homeOf(sim);
    b.damage = REPAIR_AT / 2;
    const builders = sim.agents.filter((a) => a.role === 'builder' || a.role === 'laborer');
    expect(builders.length).toBeGreaterThan(0);
    for (const a of builders) expect(laborPlan(sim, a)?.kind === 'mend', a.name).toBeFalsy();
    sim.run(6 * 60);
    expect(b.damage).toBeLessThan(REPAIR_AT / 2);
  }, 60_000);

  it('with only two or three up at night, a fire gets away from them and burns the house out', () => {
    const sim = new Sim(7);
    at(sim, 1, 2);
    const b = homeOf(sim);
    const crew = sim.agents.filter((a) => stageOf(sim, a) === 'adult').sort((x, y) => Math.hypot(x.x - b.x, x.y - b.y) - Math.hypot(y.x - b.x, y.y - b.y)).slice(0, 3);
    // Everyone else is asleep well out of earshot.
    const away = cellNear(sim, sim.map.w - 3, 27);
    for (const a of sim.agents) if (!crew.includes(a) && !(sim.roomOf(a) && b.rooms.includes(sim.roomOf(a)!.id))) place(sim, a, away);
    startFire(sim, b, 'an ember from the hearth');
    burnDown(sim, b, 400);
    expect(b.damage).toBeGreaterThanOrEqual(GUTTED);
  }, 120_000);

  it('a drought fire is harder to fight than the same fire in an ordinary spring', () => {
    const damageAfter = (drought: boolean) => {
      const sim = new Sim(7);
      at(sim, 0, 11);
      if (drought) sim.events.drought = { until: sim.time + 3 * 1440 };
      const b = homeOf(sim);
      startFire(sim, b, 'the dry heat');
      burnDown(sim, b, 300);
      return b.damage ?? 0;
    };
    const calm = damageAfter(false);
    expect(damageAfter(true)).toBeGreaterThan(calm);
  }, 120_000);

  it('the first well after a fire is a priority: it outranks new homes and may start past the project limit', () => {
    const sim = new Sim(7);
    startFire(sim, homeOf(sim), 'test');
    const list = proposals(sim);
    const well = list.find((p) => p.bp === 'well')!;
    expect(well.rush).toBe(true);
    expect(list.filter((p) => p.bp === 'house' || p.bp === 'extension').every((p) => well.score > p.score)).toBe(true);
  });

  it('the town meeting has a well under way within a couple of hours of a fire, with other projects going', () => {
    const sim = new Sim(11);
    at(sim, 1, 11);
    startFire(sim, homeOf(sim), 'test');
    sim.run(150);
    expect(sim.projects.some((p) => p.blueprint === 'well') || sim.map.buildings.some((b) => b.kind === 'well')).toBe(true);
  }, 120_000);

  it('after a fire, a town meeting wants a well', () => {
    const sim = new Sim(7);
    expect(proposals(sim).some((p) => p.bp === 'well')).toBe(false);
    startFire(sim, homeOf(sim), 'test');
    expect(proposals(sim).some((p) => p.bp === 'well' && /water close at hand/.test(p.reason))).toBe(true);
  });

  it('a fire in progress survives saving', () => {
    const sim = new Sim(7);
    const b = homeOf(sim);
    startFire(sim, b, 'test');
    sim.run(20);
    const again = loadSim(saveSim(sim));
    expect(again.fires).toEqual(sim.fires);
    expect(again.building(b.id)!.damage).toBe(b.damage);
  });
});
