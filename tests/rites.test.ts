import { describe, expect, it } from 'vitest';
import { ageOf } from '../src/sim/agents';
import { die } from '../src/sim/life';
import { BLUEPRINTS } from '../src/world/blueprints';
import { capacity, members, moveTo, tickPlanner } from '../src/sim/planner';
import { COURT_MIN, courtship, eulogy, layToRest, scheduleFuneral, tickRites, WEDDING_LENGTH, type Funeral, type Wedding } from '../src/sim/rites';
import { Sim } from '../src/sim/sim';
import { kinship, rel } from '../src/sim/social';
import { HEADLINE, type Agent } from '../src/sim/types';

const at = (sim: Sim, day: number, hour: number) => sim.run(day * 1440 + hour * 60 - sim.time);

/** Two unrelated single adults close in age, made fond of each other. */
function sweethearts(sim: Sim, opinion = 70): [Agent, Agent] {
  const singles = sim.agents.filter((a) => a.partner === null && ageOf(sim, a) >= 20 && ageOf(sim, a) < 45);
  for (const a of singles) {
    for (const b of singles) {
      if (b.id <= a.id || kinship(sim, a, b) || Math.abs(ageOf(sim, a) - ageOf(sim, b)) > 15) continue;
      for (const [x, y] of [[a, b], [b, a]]) Object.assign(rel(x, y), { opinion, familiarity: 60 });
      return [a, b];
    }
  }
  throw new Error('no single pair');
}

/** `n` disjoint pairs of unrelated single adults, made fond of each other. */
function sweetheartPairs(sim: Sim, n: number): [Agent, Agent][] {
  const out: [Agent, Agent][] = [];
  const used = new Set<number>();
  const singles = sim.agents.filter((a) => a.partner === null && ageOf(sim, a) >= 20 && ageOf(sim, a) < 45);
  for (const a of singles) {
    for (const b of singles) {
      if (out.length === n) return out;
      if (b.id <= a.id || used.has(a.id) || used.has(b.id) || kinship(sim, a, b) || Math.abs(ageOf(sim, a) - ageOf(sim, b)) > 15) continue;
      for (const [x, y] of [[a, b], [b, a]]) Object.assign(rel(x, y), { opinion: 80, familiarity: 60 });
      used.add(a.id).add(b.id);
      out.push([a, b]);
    }
  }
  if (out.length < n) throw new Error('not enough pairs');
  return out;
}

/** Engaged, with the wedding due at `time`. */
function engage(sim: Sim, [a, b]: [Agent, Agent], time: number): Wedding {
  for (const [x, y] of [[a, b], [b, a]]) x.court = { with: y.id, stage: 'engaged', since: 0 };
  const w: Wedding = { couple: [a.id, b.id], at: time, until: time + WEDDING_LENGTH, started: false, guests: new Set() };
  sim.events.weddings.push(w);
  return w;
}

/** A cemetery that exists only as far as the funeral code can tell. */
const withCemetery = (sim: Sim) => sim.map.buildings.push({ kind: 'cemetery', id: -1 } as never);

/** Runs the life check until `done`, at most n times. */
function until(sim: Sim, done: () => boolean, n = 40): void {
  for (let i = 0; i < n && !done(); i++) courtship(sim);
}

describe('courtship', () => {
  it('two people who like each other court before they are a couple', () => {
    const sim = new Sim(7);
    const [a, b] = sweethearts(sim);
    until(sim, () => !!a.court);
    expect(a.court).toMatchObject({ with: b.id, stage: 'courting' });
    expect(b.court).toMatchObject({ with: a.id, stage: 'courting' });
    expect(a.partner).toBeNull();
    expect(sim.activity.some((e) => /fell in love and are courting/.test(e.text))).toBe(true);
  });

  it('after a while one of them proposes and a wedding is planned for an evening', () => {
    const sim = new Sim(7);
    const [a, b] = sweethearts(sim, 80);
    until(sim, () => !!a.court);
    sim.run(COURT_MIN + 1);
    until(sim, () => a.court?.stage === 'engaged');
    expect(b.court?.stage).toBe('engaged');
    const w = sim.events.weddings.find((x) => x.couple.includes(a.id))!;
    expect(w).toBeDefined();
    expect((w.at % 1440) / 60).toBe(17);
    expect(sim.activity.some((e) => /proposed to .*, who said yes/.test(e.text))).toBe(true);
  });

  it('courting couples who sour on each other go their separate ways', () => {
    const sim = new Sim(7);
    const [a, b] = sweethearts(sim);
    until(sim, () => !!a.court);
    rel(a, b).opinion = 20;
    courtship(sim);
    expect(a.court).toBeUndefined();
    expect(b.court).toBeUndefined();
    expect(a.memories.some((m) => m.kind === 'heartbroken')).toBe(true);
    expect(sim.activity.some((e) => /went their separate ways/.test(e.text))).toBe(true);
  });

  it('the grieving don\'t start courting', () => {
    const sim = new Sim(7);
    const [a] = sweethearts(sim);
    a.memories.push({ kind: 'grief', label: 'Lost someone close', mood: -18, created: sim.time, expires: sim.time + 1440, major: true });
    for (let i = 0; i < 40; i++) courtship(sim);
    expect(a.court).toBeUndefined();
  });
});

