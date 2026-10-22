import { describe, expect, it } from 'vitest';
import { laborRate } from '../src/sim/ai';
import { ageOf, freeStations } from '../src/sim/agents';
import { APTITUDES, chooseCareer, finishApprenticeships, FIT, learnBoost } from '../src/sim/careers';
import { ROLES } from '../src/sim/defs';
import { allocateRoles, findSite, openSlots, setRole } from '../src/sim/planner';
import { CRAFT_ROLES } from '../src/sim/workshop';
import { BLUEPRINTS } from '../src/world/blueprints';
import { CLASSIC } from '../src/sim/character';
import { Sim } from '../src/sim/sim';
import type { Agent } from '../src/sim/types';

describe('school', () => {
  it('kids build aptitudes in class', () => {
    // The original town, which has its school by day four.
    const sim = new Sim(7, { character: CLASSIC });
    for (let d = 0; d < 8 && !sim.map.buildings.some((b) => b.kind === 'school'); d++) sim.run(720);
    let day = sim.day + 1;
    while (day % 7 >= 5) day++;
    sim.run(day * 1440 + 8 * 60 - sim.time);
    const kids = sim.agents.filter((a) => a.role === 'child' && sim.time - a.birth > 3 * 1440);
    const total = () => kids.reduce((s, k) => s + APTITUDES.reduce((t, x) => t + k.aptitude[x], 0), 0);
    const before = total();
    sim.run(7 * 60);
    expect(total()).toBeGreaterThan(before + kids.length * 5);
  }, 120_000);
});

describe('careers', () => {
  it("a kid who loves the outdoors follows their farmer parent's trade, as their apprentice", () => {
    const sim = new Sim(7);
    sim.run(60);
    const kid = sim.agents.find((a) => a.role === 'child' && a.parents.length)!;
    const parent = sim.agent(kid.parents[0])!;
    // The town wants more farmers than it has, so there's a place to step into.
    sim.priorities.food = 2;
    for (const a of sim.agents) if (a.role === 'farmer') setRole(sim, a, 'laborer', null);
    setRole(sim, parent, 'farmer', null);
    expect(openSlots(sim).get('farmer')).toBeGreaterThan(0);
    kid.aptitude = { hands: 10, numbers: 10, people: 10, outdoors: 90 };
    kid.birth = sim.time - (18.001 / 2) * 1440;
    sim.timers.life = 0;
    sim.run(5);
    expect(kid.role).toBe('farmer');
    expect(kid.career).toBe('farmer');
    expect(kid.mentor).toBe(parent.id);
    expect(sim.activity.some((e) => e.text.includes('apprenticing as a farmer under their parent'))).toBe(true);
  });

  it('apprentices learn faster, and fastest beside their mentor', () => {
    const sim = new Sim(7);
    const [a, m] = sim.agents.filter((x) => x.role !== 'child');
    expect(learnBoost(sim, a)).toBe(1);
    a.mentor = m.id;
    a.apprenticeUntil = sim.time + 600;
    a.x = m.x + 20;
    expect(learnBoost(sim, a)).toBe(2);
    a.x = m.x + 1;
    a.y = m.y;
    expect(learnBoost(sim, a)).toBe(3);
  });

  it('skill and tools make work go faster', () => {
    const sim = new Sim(7);
    const a = sim.agents.find((x) => x.role !== 'child')!;
    a.needs.energy = 80;
    a.skills.craft.level = 2;
    a.tool = 0;
    const novice = laborRate(a);
    a.skills.craft.level = 9;
    const master = laborRate(a);
    a.tool = 1;
    expect(master).toBeGreaterThan(novice * 1.4);
    expect(laborRate(a)).toBeCloseTo(master * 1.25);
  });

  it('a clinic recruits a doctor like the school and diner do: only while it has an opening', () => {
    const sim = new Sim(7);
    const site = findSite(sim, 'clinic')!;
    BLUEPRINTS.clinic.stamp(sim.map, site.x, site.y, site.doorTop, 'Test Clinic');
    expect(sim.agents.some((a) => a.role === 'doctor')).toBe(false);
    expect(openSlots(sim).get('doctor')).toBe(1);
    // allocateRoles staffs it, and then a grown kid isn't drawn to it.
    allocateRoles(sim);
    expect(sim.agents.filter((a) => a.role === 'doctor').length).toBe(1);
    expect(openSlots(sim).get('doctor') ?? 0).toBe(0);
    for (const kid of sim.agents.filter((a) => a.role === 'child')) {
      kid.aptitude = { hands: 0, numbers: 90, people: 90, outdoors: 0 };
      expect(chooseCareer(sim, kid).role).not.toBe('doctor');
    }
  });

  it('jobs go to people who trained for them', () => {
    const sim = new Sim(7);
    sim.run(60);
    const flex = sim.agents.filter((a) => a.role === 'laborer' || a.role === 'builder' || a.role === 'farmer');
    const keen = flex[flex.length - 1];
    keen.career = 'woodcutter';
    for (const a of sim.agents) if (a.role === 'woodcutter') setRole(sim, a, 'laborer', null);
    allocateRoles(sim);
    expect(keen.role).toBe('woodcutter');
  });
});

