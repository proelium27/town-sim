import { describe, expect, it } from 'vitest';
import { triggerWorldEvent } from '../src/sim/events';
import { allocateRoles, findSite } from '../src/sim/planner';
import { Sim } from '../src/sim/sim';
import { chains, hasWorkshop } from '../src/sim/workshop';
import { BLUEPRINTS } from '../src/world/blueprints';

/** A town with a workshop dropped in and stocked with raw materials. */
function townWithWorkshop(): Sim {
  const sim = new Sim(7);
  sim.run(3 * 60);
  const site = findSite(sim, 'workshop')!;
  // Clear the plot the way builders would before raising the walls.
  const bp = BLUEPRINTS.workshop;
  for (const p of sim.map.props.filter((p) => p.x >= site.x - 1 && p.x <= site.x + bp.w && p.y >= site.y - 1 && p.y <= site.y + bp.h)) sim.map.removeProp(p);
  BLUEPRINTS.workshop.stamp(sim.map, site.x, site.y, site.doorTop, 'Test Workshop');
  sim.stock.wood = 200;
  sim.stock.stone = 150;
  // A town that size has a few more hands to spare.
  triggerWorldEvent(sim, 'newcomers');
  triggerWorldEvent(sim, 'newcomers');
  allocateRoles(sim);
  return sim;
}

describe('workshop', () => {
  it('names what is holding each chain up', () => {
    const sim = new Sim(7, { agents: false });
    expect(chains(sim).every((c) => c.stuck === 'no workshop yet' || c.have >= c.target)).toBe(true);
    const town = townWithWorkshop();
    town.stock.wood = 0;
    town.stock.planks = 0;
    expect(chains(town).find((c) => c.recipe.good === 'planks')!.stuck).toBe('needs wood');
  });

  it('the trades turn wood and stone into planks, bricks, furniture and tools', () => {
    const sim = townWithWorkshop();
    expect(hasWorkshop(sim)).toBe(true);
    expect(sim.agents.some((a) => a.role === 'carpenter')).toBe(true);
    sim.run(1440);
    expect(sim.stock.planks + sim.stock.furniture * 4).toBeGreaterThan(8);
    expect(sim.stock.bricks).toBeGreaterThan(0);
    expect(sim.stock.furniture + sim.agents.filter((a) => a.action.material === 'furniture').length).toBeGreaterThan(0);
    // Workers pick up the tools as they're made.
    expect(sim.agents.filter((a) => a.tool > 0).length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('new homes need furniture once there is a workshop', () => {
    const sim = townWithWorkshop();
    triggerWorldEvent(sim, 'newcomers');
    for (let k = 0; k < 24 && !sim.projects.some((p) => p.blueprint === 'house'); k++) sim.run(30);
    const home = sim.projects.find((p) => p.blueprint === 'house')!;
    expect(home.need.furniture).toBe(2);
    expect(home.need.planks).toBeGreaterThan(0);
  }, 120_000);
});
