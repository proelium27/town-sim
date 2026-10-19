import { describe, expect, it } from 'vitest';
import { billText, GOOD_KEYS } from '../src/sim/defs';
import { loadSim, saveSim, snapshot } from '../src/sim/save';
import { Sim } from '../src/sim/sim';

describe('saving and loading', () => {
  it('a reloaded town carries on exactly as if it never stopped', () => {
    const a = new Sim(7);
    a.run(2 * 1440 + 300);
    const b = loadSim(saveSim(a));
    expect(snapshot(b)).toBe(snapshot(a));
    a.run(720);
    b.run(720);
    expect(b.clock()).toBe(a.clock());
    expect(b.activity.map((e) => e.text)).toEqual(a.activity.map((e) => e.text));
    expect(snapshot(b)).toBe(snapshot(a));
  }, 60_000);

  it('keeps maps, sets and infinities intact', () => {
    const a = new Sim(3);
    a.run(600);
    const b = loadSim(saveSim(a));
    const p = b.agents[0];
    expect(p.relations).toBeInstanceOf(Map);
    expect([...p.relations.values()].some((r) => r.lastTalk === -Infinity)).toBe(true);
    expect(b.map.cell).toBeInstanceOf(Uint8Array);
    expect(b.map.propsOn(b.map.props[0].x, b.map.props[0].y)).toContain(b.map.props[0]);
  });

  it('people in saves from before winter start warm', () => {
    const a = new Sim(3);
    const file = JSON.parse(saveSim(a));
    for (const p of file.sim.agents) delete p.needs.warmth;
    const b = loadSim(JSON.stringify(file));
    expect(b.agents.every((p) => p.needs.warmth === 100)).toBe(true);
  });

  it('rejects files that are not saves', () => {
    expect(() => loadSim('{"hello":1}')).toThrow(/not a Townsfolk save/);
  });
});

describe('calendar', () => {
  it('runs spring, summer, autumn, winter, then a new year', () => {
    const sim = new Sim(7, { agents: false });
    expect(sim.date()).toBe('Spring 1 · Year 1');
    sim.time = 2 * 1440 + 60;
    expect(sim.seasonName).toBe('Summer');
    sim.time = 7 * 1440 + 60;
    expect(sim.date()).toBe('Winter 2 · Year 1');
    sim.time = 8 * 1440 + 60;
    expect(sim.date()).toBe('Spring 1 · Year 2');
  });
});

describe('goods registry', () => {
  it('stores every good and describes project materials', () => {
    const sim = new Sim(7, { agents: false });
    for (const g of GOOD_KEYS) expect(typeof sim.stock[g]).toBe('number');
    expect(billText({ wood: 40, stone: 20 }, { wood: 12 })).toBe('wood 12/40 · stone 0/20');
  });
});
