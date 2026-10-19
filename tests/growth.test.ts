import { describe, expect, it } from 'vitest';
import { createAgent } from '../src/sim/agents';
import { checkTier, extensionSite, stampExtension, TIER_AT } from '../src/sim/growth';
import { capacity, completeProject, findSite, members, newHousehold, tickPlanner } from '../src/sim/planner';
import { BLUEPRINTS } from '../src/world/blueprints';
import { Cell } from '../src/world/map';
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

  it('an east wing leaves the bathroom walled off', () => {
    for (const doorTop of [true, false]) {
      const sim = new Sim(7);
      const m = sim.map;
      // A fresh house out on open ground, with room on both sides.
      const site = findSite(sim, 'house')!;
      const hh = newHousehold(sim, 'Test home');
      const b = BLUEPRINTS.house.stamp(m, site.x, site.y, doorTop, 'Test home', hh.id);
      Object.assign(hh, { building: b.id, room: b.rooms[0], door: b.door });
      const wing = extensionSite(sim, b)!;
      expect(wing.side).toBe('east');
      const oldWall = b.x + b.w - 1;
      const bath: number[] = [];
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (m.ground[m.idx(x, y)] === 'floorTile' && m.cell[m.idx(x, y)] === Cell.Open) bath.push(m.idx(x, y));
      expect(bath.length).toBeGreaterThan(0);
      stampExtension(sim, wing, hh.id);
      // No bathroom tile opens straight into the knocked-through wall or the wing beyond it.
      for (const i of bath) {
        const [x, y] = [m.cx(i), m.cy(i)];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (x + dx >= oldWall) expect(m.walkable(x + dx, y + dy)).toBe(false);
      }
      // But the wing is still open to the rest of the home.
      const openings = [];
      for (let y = b.y + 1; y < b.y + b.h - 1; y++) if (m.walkable(oldWall, y)) openings.push(y);
      expect(openings.length).toBeGreaterThanOrEqual(2);
      expect(sim.nav.findPath(m.idx(b.door.x, b.door.y), m.idx(wing.x + 1, wing.y + 3), 40000)).not.toBeNull();
    }
  });

  it('grown kids settle near their parents', () => {
    const sim = new Sim(7);
    const home = sim.town.households.find((h) => h.building >= 0)!;
    const near = findSite(sim, 'house', home.door)!;
    const anywhere = findSite(sim, 'house')!;
    const dist = (s: { x: number; y: number }) => Math.hypot(s.x - home.door.x, s.y - home.door.y);
    expect(dist(near)).toBeLessThanOrEqual(dist(anywhere));
  });

  it('a grown kid moving out of an overcrowded home builds near the parents', () => {
    const sim = new Sim(7);
    const hh = sim.town.households.find((h) => h.name === 'Novak home')!;
    const mum = sim.agents.find((a) => a.household === hh.id && a.name.startsWith('Anouk'))!;
    const kid = createAgent(sim, { role: 'laborer', household: hh.id, age: 22, parents: [mum], cell: mum.at });
    sim.agents.push(kid);
    mum.children.push(kid.id);
    expect(members(sim, hh.id).length).toBeGreaterThan(capacity(sim, hh.id));
    sim.projects = [];
    sim.treasury = 500;
    sim.timers.plan = 0;
    tickPlanner(sim, 0.05);
    const pr = sim.projects.find((p) => p.forAgents.includes(kid.id))!;
    expect(pr).toBeDefined();
    const dist = (s: { x: number; y: number }) => Math.hypot(s.x - hh.door.x, s.y - hh.door.y);
    // The town-centre default is further out; the kid stays close to home.
    sim.projects = [];
    expect(dist(pr)).toBeLessThan(dist(findSite(sim, 'house')!));
    expect(dist(pr)).toBeLessThan(30);
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