describe('proposals', () => {
  it('nobody proposes while asleep or in the small hours', () => {
    const sim = new Sim(7);
    const [a, b] = sweethearts(sim, 80);
    for (const [x, y] of [[a, b], [b, a]]) x.court = { with: y.id, stage: 'courting', since: -10 * COURT_MIN };
    sim.time = 3 * 60;
    for (let i = 0; i < 60; i++) courtship(sim);
    expect(a.court?.stage).toBe('courting');
    sim.time = 12 * 60;
    b.action.kind = 'sleep';
    for (let i = 0; i < 60; i++) courtship(sim);
    expect(a.court?.stage).toBe('courting');
    b.action.kind = 'idle';
    for (let i = 0; i < 60 && a.court?.stage === 'courting'; i++) courtship(sim);
    expect(a.court?.stage).toBe('engaged');
  });

  it('a second couple is not married the same evening as the first', () => {
    const sim = new Sim(7);
    const [p1, p2] = sweetheartPairs(sim, 2);
    sim.time = 10 * 60;
    const w1 = engage(sim, p1, 17 * 60);
    for (const [x, y] of [p2, [p2[1], p2[0]]] as [Agent, Agent][]) x.court = { with: y.id, stage: 'courting', since: -10 * COURT_MIN };
    for (let i = 0; i < 60 && p2[0].court?.stage === 'courting'; i++) courtship(sim);
    const w2 = sim.events.weddings.find((w) => w.couple.includes(p2[0].id))!;
    expect(w2).toBeDefined();
    expect(Math.floor(w2.at / 1440)).not.toBe(Math.floor(w1.at / 1440));
    expect((w2.at % 1440) / 60).toBe(17);
  });
});

