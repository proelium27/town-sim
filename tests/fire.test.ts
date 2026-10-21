import { describe, expect, it } from 'vitest';
import { burns, fireAt, gap, GUTTED, startFire } from '../src/sim/fire';
import { proposals } from '../src/sim/planner';
import { loadSim, saveSim } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
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
    expect(b.damage).toBeLessThan(GUTTED);
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
    // Folk asleep across town sleep through it.
    const far = sim.agents.filter((a) => Math.hypot(a.x - (b.x + b.w / 2), a.y - (b.y + b.h / 2)) > 15 && a.household !== hh.id);
    expect(far.some((a) => a.action.kind === 'sleep')).toBe(true);
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
    b.damage = 0.01;
    sim.time = 1440 + 9 * 60;
    for (let k = 0; k < 48 && b.damage; k++) sim.run(30);
    expect(b.damage).toBe(0);
    expect(sim.activity.some((e) => e.text === `The ${b.name} is repaired`)).toBe(true);
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
