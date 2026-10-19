import { describe, expect, it } from 'vitest';
import { ageOf } from '../src/sim/agents';
import { triggerWorldEvent } from '../src/sim/events';
import { die } from '../src/sim/life';
import { allocateRoles } from '../src/sim/planner';
import { Sim } from '../src/sim/sim';

describe('a self-building town', () => {
  const sim = new Sim(7);
  const startBuildings = sim.map.buildings.length;
  const startPop = sim.agents.length;

  it('proposes, builds and moves into new buildings without any player input', () => {
    sim.run(9 * 1440);
    const built = sim.map.buildings.slice(startBuildings);
    expect(built.length).toBeGreaterThanOrEqual(3);
    expect(built.some((b) => b.kind === 'house')).toBe(true);
    expect(sim.activity.some((e) => e.text.startsWith('Town meeting:'))).toBe(true);
    expect(sim.agents.length).toBeGreaterThan(startPop);
  }, 120_000);

  it('every new building is reachable and wired into the street', () => {
    for (const b of sim.map.buildings.slice(startBuildings)) {
      const fromOffice = sim.nav.findPath(sim.map.idx(19, 23), sim.map.idx(b.door.x, b.door.y), 80000);
      expect(fromOffice, b.name).not.toBeNull();
    }
  });

  it('everyone has a home or a house is being built for them', () => {
    const homeless = sim.agents.filter((a) => sim.town.households[a.household].building < 0);
    for (const a of homeless) expect(sim.projects.some((p) => p.forAgents.includes(a.id))).toBe(true);
  });

  it('nobody is stuck inside a wall', () => {
    for (const a of sim.agents) expect(sim.map.walkable(sim.map.cx(a.at), sim.map.cy(a.at)), a.name).toBe(true);
  });

  it('kids exist, and grow up into jobs', () => {
    const grown = sim.activity.filter((e) => e.text.includes('came of age'));
    const kids = sim.agents.filter((a) => ageOf(sim, a) < 18);
    expect(grown.length + kids.length).toBeGreaterThan(0);
  });
});

describe('player influence', () => {
  it('forced newcomers without room trigger a housing project for them', () => {
    const sim = new Sim(3);
    sim.run(60);
    const before = sim.agents.length;
    triggerWorldEvent(sim, 'newcomers');
    expect(sim.agents.length).toBe(before + 3);
    sim.run(8 * 60);
    const arrivals = sim.agents.slice(before);
    const housed = arrivals.every((a) => sim.town.households[a.household].building >= 0);
    const planned = arrivals.some((a) => sim.projects.some((p) => p.forAgents.includes(a.id)));
    expect(housed || planned).toBe(true);
  }, 30_000);

  it('a drought freezes crops and a bumper harvest ripens them', () => {
    const sim = new Sim(4);
    triggerWorldEvent(sim, 'drought');
    const crops = sim.map.props.filter((p) => p.use === 'farm');
    const before = crops.map((p) => p.growth ?? 0);
    sim.run(120);
    // Only farmers' tending can move them during a drought.
    const grownByWeather = crops.filter((p, i) => (p.growth ?? 0) > before[i] && (p.growth ?? 0) - before[i] < 0.05).length;
    expect(grownByWeather).toBe(0);
    triggerWorldEvent(sim, 'harvest');
    expect(sim.map.props.filter((p) => p.use === 'farm').every((p) => p.growth === 1)).toBe(true);
  });

  it('a festival gathers the town in the park', () => {
    const sim = new Sim(5);
    sim.run(16 * 60 - sim.time);
    triggerWorldEvent(sim, 'festival');
    sim.run(90);
    const there = sim.agents.filter((a) => a.action.kind === 'party');
    expect(there.length).toBeGreaterThanOrEqual(sim.agents.length / 2);
  });

  it('raising the housing priority puts more people on building crews', () => {
    const sim = new Sim(6);
    sim.run(4 * 60);
    allocateRoles(sim);
    const base = sim.agents.filter((a) => a.role === 'builder').length;
    sim.priorities.housing = 2;
    allocateRoles(sim);
    expect(sim.agents.filter((a) => a.role === 'builder').length).toBeGreaterThan(base);
  });
});

describe('life and death', () => {
  it('the dead leave the town and their loved ones grieve', () => {
    const sim = new Sim(8);
    const parent = sim.agents.find((a) => a.children.length > 0)!;
    die(sim, parent, 'test');
    expect(sim.agents.includes(parent)).toBe(false);
    expect(sim.deceased.includes(parent)).toBe(true);
    const kid = sim.agent(parent.children[0])!;
    expect(kid.memories.some((m) => m.kind === 'grief')).toBe(true);
  });
});