describe('weddings', () => {
  it('a wedding moved indoors still waits out the festival, and says when it moved', () => {
    const sim = new Sim(7);
    const pair = sweetheartPairs(sim, 1)[0];
    sim.time = 1440 + 17 * 60;
    const w = engage(sim, pair, sim.time);
    sim.events.rain = { until: sim.time + 600 };
    sim.events.festival = { until: sim.time + 180, attendees: new Set() };
    tickRites(sim);
    expect(w.started).toBe(false);
    expect(w.at).toBe(sim.time + 180);
    sim.time = w.at;
    sim.events.festival = null;
    tickRites(sim);
    expect(w.started).toBe(true);
    expect(w.home).toBeDefined();
  });

  it('a wedding on an evening that is already taken moves to the next free one and says so once', () => {
    const sim = new Sim(7);
    const [p1, p2, p3] = sweetheartPairs(sim, 3);
    sim.time = 17 * 60;
    const w1 = engage(sim, p1, sim.time);
    const w2 = engage(sim, p2, sim.time);
    // The next evening is spoken for too.
    const w3 = engage(sim, p3, sim.time + 1440);
    tickRites(sim);
    expect(w1.started).toBe(true);
    expect(w2.started).toBe(false);
    expect(Math.floor(w2.at / 1440)).toBe(2);
    expect((w2.at % 1440) / 60).toBe(17);
    expect(w3.at).toBe(1440 + 17 * 60);
    const lines = sim.activity.filter((e) => /wedding is put off until/.test(e.text));
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toMatch(/until \w+ evening/);
    tickRites(sim);
    expect(sim.activity.filter((e) => /wedding is put off until/.test(e.text))).toHaveLength(1);
  });

  it('newlyweds with no room in either home move in once there is, and the planner treats it as urgent meanwhile', () => {
    const sim = new Sim(7);
    const homed = new Set(sim.town.households.filter((h) => h.building >= 0).map((h) => h.id));
    const singles = sim.agents.filter((x) => homed.has(x.household) && x.partner === null && ageOf(sim, x) >= 20 && x.children.length === 0);
    const a = singles[0];
    const b = singles.find((x) => x.household !== a.household)!;
    const [h1, h2] = [a.household, b.household].map((id) => sim.town.households[id]);
    const spare = sim.town.households.find((h) => homed.has(h.id) && h.id !== h1.id && h.id !== h2.id)!;
    a.partner = b.id;
    b.partner = a.id;
    // Both homes full.
    const others = sim.agents.filter((x) => x !== a && x !== b && x.household !== h1.id && x.household !== h2.id);
    for (const hh of [h1, h2]) while (members(sim, hh.id).length < capacity(sim, hh.id)) moveTo(sim, [others.pop()!], hh.id);
    const full = (hh: number) => members(sim, hh).length >= capacity(sim, hh);
    expect(full(h1.id) && full(h2.id)).toBe(true);
    courtship(sim);
    expect(a.household).not.toBe(b.household);

    // No cash to spare, but a home for newlyweds who live apart is built on credit.
    sim.projects = [];
    sim.treasury = BLUEPRINTS.house.coins;
    sim.timers.plan = 0;
    tickPlanner(sim, 0.05);
    expect(sim.projects.some((p) => p.forAgents.includes(a.id))).toBe(true);

    // A bed frees up.
    moveTo(sim, members(sim, h2.id).filter((x) => x !== b), spare.id);
    courtship(sim);
    expect(a.household).toBe(b.household);
  });
});

describe('weddings, start to finish', () => {
  it('the couple marries in front of family and friends, then they are partners', () => {
    const sim = new Sim(7);
    at(sim, 0, 9);
    const [a, b] = sweethearts(sim, 80);
    until(sim, () => !!a.court);
    sim.run(COURT_MIN + 1);
    until(sim, () => a.court?.stage === 'engaged');
    const w = sim.events.weddings.find((x) => x.couple.includes(a.id))!;
    sim.run(w.at + 30 - sim.time);
    expect(w.started).toBe(true);
    expect(a.partner).toBe(b.id);
    expect(sim.agents.some((x) => x.action.label === `At ${a.name.split(' ')[0]} and ${b.name.split(' ')[0]}'s wedding`)).toBe(true);
    sim.run(WEDDING_LENGTH);
    expect(sim.events.weddings.includes(w)).toBe(false);
    expect(a.memories.some((m) => m.kind === 'married')).toBe(true);
    const line = sim.activity.find((e) => / are married!/.test(e.text) && e.agentId === a.id)!;
    expect(line.weight).toBe(HEADLINE);
    expect(sim.agents.some((x) => x.memories.some((m) => m.kind === 'wedding'))).toBe(true);
  }, 60_000);
});

