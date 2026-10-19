import { describe, expect, it, vi } from 'vitest';
import { Shading } from '../src/render/shading';
import { hasUmbrella } from '../src/sim/agents';
import { invitePartner } from '../src/sim/ai';
import { Sim } from '../src/sim/sim';
import type { Agent } from '../src/sim/types';
import { TownMap } from '../src/world/map';

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

  it('wear only redraws the lawn near it, not the whole map', () => {
    const m = new TownMap(64, 64);
    const sh = new Shading(m);
    const lawn = vi.spyOn(Shading.prototype as unknown as { lawn: (c: number) => void }, 'lawn');
    const v = m.lawnVersion;
    const i = m.idx(20, 20);
    for (let k = 0; k < 30; k++) m.step(i);
    expect(m.ground[i]).toBe('trail');
    expect(m.lawnVersion).toBe(v);
    // The cell and its neighbours repaint (a trail's grassy edges depend on them).
    expect(new Set(m.groundDirty)).toEqual(new Set([i, i - 1, i + 1, i - 64, i + 64]));
    for (const d of m.groundDirty) sh.touch(d);
    m.groundDirty.length = 0;
    sh.sync();
    expect(lawn).toHaveBeenCalledTimes(1);
    // A real ground change (a new path) still rebuilds the lot.
    lawn.mockClear();
    m.setGround(5, 5, 'dirt');
    expect(m.lawnVersion).toBe(v + 1);
    sh.sync();
    expect(lawn).toHaveBeenCalledTimes(16);
    lawn.mockRestore();
  });
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
    for (let k = 0; k < 5 * 144; k++) {
      sim.run(10);
      for (const a of sim.agents) if (a.action.kind === 'stroll' && a.action.label.startsWith('Walking with')) strolls++;
    }
    expect(strolls).toBeGreaterThan(0);
  }, 120_000);

  it('only a partner close by is asked along on a walk', () => {
    const sim = new Sim(7);
    sim.run(10 * 60);
    const a = sim.agents.find((x) => x.partner !== null && sim.agent(x.partner)?.partner === x.id)!;
    const b = sim.agent(a.partner!)!;
    const m = sim.map;
    const place = (p: Agent, x: number, y: number) => {
      p.at = m.idx(x, y);
      p.x = p.px = x;
      p.y = p.py = y;
      p.path = [];
      p.walkWith = undefined;
      p.needs.energy = 90;
    };
    // Both outdoors on open grass, but far apart.
    const open = (x: number, y: number) => m.walkable(x, y) && m.room[m.idx(x, y)] < 0 && m.cost[m.idx(x, y)] < 1;
    const spot = (x0: number) => {
      for (let y = 2; y < m.h; y++) for (let x = x0; x < x0 + 10; x++) if (open(x, y) && open(x + 1, y) && open(x + 2, y)) return [x, y];
      throw new Error('no open ground');
    };
    const [ax, ay] = spot(46);
    const [bx, by] = spot(110);
    const walk = () => {
      a.action = { kind: 'stroll', label: 'Walking', reason: 'Evening walk', stage: 'travel', dest: m.idx(ax + 2, ay), timer: 30, started: sim.time, score: 1 };
      b.action = { kind: 'idle', label: 'Idle', reason: '', stage: 'perform', dest: b.at, timer: 0, started: sim.time, score: 0 };
      invitePartner(sim, a);
    };
    sim.time = sim.day * 1440 + 19.5 * 60;
    place(a, ax, ay);
    place(b, bx, by);
    walk();
    expect(b.action.kind).toBe('idle');
    // Right next to each other, they go together.
    place(b, ax + 1, ay);
    walk();
    expect(b.action.kind).toBe('stroll');
    expect(b.walkWith).toBe(a.id);
  }, 60_000);

  it('on school mornings, a grown-up walks a young kid to school before work', () => {
    // An untouched town: nobody is placed by hand.
    const sim = new Sim(11);
    const was = new Map<number, string>();
    const runs: string[] = [];
    for (let k = 0; k < 10 * 288; k++) {
      sim.run(5);
      for (const a of sim.agents) {
        if (a.action.kind === 'escort' && was.get(a.id) !== 'escort') {
          const kid = sim.agent(a.action.partnerId)!;
          expect(kid.action.kind).toBe('learn');
          runs.push(`day ${sim.day} ${a.action.label}`);
        }
        was.set(a.id, a.action.kind);
      }
    }
    expect(runs.length).toBeGreaterThanOrEqual(2);
  }, 600_000);

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
