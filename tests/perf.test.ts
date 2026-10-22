import { describe, expect, it } from 'vitest';
import { fallIll } from '../src/sim/health';
import { die, newcomers } from '../src/sim/life';
import { loadSim, saveSim } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { moodParts, moodTarget } from '../src/sim/social';
import type { UseKind } from '../src/world/map';

describe('lookups that replaced full scans', () => {
  it('finding someone by id stays right as people arrive, are born and die', () => {
    const sim = new Sim(7);
    const check = () => {
      for (const a of sim.agents) expect(sim.agent(a.id)).toBe(a);
    };
    check();
    const gone = sim.agents[3];
    die(sim, gone, 'old age');
    expect(sim.agent(gone.id)).toBeUndefined();
    const made = newcomers(sim, 3, true);
    for (const a of made) expect(sim.agent(a.id)).toBe(a);
    sim.run(2 * 1440);
    check();
    expect(sim.agent(-1)).toBeUndefined();
    expect(sim.agent(undefined)).toBeUndefined();
    // A loaded town builds its own index.
    const loaded = loadSim(saveSim(sim));
    for (const a of loaded.agents) expect(loaded.agent(a.id)).toBe(a);
  }, 60_000);

  it('the mood people head toward is exactly the sum of the parts the inspector lists', () => {
    const sim = new Sim(7);
    for (let h = 0; h < 48; h++) {
      sim.run(60);
      for (const a of sim.agents) {
        const sum = moodParts(a).reduce((s, p) => s + p.value, 0);
        expect(moodTarget(a), a.name).toBe(Math.min(100, Math.max(0, sum)));
      }
    }
  }, 60_000);

  it('props by use match a full scan, in the same order, as props come and go', () => {
    const sim = new Sim(7);
    const m = sim.map;
    const scan = (uses: UseKind[]) => m.props.filter((p) => p.use && uses.includes(p.use));
    const sets: UseKind[][] = [['toilet'], ['sleep'], ['eat', 'cook'], ['deposit', 'farm', 'toilet']];
    for (const uses of sets) expect(m.propsWithUses(uses)).toEqual(scan(uses));
    // A tree felled and a crop planted change the lists.
    m.removeProp(m.props.find((p) => p.resource === 'wood')!);
    m.removeProp(m.props.find((p) => p.use === 'toilet')!);
    const farm = m.props.find((p) => p.use === 'farm')!;
    m.addProp({ ...farm, x: farm.x, y: farm.y });
    for (const uses of sets) expect(m.propsWithUses(uses)).toEqual(scan(uses));
    // Callers get their own array.
    m.propsWithUses(['toilet']).length = 0;
    expect(m.propsWithUses(['toilet'])).toEqual(scan(['toilet']));
  });
});

describe('waiting for a restroom', () => {
  it('someone with nowhere to go looks again less and less often, and starts fresh once it passes', () => {
    const sim = new Sim(7);
    // Late evening: the office and shops are shut, so a newcomer with no home has no restroom they may use.
    sim.run(1440 + 21 * 60 - sim.time);
    const [a] = newcomers(sim, 1, true);
    a.needs.energy = 100;
    a.bladder = 5;
    const waits: number[] = [];
    for (let i = 0; i < 20 * 15 && a.action.kind !== 'sleep'; i++) {
      sim.step();
      a.bladder = 5;
      if (a.urgentBackoff !== undefined && waits.at(-1) !== a.urgentBackoff) waits.push(a.urgentBackoff);
    }
    expect(waits.slice(0, 5)).toEqual([0.25, 0.5, 1, 2, 4]);
    a.bladder = 100;
    sim.step();
    expect(a.urgentBackoff).toBeUndefined();
    expect(a.urgentRetryAt).toBeUndefined();
  }, 60_000);

  it('someone who is ill is rethought every step, not spaced out', () => {
    const sim = new Sim(7);
    sim.run(1440 + 21 * 60 - sim.time);
    const [a] = newcomers(sim, 1, true);
    fallIll(sim, a, 'flu', 'test');
    a.needs.energy = 100;
    for (let i = 0; i < 20 * 15 && a.action.kind !== 'sleep'; i++) {
      sim.step();
      a.bladder = 5;
      expect(a.urgentBackoff).toBeUndefined();
    }
  }, 60_000);
});
