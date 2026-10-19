import { describe, expect, it } from 'vitest';
import { createAgent } from '../src/sim/agents';
import { birthdayOf } from '../src/sim/events';
import { die } from '../src/sim/life';
import { Sim } from '../src/sim/sim';
import { kinship } from '../src/sim/social';

const at = (sim: Sim, day: number, hour: number) => sim.run(day * 1440 + hour * 60 - sim.time);

describe('birthdays', () => {
  it('once a year, the family comes home for cake', () => {
    const sim = new Sim(7);
    const host = sim.agents.find((a) => sim.town.households[a.household].building >= 0 && sim.agents.some((o) => kinship(sim, a, o)) && birthdayOf(a.birth) >= 1)!;
    const day = birthdayOf(host.birth);
    at(sim, day, 18.5);
    const party = sim.events.birthdays.find((b) => b.host === host.id);
    expect(party).toBeDefined();
    expect(sim.map.props.some((p) => p.key === 'cake')).toBe(true);
    at(sim, day, 20.6);
    expect(sim.events.birthdays.some((b) => b.host === host.id)).toBe(false);
    expect(sim.map.props.some((p) => p.key === 'cake')).toBe(false);
    expect(host.memories.some((m) => m.kind === 'myBirthday')).toBe(true);
    expect(sim.agents.some((o) => o.memories.some((m) => m.kind === 'birthday' && m.about === host.id) && kinship(sim, o, host))).toBe(true);
    // Not again until next year.
    at(sim, day + 1, 21);
    expect(sim.activity.filter((e) => e.text.startsWith(`It's ${host.name.split(' ')[0]}'s birthday`)).length).toBe(1);
  }, 60_000);
});

describe('family dinner', () => {
  it('households sit down to dinner together', () => {
    const sim = new Sim(7);
    at(sim, 1, 21);
    expect(sim.agents.filter((a) => a.memories.some((m) => m.kind === 'familyDinner')).length).toBeGreaterThanOrEqual(4);
  }, 60_000);
});

describe('cemetery', () => {
  it('the first death leads to a cemetery, a headstone, and visits from family', () => {
    const sim = new Sim(7);
    at(sim, 0, 9);
    const elder = [...sim.agents].sort((a, b) => a.birth - b.birth).find((a) => sim.agents.some((o) => kinship(sim, o, a)))!;
    die(sim, elder, 'old age');
    expect(sim.unburied).toContain(elder.id);
    for (let d = 0; d < 10 && !sim.map.props.some((p) => p.key === 'grave'); d++) sim.run(720);
    expect(sim.map.buildings.some((b) => b.kind === 'cemetery')).toBe(true);
    const grave = sim.map.props.find((p) => p.key === 'grave')!;
    expect(grave.about).toBe(elder.id);
    expect(sim.unburied).toHaveLength(0);
    sim.run(1440);
    expect(sim.agents.some((a) => a.thoughts.some((t) => t.text === `I miss you, ${elder.name.split(' ')[0]}.`))).toBe(true);
  }, 120_000);
});

describe('names', () => {
  it('babies are sometimes named after a late grandparent', () => {
    const sim = new Sim(7);
    const p = sim.agents.find((a) => a.partner !== null)!;
    const q = sim.agent(p.partner!)!;
    const gp = createAgent(sim, { role: 'retired', household: p.household, age: 75, cell: p.at });
    sim.agents.push(gp);
    p.parents.push(gp.id);
    gp.children.push(p.id);
    die(sim, gp, 'old age');
    const babies = Array.from({ length: 12 }, () => createAgent(sim, { role: 'child', household: p.household, age: 0, parents: [p, q], cell: p.at }));
    const named = babies.filter((b) => b.namedAfter === gp.id);
    expect(named.length).toBeGreaterThan(0);
    expect(named[0].name.split(' ')[0]).toBe(gp.name.split(' ')[0]);
  });
});
