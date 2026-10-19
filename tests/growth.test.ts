import { describe, expect, it } from 'vitest';
import { createAgent } from '../src/sim/agents';
import { checkTier, extensionSite, TIER_AT } from '../src/sim/growth';
import { capacity, completeProject, findSite, members, tickPlanner } from '../src/sim/planner';
import { Sim } from '../src/sim/sim';

describe('homes that grow', () => {
  it('a crowded family home gets a new wing with more beds, reachable from the front door', () => {
    const sim = new Sim(7);
    // The founders' houses are packed in a row; the town's own newer houses have room to grow.
    sim.run(3 * 1440);
    const hh = sim.town.households.find((h) => h.building >= 0 && extensionSite(sim, sim.building(h.building)!) && sim.agents.some((a) => a.household === h.id && a.role !== 'child'))!;
    const parents = sim.agents.filter((a) => a.household === hh.id && a.role !== 'child');
    // More babies than beds.
    while (members(sim, hh.id).length <= capacity(sim, hh.id)) {
      const baby = createAgent(sim, { role: 'child', household: hh.id, age: 0.5, parents: parents.slice(0, 2), cell: parents[0].at });
      sim.agents.push(baby);
    }
    sim.projects = [];
    sim.treasury = 500;
    sim.timers.plan = 0;
    tickPlanner(sim, 0.05);
    const pr = sim.projects.find((p) => p.blueprint === 'extension');
    expect(pr).toBeDefined();
    const b = sim.building(hh.building)!;
    const [w0, beds0] = [b.w, capacity(sim, hh.id)];
    completeProject(sim, pr!);
    expect(b.w).toBe(w0 + 4);
    expect(capacity(sim, hh.id)).toBe(beds0 + 2);
    const room = sim.map.rooms[hh.room];
    const wingCell = sim.map.idx(pr!.extends!.side === 'east' ? room.x + room.w - 2 : room.x + 1, room.y + 2);
    expect(sim.nav.findPath(sim.map.idx(b.door.x, b.door.y), wingCell, 40000)).not.toBeNull();
    expect(sim.map.room[wingCell]).toBe(room.id);
  });

  it('grown kids settle near their parents', () => {
    const sim = new Sim(7);
    const home = sim.town.households.find((h) => h.building >= 0)!;
    const near = findSite(sim, 'house', home.door)!;
    const anywhere = findSite(sim, 'house')!;
    const dist = (s: { x: number; y: number }) => Math.hypot(s.x - home.door.x, s.y - home.door.y);
    expect(dist(near)).toBeLessThanOrEqual(dist(anywhere));
  });
});

describe('town tiers', () => {
  it('a village becomes a town, with a charter day', () => {
    const sim = new Sim(7);
    const saved = TIER_AT[1];
    TIER_AT[1] = [10, 5];
    try {
      checkTier(sim);
    } finally {
      TIER_AT[1] = saved;
    }
    expect(sim.tier).toBe(1);
    expect(sim.events.festival?.name).toBe('Charter day');
    expect(sim.agents.every((a) => a.memories.some((m) => m.kind === 'proudTown'))).toBe(true);
  });

  it('a town paves its dirt paths', () => {
    const sim = new Sim(7);
    sim.run(60);
    sim.tier = 1;
    // Nothing more pressing for the builders: no projects, full stores, nothing in the purse to start more.
    sim.projects = [];
    sim.stock.stone = 500;
    sim.stock.wood = 500;
    const paved = () => sim.map.ground.filter((g) => g === 'sidewalk').length;
    const before = paved();
    for (let k = 0; k < 24; k++) {
      sim.treasury = 0;
      sim.run(60);
    }
    expect(paved()).toBeGreaterThan(before);
  }, 60_000);
});
