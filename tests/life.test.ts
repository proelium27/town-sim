import { describe, expect, it } from 'vitest';
import { createAgent } from '../src/sim/agents';
import { birthdayOf, milestoneFor } from '../src/sim/events';
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

describe('milestone birthdays', () => {
  it('only passing 50, 80 or 100 since the last party is a big one', () => {
    expect(milestoneFor(32)).toBeUndefined();
    expect(milestoneFor(48)).toBeUndefined();
    expect(milestoneFor(64)).toBe(50);
    expect(milestoneFor(66)).toBeUndefined();
    expect(milestoneFor(80)).toBe(80);
    expect(milestoneFor(95)).toBe(80);
    expect(milestoneFor(97)).toBeUndefined();
  });

  it("a 32-year-old's party is family only; one since turning 50 invites friends", () => {
    const sim = new Sim(7);
    const homed = sim.agents.filter((a) => sim.town.households[a.household].building >= 0);
    const young = homed[0];
    const old = homed.find((a) => a.household !== young.household)!;
    // Both born on day 1 of the calendar at noon, so the party at 18:00 finds them 32.5 and 64.5.
    young.birth = 1440 + 720 - 2 * 8 * 1440;
    old.birth = 1440 + 720 - 4 * 8 * 1440;
    for (const a of sim.agents) if (a !== young && a !== old) a.lastBirthday = 1;
    at(sim, 1, 18.2);
    const party = (id: number) => sim.events.birthdays.find((b) => b.host === id)!;
    expect(party(young.id).milestone).toBe(false);
    expect(party(old.id).milestone).toBe(true);
    const said = (a: typeof young) => sim.activity.find((e) => e.text.startsWith(`It's ${a.name.split(' ')[0]}'s birthday`))!.text;
    expect(said(young)).toBe(`It's ${young.name.split(' ')[0]}'s birthday: 32 today`);
    expect(said(old)).toBe(`It's ${old.name.split(' ')[0]}'s birthday: 64 today, the first party since turning 50, so friends are invited too`);
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
