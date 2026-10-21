import { describe, expect, it } from 'vitest';
import { ageOf } from '../src/sim/agents';
import { ADULT_AGE, PRIORITY_KEYS } from '../src/sim/defs';
import { die } from '../src/sim/life';
import { agendaWeight, AGENDA_WEIGHT, concernOf, concernsOf, TERM_FATIGUE, voteScore } from '../src/sim/politics';
import { Sim } from '../src/sim/sim';
import { kinship } from '../src/sim/social';

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
    expect(sim.activity.some((e) => /elected mayor with \d+ votes?\b/.test(e.text))).toBe(true);
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

  it('a birthday on election day starts after the vote, so the family can hear the rally first', () => {
    const sim = new Sim(7);
    const homed = sim.agents.filter((a) => sim.town.households[a.household].building >= 0);
    const host = homed.find((x) => homed.some((y) => y !== x && y.household === x.household && kinship(sim, x, y)))!;
    // Born on election day (day 2 of the calendar), 32 today; nobody else celebrating.
    host.birth = 2 * 1440 + 720 - 2 * 8 * 1440;
    for (const x of sim.agents) if (x !== host) x.lastBirthday = 1;
    at(sim, 2, 18.5);
    expect(sim.election!.stage).toBe('rally');
    expect(sim.events.birthdays).toHaveLength(0);
    at(sim, 2, 19.5);
    expect(sim.lastElection).not.toBeNull();
    expect(sim.events.birthdays.some((b) => b.hosts.includes(host.id))).toBe(true);
    at(sim, 2, 21.9);
    expect(host.memories.some((m) => m.kind === 'myBirthday')).toBe(true);
    expect(sim.agents.some((o) => o !== host && kinship(sim, o, host) && o.memories.some((m) => m.kind === 'birthday' && m.about === host.id))).toBe(true);
  }, 120_000);

  it('a voter backs a clearly better-liked candidate on their second concern over a stranger on their first', () => {
    const sim = new Sim(7);
    const adults = sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE);
    const v = adults[0];
    const [liked, other] = adults.filter((a) => a !== v && !kinship(sim, v, a));
    const wants = concernsOf(sim, v);
    const rel = (id: number, opinion: number) => v.relations.set(id, { opinion, familiarity: 50, lastTalk: 0 });
    rel(liked.id, 22);
    rel(other.id, 10);
    expect(voteScore(sim, v, { id: liked.id, platform: wants[1] })).toBeGreaterThan(voteScore(sim, v, { id: other.id, platform: wants[0] }));
    // Opinions level, the platform decides; a platform they barely hold counts for nothing.
    rel(liked.id, 10);
    expect(voteScore(sim, v, { id: other.id, platform: wants[0] })).toBeGreaterThan(voteScore(sim, v, { id: liked.id, platform: wants[1] }));
    expect(voteScore(sim, v, { id: liked.id, platform: wants[3] })).toBeCloseTo(10 / 25);
  });

  it('a long-serving mayor wears on the town: each term past the first costs a few points of goodwill', () => {
    const sim = new Sim(7);
    const adults = sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE);
    const v = adults[0];
    const mayor = adults.find((a) => a !== v && !kinship(sim, v, a))!;
    v.relations.set(mayor.id, { opinion: 20, familiarity: 50, lastTalk: 0 });
    const c = { id: mayor.id, platform: concernsOf(sim, v)[3] };
    const fresh = voteScore(sim, v, c);
    sim.mayor = mayor.id;
    sim.mayorTerms = 1;
    expect(voteScore(sim, v, c)).toBeCloseTo(fresh);
    sim.mayorTerms = 3;
    expect(voteScore(sim, v, c)).toBeCloseTo(fresh - 2 * TERM_FATIGUE);
  });

  it('a well-liked sitting mayor on a platform few voters put first is re-elected', () => {
    const sim = new Sim(7);
    at(sim, 2, 8);
    const adults = sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE && a.role !== 'retired');
    const mayor = adults[adults.length - 1];
    sim.mayor = mayor.id;
    at(sim, 2, 9.5);
    const race = sim.election!;
    const me = race.candidates.find((c) => c.id === mayor.id)!;
    expect(me).toBeDefined();
    // Put them on the platform the fewest voters hold as their top concern.
    const voters = sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE);
    const firsts = (k: string) => voters.filter((v) => concernOf(sim, v) === k).length;
    me.platform = [...PRIORITY_KEYS].sort((x, y) => firsts(x) - firsts(y))[0];
    // Everyone likes the mayor a dozen points better than whoever they like best among the rest.
    at(sim, 2, 16.9);
    for (const v of voters) {
      if (v === mayor) continue;
      const best = Math.max(...race.candidates.filter((c) => c.id !== mayor.id).map((c) => v.relations.get(c.id)?.opinion ?? 0));
      v.relations.set(mayor.id, { ...(v.relations.get(mayor.id) ?? { familiarity: 50, lastTalk: 0 }), opinion: best + 12 });
    }
    at(sim, 2, 19.5);
    expect(sim.mayor).toBe(mayor.id);
    expect(sim.activity.some((e) => /was re-elected mayor/.test(e.text))).toBe(true);
  }, 120_000);
});

describe('elections across towns', () => {
  // Two elections in each of a few untouched towns. They used to go to the same few platforms in landslides,
  // and a sitting mayor almost never kept the job.
  const results: { platform: string; reelected: boolean; landslide: boolean }[] = [];
  const record = (L: NonNullable<Sim['lastElection']>, reelected: boolean) =>
    results.push({ platform: L.platform, reelected, landslide: L.votes[0][1] > 2 * (L.votes[1]?.[1] ?? 0) });
  for (const seed of [1, 3, 5, 7]) {
    it(`seed ${seed} holds two elections`, () => {
      const sim = new Sim(seed);
      at(sim, 2, 19.5);
      const first = sim.lastElection!;
      record(first, false);
      at(sim, 10, 19.5);
      const second = sim.lastElection!;
      expect(second.year).toBe(first.year + 1);
      record(second, second.winner === first.winner);
    }, 300_000);
  }

  it('races are close, platforms vary, and sitting mayors can be re-elected', () => {    expect(results).toHaveLength(8);
    expect(new Set(results.map((r) => r.platform)).size).toBeGreaterThanOrEqual(3);
    // Races are close (most decided by one to three votes), so how many of four incumbents keep the job swings with
    // any change to town life: measured over seeds 1-8 with the lake in, 2 of 8. A town whose worry was solved (food,
    // once there's fishing) tends to vote for whoever runs on the next one. The bar is that it happens at all.
    expect(results.filter((r) => r.reelected).length).toBeGreaterThanOrEqual(1);
    // Mostly close races. Since mayors are judged on their promises, a broken one can hand a challenger a landslide
    // (seed 5, year 2: 13-6-6): measured 3 of 16 races across seeds 1-8, all 3 of them in these four seeds.
    expect(results.filter((r) => r.landslide).length).toBeLessThanOrEqual(3);
  });
});
