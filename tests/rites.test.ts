import { describe, expect, it } from 'vitest';
import { ageOf } from '../src/sim/agents';
import { die } from '../src/sim/life';
import { COURT_MIN, courtship, eulogy, WEDDING_LENGTH } from '../src/sim/rites';
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

describe('weddings', () => {
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
  it('with a cemetery, the family gathers the next morning, someone speaks, and the grief eases', () => {
    const sim = new Sim(7);
    at(sim, 0, 9);
    // The first death brings a cemetery.
    const first = [...sim.agents].sort((x, y) => x.birth - y.birth)[0];
    die(sim, first, 'old age');
    for (let d = 0; d < 10 && !sim.map.buildings.some((b) => b.kind === 'cemetery'); d++) sim.run(720);
    expect(sim.map.buildings.some((b) => b.kind === 'cemetery')).toBe(true);

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
