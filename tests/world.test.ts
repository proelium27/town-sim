import { describe, expect, it } from 'vitest';
import { hasUmbrella } from '../src/sim/agents';
import { Sim } from '../src/sim/sim';
import type { Agent } from '../src/sim/types';

describe('desire paths', () => {
  it('busy shortcuts wear into trails, and abandoned ones grass over', () => {
    const sim = new Sim(7);
    sim.run(3 * 1440);
    const g = sim.map.ground;
    expect(g.filter((x) => x === 'worn').length + g.filter((x) => x === 'trail').length).toBeGreaterThan(20);
    expect(g.filter((x) => x === 'trail').length).toBeGreaterThan(5);
    // A trail nobody walks on fades back to grass within a couple of days.
    const m = sim.map;
    const i = m.idx(125, 5);
    m.setGround(125, 5, 'trail');
    m.wear[i] = 30;
    sim.run(3.5 * 1440);
    expect(m.ground[i]).toBe('grass');
  }, 120_000);
});

describe('rain', () => {
  it('the ground gets wet in rain and dries afterwards', () => {
    const sim = new Sim(7);
    sim.run(0.05);
    sim.events.plan = sim.events.plan.filter((e) => e.kind !== 'rain');
    sim.events.rain = { until: sim.time + 90 };
    sim.run(60);
    expect(sim.events.wet).toBeGreaterThan(0.9);
    sim.run(30 + 6 * 60);
    expect(sim.events.wet).toBeLessThan(0.2);
  });

  it('most people carry an umbrella', () => {
    const n = Array.from({ length: 200 }, (_, id) => hasUmbrella({ id } as Agent)).filter(Boolean).length;
    expect(n).toBeGreaterThan(110);
    expect(n).toBeLessThan(170);
  });
});

describe('walking together', () => {
  it('couples go for strolls together', () => {
    const sim = new Sim(7);
    let strolls = 0;
    for (let k = 0; k < 3 * 144; k++) {
      sim.run(10);
      for (const a of sim.agents) if (a.action.kind === 'stroll' && a.action.label.startsWith('Walking with')) strolls++;
    }
    expect(strolls).toBeGreaterThan(0);
  }, 120_000);

  it('a grown-up at home walks a young kid to school', () => {
    const sim = new Sim(7);
    for (let d = 0; d < 8 && !sim.map.buildings.some((b) => b.kind === 'school'); d++) sim.run(720);
    // The next weekday, just before school.
    let day = sim.day + 1;
    while (day % 7 >= 5) day++;
    sim.run(day * 1440 + 8.3 * 60 - sim.time);
    const kid = sim.agents.find((a) => a.role === 'child' && sim.agents.some((p) => p.household === a.household && p.role !== 'child'))!;
    const adult = sim.agents.find((p) => p.household === kid.household && p.role !== 'child')!;
    kid.birth = sim.time - (8 / 2) * 1440;
    const home = sim.map.rooms[sim.town.households[kid.household].room];
    for (const [a, dx] of [[kid, 0], [adult, 1]] as const) {
      a.at = sim.map.idx(home.x + 1 + dx, home.y + home.h - 2);
      a.x = a.px = sim.map.cx(a.at);
      a.y = a.py = sim.map.cy(a.at);
      a.path = [];
      a.thinkIn = 0;
      a.action = { kind: 'relax', label: 'Relaxing', reason: '', stage: 'perform', dest: a.at, timer: 999, started: sim.time, score: 0 };
    }
    adult.thinkIn = 999;
    sim.run(30);
    expect(adult.action.kind === 'escort' || adult.thoughts.some((t) => t.text.startsWith('Dropped '))).toBe(true);
  }, 120_000);
});
