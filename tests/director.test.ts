import { describe, expect, it } from 'vitest';
import { breaking, candidates, FIRE_SHOT, pickShot, urgent } from '../src/sim/director';
import { triggerWorldEvent } from '../src/sim/events';
import { startFire } from '../src/sim/fire';
import { Sim } from '../src/sim/sim';
import { HEADLINE } from '../src/sim/types';

const rngState = (sim: Sim) => (sim.rng as unknown as { s: number }).s;

describe('director', () => {
  it('watching never draws on the town\'s own dice', () => {
    const sim = new Sim(7);
    sim.run(600);
    const before = rngState(sim);
    for (let i = 0; i < 20; i++) pickShot(sim, new Map());
    expect(rngState(sim)).toBe(before);
  }, 60_000);

  it('cuts to fresh headline news and follows the person it is about', () => {
    const sim = new Sim(7);
    sim.run(60);
    const [a, b] = sim.agents;
    sim.log(`${a.name.split(' ')[0]} and ${b.name.split(' ')[0]} welcomed a baby`, 'family', 'good', a, b).weight = HEADLINE;
    const s = pickShot(sim, new Map(), undefined, () => 0.5)!;
    expect(s.kind).toBe('news');
    expect(s.follow).toBe(a.id);
    expect(urgent(sim, s, new Map())).toBe(true);
    expect(urgent(sim, s, new Map([[s.key, sim.time]]))).toBe(false);
  });

  it('old news is not news', () => {
    const sim = new Sim(7);
    const a = sim.agents[0];
    sim.log('Something big happened', 'family', 'good', a).weight = HEADLINE;
    sim.run(120);
    expect(candidates(sim, () => 0.5).some((s) => s.kind === 'news' && s.follow === a.id)).toBe(false);
  });

  it('holds back what it just showed so the camera roams', () => {
    const sim = new Sim(7);
    sim.run(60);
    const a = sim.agents[0];
    sim.log('Something big happened', 'family', 'good', a).weight = HEADLINE;
    const first = pickShot(sim, new Map(), undefined, () => 0.5)!;
    const second = pickShot(sim, new Map([[first.key, sim.time]]), first.kind, () => 0.5)!;
    expect(second.key).not.toBe(first.key);
  });

  it('frames a festival crowd in the park once people turn up', () => {
    const sim = new Sim(7);
    sim.run(16 * 60 - sim.time);
    triggerWorldEvent(sim, 'festival');
    sim.run(90);
    const shot = candidates(sim, () => 0.5).find((s) => s.kind === 'gathering');
    expect(sim.events.festival!.attendees.size).toBeGreaterThanOrEqual(3);
    expect(shot?.key).toBe('park');
    // The founders' park is around x 45-63, y 0-24.
    expect(shot!.x).toBeGreaterThan(40);
    expect(shot!.y).toBeLessThan(30);
  }, 60_000);

  it('always has something to show on an ordinary afternoon', () => {
    const sim = new Sim(7);
    sim.run(14 * 60 - sim.time);
    const all = candidates(sim, () => 0.5);
    expect(all.some((s) => s.kind === 'establishing')).toBe(true);
    expect(all.some((s) => s.kind === 'quiet')).toBe(true);
  }, 60_000);

  it('a fire outranks every other shot, even a fresh headline, and cuts in at once', () => {
    const sim = new Sim(7);
    sim.run(60);
    const [a, b] = sim.agents;
    sim.log(`${a.name.split(' ')[0]} and ${b.name.split(' ')[0]} welcomed a baby`, 'family', 'good', a, b).weight = HEADLINE;
    const home = sim.map.buildings.find((x) => x.kind === 'house')!;
    startFire(sim, home, 'a lamp knocked over');
    const shot = pickShot(sim, new Map(), 'news', () => 0.5)!;
    expect(shot.key).toBe(`fire:${home.id}`);
    expect(shot.score).toBe(FIRE_SHOT);
    expect(urgent(sim, shot, new Map())).toBe(true);
    // Breaking: it may cut in on a shot that was itself urgent (a wedding scores 28), which nothing else may.
    expect(breaking(shot)).toBe(true);
    const news = candidates(sim, () => 0.5).find((s) => s.kind === 'news')!;
    expect(news.score).toBeLessThan(shot.score);
    expect(breaking(news)).toBe(false);
  }, 60_000);
});
