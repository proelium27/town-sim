import { describe, expect, it } from 'vitest';
import { CATCH, lakeCells } from '../src/sim/lake';
import { newcomers } from '../src/sim/life';
import { allocateRoles, findDockSite, proposals, roleDemand, setRole } from '../src/sim/planner';
import { CLASSIC } from '../src/sim/character';
import { Sim } from '../src/sim/sim';
import { BLUEPRINTS } from '../src/world/blueprints';

const at = (sim: Sim, day: number, hour: number) => sim.run(day * 1440 + hour * 60 - sim.time);

/** Builds the dock where the town would put it, without waiting for a town meeting. */
function buildDock(sim: Sim) {
  const site = findDockSite(sim)!;
  const b = BLUEPRINTS.dock.stamp(sim.map, site.x, site.y, site.doorTop, 'Lakeside Dock');
  for (const i of site.path) if (sim.map.ground[i] === 'grass') sim.map.setGround(sim.map.cx(i), sim.map.cy(i), 'dirt');
  allocateRoles(sim);
  return b;
}

// The original Northwind, on the shore of its lake: most towns have water, but not every one (seed 7 is woodland).
describe('the lake', () => {
  it('there is a spot on the shore for a dock, and its pier reaches out over the water', () => {
    const sim = new Sim(7, { character: CLASSIC });
    const site = findDockSite(sim);
    expect(site).not.toBeNull();
    buildDock(sim);
    const spots = sim.map.props.filter((p) => p.use === 'fish');
    // Two at the end of the pier, and more along its sides wherever open water lies beside it.
    expect(spots.length).toBeGreaterThanOrEqual(2);
    expect(spots.length).toBeLessThanOrEqual(8);
    // The fishing spots are out on the boards, with water beyond them.
    for (const p of spots) {
      expect(sim.map.ground[sim.map.idx(p.x, p.y)]).toBe('floorWood');
      const f = p.spot!.facing;
      const dx = f === 'left' ? -1 : f === 'right' ? 1 : 0;
      const dy = f === 'down' ? 1 : f === 'up' ? -1 : 0;
      expect(sim.map.ground[sim.map.idx(p.x + dx, p.y + dy)]).toBe('water');
    }
    // And someone in town can walk out to them.
    const a = sim.agents[0];
    expect(sim.nav.findPath(a.at, sim.map.idx(spots[0].x, spots[0].y), 80000)).not.toBeNull();
  });

  it('a town with mouths to feed proposes a dock before winter', () => {
    const sim = new Sim(7, { character: CLASSIC });
    at(sim, 2, 9);
    // Either it's on the table, or (with a free crew) already under way.
    const dock = sim.projects.find((p) => p.blueprint === 'dock');
    expect(proposals(sim).some((p) => p.bp === 'dock' && /first frost/.test(p.reason)) || (dock && /first frost/.test(dock.reason))).toBeTruthy();
  }, 60_000);

  it('the dock is up before the first frost, even with a big project already on the go', () => {
    // Seed 11 used to propose it only in the second half of autumn, with the school ahead of it.
    const sim = new Sim(11, { character: CLASSIC });
    at(sim, 4, 0);
    expect(sim.map.buildings.some((b) => b.kind === 'dock') || sim.projects.some((p) => p.blueprint === 'dock')).toBe(true);
  }, 120_000);

  it('in autumn the dock outranks a new home, and is a rush job', () => {
    const sim = new Sim(7, { character: CLASSIC });
    sim.time = 4 * 1440 + 8 * 60;
    const dock = proposals(sim).find((p) => p.bp === 'dock')!;
    expect(dock.rush).toBe(true);
    expect(proposals(sim).filter((p) => p.bp === 'house').every((p) => dock.score > p.score)).toBe(true);
  });

  it('fishers are sized by the town, and the food lever moves the headcount in every season', () => {
    const sim = new Sim(7, { character: CLASSIC });
    buildDock(sim);
    const wanted = () => roleDemand(sim).filter(([r]) => r === 'fisher').reduce((s, [, n]) => s + n, 0);
    const places = sim.map.props.filter((p) => p.use === 'fish').length;
    expect(places).toBeGreaterThanOrEqual(4);
    sim.time = 4 * 1440 + 8 * 60; // autumn
    const small = wanted();
    expect(small).toBe(2);
    sim.priorities.food = 2;
    expect(wanted()).toBe(3);
    sim.priorities.food = 0;
    expect(wanted()).toBe(1);
    sim.priorities.food = 1;
    while (sim.agents.length < 40) newcomers(sim, 3, true);
    expect(wanted()).toBeGreaterThan(small);
    sim.priorities.food = 2;
    const high = wanted();
    sim.priorities.food = 1;
    expect(high).toBe(wanted() + 1);
    sim.time = 6 * 1440 + 8 * 60; // winter: the thinner catch takes more hands
    const winter = wanted();
    expect(winter).toBeGreaterThanOrEqual(high - 1);
    sim.priorities.food = 2;
    expect(wanted()).toBe(Math.min(winter + 1, places));
    // No dock is asked for more fishers than it has places.
    sim.priorities.food = 2;
    expect(wanted()).toBeLessThanOrEqual(places);
  });

  it('the promised fisher is on the pier as autumn arrives, not at the next shuffle', () => {
    const sim = new Sim(23, { character: CLASSIC });
    at(sim, 3, 12);
    buildDock(sim);
    at(sim, 4, 7);
    expect(sim.agents.filter((a) => a.role === 'fisher').length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('fishers bring food in from the pier', () => {
    const sim = new Sim(7, { character: CLASSIC });
    at(sim, 0, 9);
    const dock = buildDock(sim);
    // Fishers are staffed after the farms and the building crew, so a founding town may have none spare yet.
    if (!sim.agents.some((a) => a.role === 'fisher')) setRole(sim, sim.agents.find((a) => a.role === 'woodcutter' || a.role === 'laborer')!, 'fisher', dock.id);
    const fishers = sim.agents.filter((a) => a.role === 'fisher');
    let fished = false;
    let landed = false;
    for (let k = 0; k < 6 * 12; k++) {
      sim.run(5);
      for (const f of fishers) {
        if (f.action.kind === 'fish' && f.action.stage === 'perform') fished = true;
        if (f.carry?.kind === 'food') landed = true;
      }
    }
    expect(fished).toBe(true);
    expect(landed).toBe(true);
  }, 120_000);

  it('the catch keeps coming through winter, when the fields give nothing', () => {
    expect(CATCH[3]).toBeGreaterThan(0);
    expect(CATCH[3]).toBeLessThan(CATCH[2]);
  });

  it('the lake freezes in winter, people skate on it, and the ice breaks up in spring', () => {
    const sim = new Sim(7, { character: CLASSIC });
    const { water } = lakeCells(sim.map);
    const w = water[Math.floor(water.length / 2)];
    expect(sim.map.walkable(sim.map.cx(w), sim.map.cy(w))).toBe(false);
    at(sim, 6, 1);
    expect(sim.map.ice).toBe(true);
    expect(sim.map.walkable(sim.map.cx(w), sim.map.cy(w))).toBe(true);
    expect(sim.activity.some((e) => /frozen over/.test(e.text))).toBe(true);
    let skated = false;
    for (let k = 0; k < 2 * 288 && !skated; k++) {
      sim.run(5);
      skated = sim.agents.some((a) => a.action.label === 'Skating on the lake');
    }
    expect(skated).toBe(true);
    at(sim, 8, 1);
    expect(sim.map.ice).toBe(false);
    expect(sim.agents.some((a) => sim.map.ground[a.at] === 'water')).toBe(false);
  }, 300_000);

  it('a rush dock goes up alongside a home rather than in its place', () => {
    // Seed 6 starts its dock in late summer on a lot that takes days to clear, with one builder to spare.
    const sim = new Sim(6, { character: CLASSIC });
    const houses = () => sim.map.buildings.filter((b) => b.kind === 'house').length;
    while (!sim.projects.some((p) => p.blueprint === 'dock') && sim.time < 5 * 1440) sim.run(30);
    const dock = sim.projects.find((p) => p.blueprint === 'dock');
    expect(dock?.rush).toBe(true);
    const before = houses();
    at(sim, 5, 12);
    expect(sim.projects.some((p) => p.blueprint === 'dock')).toBe(true);
    // Its slot is outside the town's limit, so the home the town wants is under way (or done) too.
    expect(sim.projects.some((p) => p.blueprint === 'house') || houses() > before).toBe(true);
  }, 300_000);

  it('a town with no lake never proposes a dock or calls for fishers', () => {
    const sim = new Sim(7);
    expect(sim.character.lakes.length).toBe(0);
    while (sim.agents.length < 20) newcomers(sim, 3, true);
    sim.run(3 * 1440 + 12 * 60 - sim.time);
    expect(findDockSite(sim)).toBeNull();
    expect(proposals(sim).some((p) => p.bp === 'dock')).toBe(false);
    expect(roleDemand(sim).some(([r]) => r === 'fisher')).toBe(false);
  }, 300_000);
});
