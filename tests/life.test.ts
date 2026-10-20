import { describe, expect, it } from 'vitest';
import { createAgent, surnameOf } from '../src/sim/agents';
import { birthdayOf, milestoneFor, triggerWorldEvent } from '../src/sim/events';
import { die } from '../src/sim/life';
import { loadSim, saveSim } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { kinship } from '../src/sim/social';

const at = (sim: Sim, day: number, hour: number) => sim.run(day * 1440 + hour * 60 - sim.time);

describe('birthdays', () => {
  it('once a year, the family comes home for cake', () => {
    const sim = new Sim(7);
    const host = sim.agents.find((a) => sim.town.households[a.household].building >= 0 && sim.agents.some((o) => kinship(sim, a, o)) && birthdayOf(a.birth) >= 1)!;
    const day = birthdayOf(host.birth);
    at(sim, day, 18.5);
    const party = sim.events.birthdays.find((b) => b.hosts.includes(host.id));
    expect(party).toBeDefined();
    expect(sim.map.props.some((p) => p.key === 'cake')).toBe(true);
    at(sim, day, 20.6);
    expect(sim.events.birthdays.some((b) => b.hosts.includes(host.id))).toBe(false);
    expect(sim.map.props.some((p) => p.key === 'cake')).toBe(false);
    expect(host.memories.some((m) => m.kind === 'myBirthday')).toBe(true);
    expect(sim.agents.some((o) => o.memories.some((m) => m.kind === 'birthday' && m.about === host.id) && kinship(sim, o, host))).toBe(true);
    // Not again until next year.
    at(sim, day + 1, 21);
    // (Seed 7's host shares the day with a housemate, so the log names both.)
    expect(sim.activity.filter((e) => /^It's .*'s birthday/.test(e.text) && e.text.includes(host.name.split(' ')[0])).length).toBe(1);
  }, 60_000);
});

describe('festival on office-party night', () => {
  it('festival-goers count toward the festival, not the office party', () => {
    const sim = new Sim(7);
    at(sim, 0, 17);
    // A Friday: the office party in the lounge and the festival in the park at once.
    sim.events.party = { until: sim.time + 120, attendees: new Set() };
    triggerWorldEvent(sim, 'festival');
    const went = { 'Town festival': new Set<number>(), 'Office party': new Set<number>() } as Record<string, Set<number>>;
    let atParty = new Set<number>();
    let atFestival = new Set<number>();
    for (let t = 0; t < 179; t++) {
      sim.run(1);
      for (const a of sim.agents) if (a.action.kind === 'party' && a.action.stage === 'perform') went[a.action.reason]?.add(a.id);
      if (sim.events.party) atParty = new Set(sim.events.party.attendees);
      if (sim.events.festival) atFestival = new Set(sim.events.festival.attendees);
    }
    expect(went['Town festival'].size).toBeGreaterThan(5);
    for (const id of went['Town festival']) expect(atFestival.has(id)).toBe(true);
    for (const id of atParty) expect(went['Office party'].has(id)).toBe(true);
    sim.run(2);
    expect(sim.activity.some((e) => e.text === `The festival is over. ${atFestival.size} townsfolk danced the night away`)).toBe(true);
  }, 60_000);
});

describe('birthday on a festival evening', () => {
  it('the party waits for the festival to end, and the family comes', () => {
    const sim = new Sim(7);
    const homed = sim.agents.filter((a) => sim.town.households[a.household].building >= 0);
    // A host with family, born on day 3: summer's second day, festival night.
    const host = homed.find((a) => sim.agents.some((o) => o !== a && kinship(sim, a, o)))!;
    host.birth = 3 * 1440 + 720 - 2 * 8 * 1440;
    for (const x of sim.agents) if (x !== host) x.lastBirthday = 1;
    at(sim, 3, 18.5);
    expect(sim.events.festival).not.toBeNull();
    expect(sim.events.birthdays).toHaveLength(0);
    at(sim, 3, 20.25);
    expect(sim.events.birthdays.map((b) => b.hosts)).toEqual([[host.id]]);
    at(sim, 3, 22.6);
    expect(sim.events.birthdays).toHaveLength(0);
    const end = sim.activity.find((e) => e.text.startsWith(`${host.name.split(' ')[0]}'s birthday wound down`))?.text;
    expect(end).toMatch(/: \d+ relatives? /);
    expect(sim.agents.some((o) => kinship(sim, o, host) && o.memories.some((m) => m.kind === 'birthday' && m.about === host.id))).toBe(true);
  }, 60_000);
});