describe('funerals', () => {
  /** A funeral already under way for `dead`. */
  function underway(sim: Sim, dead: Agent): Funeral {
    const f: Funeral = { dead: dead.id, at: sim.time, until: sim.time + 90, started: true, mayor: false, guests: new Set() };
    sim.events.funerals.push(f);
    return f;
  }

  it('the eulogy waits for the first mourner to arrive instead of being given up on', () => {
    const sim = new Sim(7);
    const [dead, mourner] = sim.agents.filter((a) => ageOf(sim, a) >= 20);
    const f = underway(sim, dead);
    sim.time = f.at + 31;
    tickRites(sim);
    expect(f.speaker).toBeUndefined();
    f.guests.add(mourner.id);
    sim.time = f.at + 50;
    tickRites(sim);
    expect(f.speaker).toBe(mourner.id);
  });

  it('nobody is told mourners are gathering if there is no one to come', () => {
    const sim = new Sim(7);
    withCemetery(sim);
    const [dead] = sim.agents.filter((a) => ageOf(sim, a) >= 20);
    // Nobody who is left would grieve them.
    dead.partner = null;
    dead.children = [];
    dead.parents = [];
    for (const o of sim.agents) o.relations.delete(dead.id);
    const f: Funeral = { dead: dead.id, at: 0, until: 0, started: false, mayor: false, guests: new Set() };
    sim.events.funerals.push(f);
    tickRites(sim);
    expect(sim.activity.some((e) => /Mourners are gathering/.test(e.text))).toBe(false);
    sim.time += 200;
    tickRites(sim);
    expect(sim.activity.some((e) => /laid to rest with no one there/.test(e.text))).toBe(true);

    // With a friend left who would come, they are.
    const g = new Sim(7);
    withCemetery(g);
    const [d2, friend] = g.agents.filter((a) => ageOf(g, a) >= 20);
    Object.assign(rel(friend, d2), { opinion: 60 });
    g.events.funerals.push({ dead: d2.id, at: 0, until: 0, started: false, mayor: false, guests: new Set() });
    tickRites(g);
    expect(g.activity.some((e) => /Mourners are gathering/.test(e.text))).toBe(true);
  });

  it('someone who died before the cemetery is given a funeral when they are laid to rest, unless long past', () => {
    const sim = new Sim(7);
    const [early, ancient] = sim.agents.filter((a) => ageOf(sim, a) >= 20);
    die(sim, early, 'old age');
    die(sim, ancient, 'old age');
    expect(sim.unburied).toEqual([early.id, ancient.id]);
    sim.time += 20 * 1440;
    early.died!.at = sim.time - 3 * 1440;
    ancient.died!.at = sim.time - 15 * 1440;
    withCemetery(sim);
    layToRest(sim, early);
    layToRest(sim, ancient);
    expect(sim.events.funerals.map((f) => f.dead)).toEqual([early.id]);
    scheduleFuneral(sim, early, false);
    expect(sim.events.funerals).toHaveLength(1);
  });

  it('with a cemetery, the family gathers the next morning, someone speaks, and the grief eases', () => {
    const sim = new Sim(7);
    at(sim, 0, 9);
    // The first death brings a cemetery.
    const first = [...sim.agents].sort((x, y) => x.birth - y.birth)[0];
    die(sim, first, 'old age');
    for (let d = 0; d < 10 && !sim.map.buildings.some((b) => b.kind === 'cemetery'); d++) sim.run(720);
    expect(sim.map.buildings.some((b) => b.kind === 'cemetery')).toBe(true);
    // The first death gets its funeral once the cemetery is built.
    expect(sim.events.funerals.some((f) => f.dead === first.id) || sim.activity.some((e) => e.text.startsWith(`${first.name} was laid to rest.`))).toBe(true);

    const dead = [...sim.agents].filter((a) => a.children.some((id) => sim.agent(id))).sort((x, y) => x.birth - y.birth)[0];
    die(sim, dead, 'old age');
    const f = sim.events.funerals.find((x) => x.dead === dead.id)!;
    expect(f).toBeDefined();
    expect((f.at % 1440) / 60).toBe(10);
    sim.run(f.at + 60 - sim.time);
    expect(f.guests.size).toBeGreaterThan(0);
    expect(f.speaker).toBeGreaterThan(0);
    expect(sim.activity.some((e) => new RegExp(`spoke at ${dead.name.split(' ')[0]}'s funeral|said a few words for`).test(e.text))).toBe(true);
    sim.run(f.until + 1 - sim.time);
    expect(sim.events.funerals.includes(f)).toBe(false);
    const mourner = sim.agent([...f.guests][0])!;
    expect(mourner.memories.some((m) => m.kind === 'funeral' && m.about === dead.id)).toBe(true);
    expect(sim.activity.some((e) => e.text.startsWith(`${dead.name} was laid to rest.`))).toBe(true);
  }, 120_000);

  it('a eulogy only says what is true of the life', () => {
    const sim = new Sim(7);
    const parent = sim.agents.find((a) => a.children.length > 0 && a.role !== 'child')!;
    const words = eulogy(sim, parent, true);
    expect(words).toContain('served as mayor');
    expect(words.some((w) => /^raised/.test(w))).toBe(true);
    expect(words.some((w) => /^worked as an? /.test(w))).toBe(true);
    const kid = sim.agents.find((a) => a.role === 'child' && a.children.length === 0)!;
    expect(eulogy(sim, kid, false).some((w) => /worked|raised|mayor/.test(w))).toBe(false);
  });
});
