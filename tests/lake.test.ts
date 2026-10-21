import { describe, expect, it } from 'vitest';
import { CATCH, lakeCells } from '../src/sim/lake';
import { allocateRoles, findDockSite, proposals, setRole } from '../src/sim/planner';
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

describe('the lake', () => {
  it('there is a spot on the shore for a dock, and its pier reaches out over the water', () => {
    const sim = new Sim(7);
    const site = findDockSite(sim);
    expect(site).not.toBeNull();
    buildDock(sim);
    const spots = sim.map.props.filter((p) => p.use === 'fish');
    expect(spots).toHaveLength(2);
    // The fishing spots are out on the boards, with water beyond them.
    for (const p of spots) {
      expect(sim.map.ground[sim.map.idx(p.x, p.y)]).toBe('floorWood');
      const out = p.spot!.facing === 'down' ? 1 : -1;
      expect(sim.map.ground[sim.map.idx(p.x, p.y + out)]).toBe('water');
    }
    // And someone in town can walk out to them.
    const a = sim.agents[0];
    expect(sim.nav.findPath(a.at, sim.map.idx(spots[0].x, spots[0].y), 80000)).not.toBeNull();
  });

  it('a town with mouths to feed proposes a dock before winter', () => {
    const sim = new Sim(7);
    at(sim, 2, 9);
    expect(proposals(sim).some((p) => p.bp === 'dock' && /first frost/.test(p.reason))).toBe(true);
  }, 60_000);

  it('fishers bring food in from the pier', () => {
    const sim = new Sim(7);
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
    const sim = new Sim(7);
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
});