describe('joint birthdays', () => {
  /** Two housemates born the same day (day 1 of the calendar), and nobody else celebrating. */
  const twins = () => {
    const sim = new Sim(7);
    const homed = sim.agents.filter((a) => sim.town.households[a.household].building >= 0);
    const a = homed.find((x) => homed.some((y) => y !== x && y.household === x.household && kinship(sim, x, y)))!;
    const b = homed.find((y) => y !== a && y.household === a.household && kinship(sim, a, y))!;
    a.birth = b.birth = 1440 + 720 - 2 * 8 * 1440;
    for (const x of sim.agents) if (x !== a && x !== b) x.lastBirthday = 1;
    return { sim, a, b };
  };
  const fn = (x: { name: string }) => x.name.split(' ')[0];

  it('housemates sharing a birthday throw one party with one cake', () => {
    const { sim, a, b } = twins();
    at(sim, 1, 18.2);
    expect(sim.events.birthdays).toHaveLength(1);
    expect(sim.events.birthdays[0].hosts).toEqual([a.id, b.id]);
    expect(sim.map.props.filter((p) => p.key === 'cake')).toHaveLength(1);
    expect(sim.activity.some((e) => e.text === `It's ${fn(a)} and ${fn(b)}'s birthday: both 32 today`)).toBe(true);
    at(sim, 1, 20.6);
    expect(sim.events.birthdays).toHaveLength(0);
    expect(sim.activity.some((e) => /^Nobody came/.test(e.text))).toBe(false);
    for (const h of [a, b]) expect(h.memories.find((m) => m.kind === 'myBirthday')!.mood).toBeGreaterThanOrEqual(12);
    // Guests remember the party once, not once per host.
    expect(sim.agents.every((g) => g.memories.filter((m) => m.kind === 'birthday').length <= 1)).toBe(true);
  }, 60_000);

  it('a party saved with a single host still loads and wraps up', () => {
    const { sim, a, b } = twins();
    at(sim, 1, 18.2);
    const old = saveSim(sim).replace(`"hosts":[${a.id},${b.id}]`, `"host":${a.id},"age":32`);
    expect(old).not.toContain('"hosts"');
    const back = loadSim(old);
    expect(back.events.birthdays[0].hosts).toEqual([a.id]);
    at(back, 1, 20.6);
    expect(back.events.birthdays).toHaveLength(0);
    expect(back.agent(a.id)!.memories.some((m) => m.kind === 'myBirthday')).toBe(true);
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
    const party = (id: number) => sim.events.birthdays.find((b) => b.hosts.includes(id))!;
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
    const diners = new Set<number>();
    for (let k = 0; k < 2 * 48; k++) {
      sim.run(30);
      for (const a of sim.agents) if (a.memories.some((m) => m.kind === 'familyDinner')) diners.add(a.id);
    }
    expect(diners.size).toBeGreaterThanOrEqual(5);
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

  it("a namesake's numeral is not passed down as part of the family name", () => {
    expect(surnameOf('Ada Okafor II')).toBe('Okafor');
    expect(surnameOf('Ada Okafor III')).toBe('Okafor');
    expect(surnameOf('Ada Okafor')).toBe('Okafor');
    const sim = new Sim(7);
    const p = sim.agents.find((a) => a.partner !== null)!;
    const q = sim.agent(p.partner!)!;
    const surname = surnameOf(p.name);
    const gp = createAgent(sim, { role: 'retired', household: p.household, age: 75, cell: p.at });
    sim.agents.push(gp);
    p.parents.push(gp.id);
    gp.children.push(p.id);
    // Both the late grandparent and the parent were namesakes themselves.
    gp.name = `${gp.name.split(' ')[0]} ${surname} II`;
    p.name = `${p.name.split(' ')[0]} ${surname} II`;
    die(sim, gp, 'old age');
    const babies = Array.from({ length: 12 }, () => createAgent(sim, { role: 'child', household: p.household, age: 0, parents: [p, q], cell: p.at }));
    for (const b of babies) expect(surnameOf(b.name)).toBe(surname);
    expect(babies.filter((b) => b.namedAfter !== gp.id).every((b) => b.name.split(' ').length === 2)).toBe(true);
    const named = babies.filter((b) => b.namedAfter === gp.id);
    expect(named.length).toBeGreaterThan(0);
    for (const b of named) expect(b.name).toBe(`${gp.name.split(' ')[0]} ${surname} III`);
  });
});
