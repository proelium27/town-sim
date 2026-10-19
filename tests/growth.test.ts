import { describe, expect, it } from 'vitest';
import { createAgent } from '../src/sim/agents';
import { triggerWorldEvent } from '../src/sim/events';
import { checkTier, extensionSite, paveFrontier, stampExtension, TIER_AT } from '../src/sim/growth';
import { capacity, completeProject, findSite, members, newHousehold, tickPlanner } from '../src/sim/planner';
import { BLUEPRINTS } from '../src/world/blueprints';
import { Cell } from '../src/world/map';
import { Sim } from '../src/sim/sim';

/** A fresh house out on open ground (where a new town house would go), with room on both sides. */
function freshHouse(doorTop = true) {
  const sim = new Sim(7);
  const site = findSite(sim, 'house')!;
  const hh = newHousehold(sim, 'Test home');
  const b = BLUEPRINTS.house.stamp(sim.map, site.x, site.y, doorTop, 'Test home', hh.id);
  Object.assign(hh, { building: b.id, room: b.rooms[0], door: b.door });
  return { sim, hh, b };
}

/** A single mum, a grown son and more little ones than there are beds. */
function crowd(sim: Sim, hh: number) {
  const door = sim.town.households[hh].door;
  const cell = sim.map.idx(door.x, door.y + 2);
  const mum = createAgent(sim, { role: 'laborer', household: hh, age: 45, cell });
  sim.agents.push(mum);
  const son = createAgent(sim, { role: 'laborer', household: hh, age: 20, parents: [mum], cell });
  sim.agents.push(son);
  mum.children.push(son.id);
  while (members(sim, hh).length <= capacity(sim, hh)) {
    const kid = createAgent(sim, { role: 'child', household: hh, age: 2, parents: [mum], cell });
    sim.agents.push(kid);
    mum.children.push(kid.id);
  }
  sim.projects = [];
  sim.treasury = 500;
  return { mum, son };
}

function plan(sim: Sim) {
  sim.timers.plan = 0;
  tickPlanner(sim, 0.05);
}

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
  }, 60_000);

  it('an east wing leaves the bathroom walled off, with two beds and a rug', () => {
    for (const doorTop of [true, false]) {
      const { sim, hh, b } = freshHouse(doorTop);
      const m = sim.map;
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
      // Two beds and a rug, all inside the wing.
      const furnished = m.props.filter((p) => p.w > 0 && p.x >= wing.x && p.x + p.w <= wing.x + wing.w - 1 && p.y > wing.y && p.y < wing.y + wing.h - 1);
      expect(furnished.map((p) => p.key).sort()).toEqual(['bedSingle', 'bedSingle', hh.id % 2 ? 'rugGreen' : 'rugOrange']);
    }
  });

  it('builders step out of the walls when a wing is finished', () => {
    const { sim, hh, b } = freshHouse();
    crowd(sim, hh.id);
    plan(sim);
    const pr = sim.projects.find((p) => p.extends?.building === b.id)!;
    expect(pr).toBeDefined();
    const w = pr.extends!;
    const m = sim.map;
    // A builder working from the far edge of the strip, which becomes the new outer wall.
    const builder = sim.agents.find((a) => a.household !== hh.id)!;
    const edge = m.idx(w.side === 'east' ? w.x + w.w - 1 : w.x, w.y + 3);
    Object.assign(builder, { at: edge, x: m.cx(edge), y: m.cy(edge), px: m.cx(edge), py: m.cy(edge) });
    pr.builders.add(builder.id);
    completeProject(sim, pr);
    expect(m.walkable(m.cx(edge), m.cy(edge))).toBe(false);
    expect(m.walkable(m.cx(builder.at), m.cy(builder.at))).toBe(true);
    expect(builder.at).toBe(m.idx(b.door.x, b.door.y));
  });

  it('a home with a wing going up does not also send someone off to build a house', () => {
    const { sim, hh, b } = freshHouse();
    const { son } = crowd(sim, hh.id);
    // Housing is all the town is thinking about.
    Object.assign(sim.priorities, { housing: 2, food: 0, materials: 0, community: 0 });
    plan(sim);
    expect(sim.projects.some((p) => p.extends?.building === b.id)).toBe(true);
    for (let k = 0; k < 3; k++) {
      // Room in the builders' schedule for something else.
      sim.projects = sim.projects.filter((p) => p.extends);
      plan(sim);
      expect(sim.projects.filter((p) => p.extends?.building === b.id)).toHaveLength(1);
      expect(sim.projects.some((p) => p.forAgents.includes(son.id))).toBe(false);
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
    const logged = sim.activity.length;
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
    // One announcement, and no seasonal festival "called early".
    const said = sim.activity.slice(logged).map((e) => e.text);
    expect(said).toEqual(["Northwind is now a town! There's a charter day in the park"]);
  });

  it('a charter during a festival turns the festival into the charter day', () => {
    const sim = new Sim(7);
    triggerWorldEvent(sim, 'festival');
    const until = sim.events.festival!.until;
    const logged = sim.activity.length;
    const saved = TIER_AT[1];
    TIER_AT[1] = [10, 5];
    try {
      checkTier(sim);
    } finally {
      TIER_AT[1] = saved;
    }
    expect(sim.events.festival).toMatchObject({ name: 'Charter day', until });
    const said = sim.activity.slice(logged).map((e) => e.text);
    expect(said).toEqual(['Northwind is now a town! The spring fair in the park becomes a charter day']);
  });

  it('paving stays out of farm plots', () => {
    const sim = new Sim(7);
    const m = sim.map;
    // A new farm, its door opening onto a plaza tile as when the builders finish one.
    const site = findSite(sim, 'farm')!;
    const farm = BLUEPRINTS.farm.stamp(m, site.x, site.y, site.doorTop, 'Test Farm');
    m.setGround(farm.door.x, farm.door.y, 'plaza');
    const frontier = paveFrontier(sim);
    expect(frontier.length).toBeGreaterThan(0);
    const inLot = (i: number) => m.buildings.some((b) => m.cx(i) >= b.x && m.cx(i) < b.x + b.w && m.cy(i) >= b.y && m.cy(i) < b.y + b.h);
    expect(frontier.filter(inLot)).toEqual([]);
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
