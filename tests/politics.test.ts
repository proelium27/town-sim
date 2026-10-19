import { describe, expect, it } from 'vitest';
import { ageOf } from '../src/sim/agents';
import { ADULT_AGE } from '../src/sim/defs';
import { die } from '../src/sim/life';
import { agendaWeight, AGENDA_WEIGHT } from '../src/sim/politics';
import { Sim } from '../src/sim/sim';

const at = (sim: Sim, day: number, hour: number) => sim.run(day * 1440 + hour * 60 - sim.time);

describe('elections', () => {
  it('on the first day of summer the town holds a rally and elects a mayor', () => {
    const sim = new Sim(7);
    at(sim, 2, 10);
    const race = sim.election!;
    expect(race.candidates.length).toBeGreaterThanOrEqual(2);
    at(sim, 2, 17.5);
    expect(sim.election!.stage).toBe('rally');
    expect(sim.agents.some((a) => a.action.label === 'Speaking at the rally')).toBe(true);
    at(sim, 2, 19.5);
    expect(sim.mayor).not.toBeNull();
    expect(sim.agenda).not.toBeNull();
    const L = sim.lastElection!;
    const voters = sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE).length;
    expect(L.votes.reduce((s, [, n]) => s + n, 0)).toBeGreaterThanOrEqual(voters - 2);
    expect(sim.activity.some((e) => /elected mayor with \d+ votes/.test(e.text))).toBe(true);
    expect(sim.agent(sim.mayor!)!.memories.some((m) => m.kind === 'wonElection')).toBe(true);
  }, 120_000);

  it('a candidate dying on election day drops out instead of stopping the town', () => {
    const sim = new Sim(7);
    at(sim, 2, 10);
    const [early, late] = sim.election!.candidates.map((c) => sim.agent(c.id)!);
    die(sim, early, 'an accident');
    at(sim, 2, 17.5);
    expect(sim.election!.candidates.some((c) => c.id === early.id)).toBe(false);
    die(sim, late, 'an accident');
    at(sim, 2, 19.5);
    const L = sim.lastElection!;
    expect(L.votes.some(([id]) => id === early.id || id === late.id)).toBe(false);
    expect(sim.agent(sim.mayor!)).toBeDefined();
  }, 120_000);

  it('the election is called off if every candidate is gone', () => {
    const sim = new Sim(7);
    at(sim, 2, 10);
    for (const c of sim.election!.candidates) die(sim, sim.agent(c.id)!, 'an accident');
    at(sim, 2, 19.5);
    expect(sim.election!.stage).toBe('done');
    expect(sim.lastElection).toBeNull();
    expect(sim.activity.some((e) => /called off/.test(e.text))).toBe(true);
  }, 120_000);

  it("the mayor's agenda leans town meetings, and the office empties if they die", () => {
    const sim = new Sim(7);
    const m = sim.agents[0];
    sim.mayor = m.id;
    sim.agenda = 'community';
    expect(agendaWeight(sim, 'community')).toBe(AGENDA_WEIGHT);
    expect(agendaWeight(sim, 'housing')).toBe(1);
    die(sim, m, 'old age');
    expect(sim.mayor).toBeNull();
    expect(agendaWeight(sim, 'community')).toBe(1);
  });
});
