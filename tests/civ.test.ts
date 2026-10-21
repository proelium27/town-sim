import { describe, expect, it } from 'vitest';
import { ageOf, createAgent } from '../src/sim/agents';
import { triggerWorldEvent } from '../src/sim/events';
import { laborPlan } from '../src/sim/labor';
import { die } from '../src/sim/life';
import { allocateRoles, clutter, findSite, setRole, stageOf } from '../src/sim/planner';
import { Sim, STEP } from '../src/sim/sim';
import { kinship, rel, relationLabel, shiftOpinion } from '../src/sim/social';
import type { Action, Agent, Project } from '../src/sim/types';
import { BLUEPRINTS } from '../src/world/blueprints';
import { Cell } from '../src/world/map';

describe('a self-building town', () => {
  const sim = new Sim(7);
  const startBuildings = sim.map.buildings.length;
  const founders = new Set(sim.agents.map((a) => a.id));

  it('proposes, builds and moves into new buildings without any player input', () => {
    sim.run(10 * 1440);
    const built = sim.map.buildings.slice(startBuildings);
    expect(built.length).toBeGreaterThanOrEqual(3);
    expect(built.some((b) => b.kind === 'house')).toBe(true);
    expect(sim.activity.some((e) => e.text.startsWith('Town meeting:'))).toBe(true);
    // New people born or moved in (with courtship before marriage, a death can still leave the head count flat at day 10).
    expect(sim.agents.some((a) => !founders.has(a.id))).toBe(true);
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

describe('construction', () => {
  it('a fully supplied site within half a point of done still gets finished', () => {
    const sim = new Sim(7);
    while (sim.time < 3 * 1440 && !sim.projects.some((p) => stageOf(sim, p) !== 'clearing')) sim.run(30);
    const pr = sim.projects.find((p) => stageOf(sim, p) !== 'clearing')!;
    for (const [g, n] of Object.entries(pr.need)) pr.delivered[g as keyof typeof pr.need] = n;
    // A builder knocked off for the day just short of the end.
    pr.progress = pr.work - 0.3;
    sim.projects.splice(0, sim.projects.length, pr);
    const b = sim.agents.find((a) => a.role === 'builder')!;
    b.carry = null;
    const plan = laborPlan(sim, b);
    expect(plan?.kind).toBe('build');
    expect(plan?.projectId).toBe(pr.id);
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

  it('a lever on High tilts the crews without emptying the others', () => {
    const sim = new Sim(7);
    sim.run(60);
    const count = (role: string) => sim.agents.filter((a) => a.role === role).length;
    allocateRoles(sim);
    const farmers = count('farmer');
    sim.priorities.food = 2;
    allocateRoles(sim);
    expect(count('farmer')).toBeGreaterThan(farmers);
    for (const lever of ['food', 'housing', 'materials'] as const) {
      sim.priorities = { housing: 1, food: 1, materials: 1, community: 1, [lever]: 2 };
      allocateRoles(sim);
      for (const role of ['farmer', 'builder', 'woodcutter']) expect(count(role), `${role} with ${lever} on High`).toBeGreaterThanOrEqual(1);
    }
  });

  it('with food on High from the start, building and woodcutting carry on', () => {
    const sim = new Sim(7);
    sim.priorities.food = 2;
    const seen = new Set(sim.projects.map((p) => p.id));
    let started = 0;
    for (let h = 0; h < 4 * 24; h++) {
      sim.run(60);
      for (const p of sim.projects) if (!seen.has(p.id)) { seen.add(p.id); started++; }
      expect(sim.agents.filter((a) => a.role === 'builder').length).toBeGreaterThanOrEqual(1);
      expect(sim.agents.filter((a) => a.role === 'woodcutter').length).toBeGreaterThanOrEqual(1);
    }
    expect(started).toBeGreaterThanOrEqual(2);
  }, 300_000);
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

describe('family bonds', () => {
  const sim = new Sim(11);
  const parent = sim.agents.find((a) => a.children.length > 0 && a.partner !== null)!;
  const partner = sim.agent(parent.partner!)!;
  const kid = sim.agent(parent.children[0])!;

  it('recognizes partners, parents, children and new siblings', () => {
    expect(kinship(sim, parent, partner)).toBe('partner');
    expect(kinship(sim, kid, parent)).toBe('parent');
    expect(kinship(sim, parent, kid)).toBe('child');
    const baby = createAgent(sim, { role: 'child', household: parent.household, age: 0, parents: [parent, partner], cell: parent.at });
    sim.agents.push(baby);
    expect(kinship(sim, kid, baby)).toBe('sibling');
    expect(kid.relations.has(baby.id)).toBe(true);
    const outsider = sim.agents.find((o) => o.household !== parent.household)!;
    expect(kinship(sim, parent, outsider)).toBeNull();
  });

  it('ranks family above close friends, unless they have fallen out', () => {
    expect(relationLabel(90)).toBe('Close friend');
    expect(relationLabel(90, 'parent')).toBe('Family');
    expect(relationLabel(10, 'sibling')).toBe('Family');
    expect(relationLabel(-50, 'sibling')).toBe('Estranged family');
  });

  it('family fights sting half as much', () => {
    const outsider = sim.agents.find((o) => o.household !== parent.household)!;
    parent.relations.get(partner.id)!.opinion = 50;
    rel(parent, outsider).opinion = 50;
    shiftOpinion(sim, parent, partner, -10);
    shiftOpinion(sim, parent, outsider, -10);
    expect(parent.relations.get(partner.id)!.opinion).toBe(45);
    expect(parent.relations.get(outsider.id)!.opinion).toBe(40);
  });
});

describe('a build site nobody can reach', () => {
  /** A house site with a wall all the way round it, so no one at the storehouse can walk onto it. */
  function walledSite(): { sim: Sim; pr: Project } {
    const sim = new Sim(7);
    sim.run(150);
    const site = findSite(sim, 'house')!;
    const bp = BLUEPRINTS.house;
    const pr: Project = {
      id: 99, blueprint: 'house', name: 'Walled House', x: site.x, y: site.y, w: bp.w, h: bp.h, doorTop: site.doorTop, path: [],
      need: { ...bp.cost }, delivered: {}, work: bp.work, progress: 0, reason: 'test', forAgents: [], started: sim.time, builders: new Set(),
    };
    for (const p of clutter(sim, pr)) sim.map.removeProp(p);
    for (let y = pr.y - 2; y <= pr.y + pr.h + 1; y++) for (let x = pr.x - 2; x <= pr.x + pr.w + 1; x++) {
      if (x === pr.x - 2 || y === pr.y - 2 || x === pr.x + pr.w + 1 || y === pr.y + pr.h + 1) sim.map.setCell(x, y, Cell.Wall);
    }
    // Nothing else to build, and a crew with time on their hands.
    sim.projects = [pr];
    for (const a of sim.agents.filter((o) => ['engineer', 'designer', 'writer'].includes(o.role))) setRole(sim, a, 'laborer', null);
    sim.stock.wood = 200;
    sim.stock.stone = 150;
    return { sim, pr };
  }

  it('workers do not keep fetching goods for it and putting them back', () => {
    const { sim, pr } = walledSite();
    expect(sim.agents.some((a) => a.role === 'builder' || a.role === 'laborer')).toBe(true);
    const seen = new Map<Agent, Action>();
    const fetched = new Set<Agent>();
    let hauls = 0;
    let returns = 0;
    // A working day.
    for (let i = 0; i < Math.round((6 * 60) / STEP); i++) {
      sim.step();
      for (const a of sim.agents) {
        const act = a.action;
        if (seen.get(a) !== act && act.kind !== 'idle') {
          // A deposit straight after a haul for this site is the load going back to the store.
          if (act.kind === 'deposit' && fetched.has(a)) returns++;
          fetched.delete(a);
          if (act.kind === 'haul' && act.projectId === pr.id) {
            hauls++;
            fetched.add(a);
          }
        }
        seen.set(a, act);
      }
    }
    expect(hauls).toBeLessThanOrEqual(1);
    expect(returns).toBeLessThanOrEqual(1);
    expect(pr.delivered.wood ?? 0).toBe(0);
  }, 120_000);

  it('a load that finds no way onto the site goes quietly back, and hauling there pauses', () => {
    const { sim, pr } = walledSite();
    const a = sim.agents.find((o) => o.role === 'builder' || o.role === 'laborer')!;
    a.carry = null;
    a.action = { kind: 'haul', label: 'Hauling', reason: 'test', stage: 'travel', dest: a.at, timer: 2, started: sim.time, score: 1, projectId: pr.id, leg: 'pickup', material: 'wood' };
    a.path = [];
    a.pathPos = 0;
    a.thinkIn = 30;
    const logged = sim.activity.length;
    sim.step();
    expect(sim.stock.wood).toBe(200);
    expect(a.carry).toBeNull();
    expect(a.action.kind).not.toBe('deposit');
    expect(pr.haulPause ?? 0).toBeGreaterThan(sim.time);
    expect(sim.activity.slice(logged).some((e) => e.text.includes('brought'))).toBe(false);
  });
});
