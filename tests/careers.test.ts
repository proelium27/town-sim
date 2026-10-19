import { describe, expect, it } from 'vitest';
import { laborRate } from '../src/sim/ai';
import { APTITUDES, learnBoost } from '../src/sim/careers';
import { allocateRoles, setRole } from '../src/sim/planner';
import { Sim } from '../src/sim/sim';

describe('school', () => {
  it('kids build aptitudes in class', () => {
    const sim = new Sim(7);
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
    setRole(sim, parent, 'farmer', null);
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
