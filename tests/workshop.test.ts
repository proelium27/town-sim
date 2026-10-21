import { describe, expect, it } from 'vitest';
import { triggerWorldEvent } from '../src/sim/events';
import { allocateRoles, billFor, buildCap, clutter, findSite, setRole, shortOf, unstick } from '../src/sim/planner';
import { ageOf } from '../src/sim/agents';
import { ROLES } from '../src/sim/defs';
import { Sim } from '../src/sim/sim';
import { chains, CRAFT_ROLES, hasWorkshop, targetOf } from '../src/sim/workshop';
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
    // A day and a half: the carpenters fill the plank shortfall before they turn to furniture.
    sim.run(1440 + 12 * 60);
    expect(sim.stock.planks + sim.stock.furniture * 4).toBeGreaterThan(8);
    expect(sim.stock.bricks).toBeGreaterThan(0);
    expect(sim.stock.furniture + sim.agents.filter((a) => a.action.material === 'furniture').length).toBeGreaterThan(0);
    // Workers pick up the tools as they're made.
    expect(sim.agents.filter((a) => a.tool > 0).length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('a crafter who starts a batch keeps the job, and nobody flips between a trade and laboring', () => {
    const sim = townWithWorkshop();
    const toolmaker = sim.agents.find((a) => a.role === 'toolmaker') ?? sim.agents.find((a) => a.role === 'laborer')!;
    setRole(sim, toolmaker, 'toolmaker', null);
    sim.stock.tools = 0;
    // Every tool the town wants is already on the bench.
    toolmaker.action = { ...toolmaker.action, kind: 'craft', label: 'Making tools', material: 'tools', timer: 30 };
    sim.stock.tools = targetOf(sim, 'tools') - 2;
    allocateRoles(sim);
    expect(toolmaker.role).toBe('toolmaker');

    // Three days of the workshop running: count everyone's moves between the town's flexible jobs.
    const days = 3;
    const was = new Map(sim.agents.map((a) => [a.id, { role: a.role, since: sim.time, from: '' }]));
    let moves = 0;
    let flips = 0;
    for (let t = 0; t < days * 1440; t += 10) {
      sim.run(10);
      for (const a of sim.agents) {
        const w = was.get(a.id);
        if (!w || w.role === a.role) continue;
        if (ageOf(sim, a) >= 18 && ROLES[w.role as keyof typeof ROLES].flexible && ROLES[a.role].flexible) moves++;
        const pair = [w.role, a.role];
        if (w.from === a.role && pair.includes('laborer') && pair.some((r) => CRAFT_ROLES.includes(r as never)) && sim.time - w.since < 1440) flips++;
        was.set(a.id, { role: a.role, since: sim.time, from: w.role });
      }
    }
    expect(flips).toBe(0);
    // Before, the workshop's trades turned over a few times a day.
    expect(moves).toBeLessThanOrEqual(days * 3);
  }, 120_000);

  it('new homes need furniture once there is a workshop', () => {
    const sim = townWithWorkshop();
    triggerWorldEvent(sim, 'newcomers');
    for (let k = 0; k < 24 && !sim.projects.some((p) => p.blueprint === 'house'); k++) sim.run(30);
    const home = sim.projects.find((p) => p.blueprint === 'house')!;
    expect(home.need.furniture).toBe(2);
    expect(home.need.planks).toBeGreaterThan(0);
  }, 120_000);

  it('the plank target covers the planks that tools still need', () => {
    const sim = new Sim(7);
    sim.stock.tools = 100;
    sim.stock.furniture = 100;
    const base = targetOf(sim, 'planks');
    sim.stock.tools = 0;
    expect(targetOf(sim, 'tools')).toBeGreaterThan(0);
    expect(targetOf(sim, 'planks')).toBe(base + Math.ceil(targetOf(sim, 'tools') / 2));
  });

  it('only jobs that go faster with tools pick them up or wear them down', () => {
    const sim = new Sim(7);
    sim.run(9 * 60);
    sim.stock.tools = 30;
    const farmers = sim.agents.filter((a) => a.role === 'farmer');
    expect(farmers.length).toBeGreaterThanOrEqual(2);
    for (const a of sim.agents) a.tool = 0;
    farmers[0].tool = 0.5;
    let farmed = false;
    for (let k = 0; k < 18; k++) {
      sim.run(10);
      farmed ||= farmers.some((a) => a.action.kind === 'farm' && a.action.stage === 'perform');
    }
    expect(farmed).toBe(true);
    // Farming is no quicker with tools: farmers neither take a set nor wear one out.
    expect(farmers[0].tool).toBe(0.5);
    expect(farmers.slice(1).every((a) => a.tool === 0)).toBe(true);
  }, 120_000);

  it('a new building only asks for workshop goods the town can actually make', () => {
    const sim = townWithWorkshop();
    expect(billFor(sim, 'house').furniture).toBe(2);
    for (const a of sim.agents) if (CRAFT_ROLES.includes(a.role)) setRole(sim, a, 'laborer', null);
    expect(billFor(sim, 'house')).toEqual(BLUEPRINTS.house.cost);
    // Goods already on the shelf are fine even with no one to make more.
    sim.stock.planks = 40;
    sim.stock.bricks = 40;
    sim.stock.furniture = 4;
    expect(billFor(sim, 'house')).toEqual(BLUEPRINTS.house.refined);
  }, 120_000);

  it('a build left waiting a day on workshop goods finishes with wood and stone', () => {
    const sim = new Sim(7, { agents: false });
    const site = findSite(sim, 'house')!;
    const bp = BLUEPRINTS.house;
    const pr = {
      id: 99, blueprint: 'house' as const, name: 'Test House', x: site.x, y: site.y, w: bp.w, h: bp.h, doorTop: site.doorTop, path: site.path,
      need: { ...bp.refined! }, delivered: { wood: 16, stone: 10 }, work: bp.work, progress: 0, reason: 'test', forAgents: [], started: 0, builders: new Set<number>(),
    };
    for (const p of clutter(sim, pr)) sim.map.removeProp(p);
    pr.progress = buildCap(pr);
    sim.projects.push(pr);
    unstick(sim);
    expect(pr.need.planks).toBe(16);
    sim.time += 1440;
    unstick(sim);
    for (const g of ['planks', 'bricks', 'furniture'] as const) expect(shortOf(pr, g)).toBe(0);
    // 16 planks and 2 furniture come from 18 wood; 8 bricks from 6 stone.
    expect(pr.need).toMatchObject({ wood: 34, stone: 16 });
    expect(buildCap(pr)).toBeLessThan(pr.work);
  });
});