describe('career openings', () => {
  const roles = (sim: Sim) => sim.agents.map((a) => [a.id, a.role, a.workBuilding]);

  it('a settled town reshuffles nobody, even someone trained for a full trade', () => {
    const sim = new Sim(3);
    sim.run(4 * 1440);
    allocateRoles(sim);
    // A builder who trained as a woodcutter, while the woodcutters are fully staffed.
    for (const a of sim.agents) if (a.role === 'woodcutter') a.career = 'woodcutter';
    const keen = sim.agents.find((a) => a.role === 'builder');
    if (keen) keen.career = 'woodcutter';
    const before = roles(sim);
    const v = sim.activityVersion;
    for (let i = 0; i < 5; i++) allocateRoles(sim);
    expect(roles(sim)).toEqual(before);
    expect(sim.activityVersion).toBe(v);
  }, 120_000);

  it('people settle into their jobs instead of being rotated every few hours', () => {
    // The original town, on a seed that builds its workshop early (about day 6), so the trades are in the mix.
    const sim = new Sim(3, { character: CLASSIC });
    const days = 14;
    const was = new Map(sim.agents.map((a) => [a.id, { role: a.role, since: sim.time, from: '' }]));
    let moves = 0;
    let flips = 0;
    let backs = 0;
    while (sim.time < days * 1440) {
      sim.run(10);
      for (const a of sim.agents) {
        const w = was.get(a.id);
        if (!w) was.set(a.id, { role: a.role, since: sim.time, from: '' });
        if (!w || w.role === a.role) continue;
        if (ageOf(sim, a) >= 18 && ROLES[w.role].flexible && ROLES[a.role].flexible) moves++;
        const back = w.from === a.role && sim.time - w.since < 1440;
        if (back) backs++;
        if (back && [w.role, a.role].includes('laborer') && [w.role, a.role].some((r) => CRAFT_ROLES.includes(r))) flips++;
        was.set(a.id, { role: a.role, since: sim.time, from: w.role });
      }
    }
    // Before, four to six moves a day, with crafters stood down to labor and taken back within hours.
    expect(sim.map.buildings.some((b) => b.kind === 'workshop')).toBe(true);
    expect(flips).toBe(0);
    expect(backs).toBeLessThanOrEqual(2);
    expect(moves / days).toBeLessThan(2.5);
  }, 300_000);

  it('swapping one outdoor trade for another keeps their own hours', () => {
    const sim = new Sim(7);
    const a = sim.agents.find((x) => x.role !== 'child')!;
    setRole(sim, a, 'builder', null);
    const hours = { ...a.schedule };
    setRole(sim, a, 'woodcutter', null);
    setRole(sim, a, 'toolmaker', null);
    expect(a.schedule).toEqual(hours);
    setRole(sim, a, 'teacher', null);
    expect(a.schedule.workStart).toBe(8);
  });

  it('a kid whose family trade is full picks one with an opening, and keeps it', () => {
    const sim = new Sim(7);
    sim.run(60);
    const kid = sim.agents.find((a) => a.role === 'child' && a.parents.length)!;
    const parent = sim.agent(kid.parents[0])!;
    setRole(sim, parent, 'woodcutter', null);
    // Fill every woodcutter place.
    for (const a of sim.agents) {
      if ((openSlots(sim).get('woodcutter') ?? 0) <= 0) break;
      if (a.role !== 'woodcutter' && a.role !== 'child' && ROLES[a.role].flexible) setRole(sim, a, 'woodcutter', null);
    }
    expect(openSlots(sim).get('woodcutter')).toBeLessThanOrEqual(0);
    kid.aptitude = { hands: 10, numbers: 10, people: 10, outdoors: 90 };
    kid.birth = sim.time - (18.001 / 2) * 1440;
    sim.timers.life = 0;
    sim.run(5);
    expect(kid.career).toBeDefined();
    expect(kid.career).not.toBe('woodcutter');
    expect(kid.role).toBe(kid.career);
    allocateRoles(sim);
    expect(kid.role).toBe(kid.career);
  });

  it('checking which office jobs have a free desk does not use one up', () => {
    const sim = new Sim(7);
    sim.run(60);
    const kid = sim.agents.find((a) => a.role === 'child' && a.parents.length)!;
    const parent = sim.agent(kid.parents[0])!;
    setRole(sim, parent, 'writer', null);
    kid.relations.clear();
    kid.aptitude = { hands: 5, numbers: 60, people: 95, outdoors: 5 };
    // Leave exactly one office desk free.
    const taken = () => new Set(sim.agents.map((o) => o.deskId ?? -1));
    const free = freeStations(sim, 'writer', taken());
    expect(free.length).toBeGreaterThan(0);
    for (const p of free.slice(1)) p.use = undefined;
    expect(freeStations(sim, 'writer', taken()).length).toBe(1);
    expect(chooseCareer(sim, kid).role).toBe('writer');
  });

  it('grown kids follow a parent into their trade far more often than chance', () => {
    let withParent = 0;
    let without = 0;
    let draws = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = new Sim(seed);
      const kid = sim.agents.find((a) => a.role === 'child' && a.parents.length)!;
      const parent = sim.agent(kid.parents[0])!;
      const other = sim.agents.find((a) => !kid.parents.includes(a.id) && a.role !== 'child' && ROLES[a.role].flexible)!;
      kid.relations.clear();
      sim.stock.wood = 0;
      for (let i = 0; i < 40; i++) {
        kid.aptitude = Object.fromEntries(APTITUDES.map((k) => [k, sim.rng.range(10, 60)])) as Agent['aptitude'];
        // The same number of woodcutters either way: the parent, or an unrelated neighbour.
        for (const a of sim.agents) if (a.role === 'woodcutter') setRole(sim, a, 'laborer', null);
        setRole(sim, parent, 'woodcutter', null);
        if (chooseCareer(sim, kid).role === 'woodcutter') withParent++;
        setRole(sim, parent, 'laborer', null);
        setRole(sim, other, 'woodcutter', null);
        if (chooseCareer(sim, kid).role === 'woodcutter') without++;
        setRole(sim, other, 'laborer', null);
        draws++;
      }
    }
    expect(withParent).toBeGreaterThan(without * 2);
    expect(withParent).toBeGreaterThan((draws / Object.keys(FIT).length) * 2);
  });

  it("an apprentice who's helping out elsewhere still qualifies in their own trade", () => {
    const sim = new Sim(7);
    const a = sim.agents.find((x) => x.role !== 'child')!;
    setRole(sim, a, 'laborer', null);
    a.career = 'woodcutter';
    a.apprenticeUntil = sim.time - 1;
    finishApprenticeships(sim);
    const line = sim.activity[sim.activity.length - 1].text;
    expect(line).toContain('finished their apprenticeship as a woodcutter');
    expect(line).toContain('helping out as a laborer');
  });
});
