import { describe, expect, it } from 'vitest';
import { ageOf } from '../src/sim/agents';
import { deeds, DREAMS, dreamLean, dreamLine, tickAspirations } from '../src/sim/aspirations';
import { ADULT_AGE } from '../src/sim/defs';
import { triggerWorldEvent } from '../src/sim/events';
import { die } from '../src/sim/life';
import { Sim } from '../src/sim/sim';
import { rel } from '../src/sim/social';
import { HEADLINE, type Agent } from '../src/sim/types';

const adult = (sim: Sim, ok: (a: Agent) => boolean = () => true) => sim.agents.find((a) => ageOf(sim, a) >= 20 && a.role !== 'retired' && ok(a))!;

describe('life aspirations', () => {
  it('grown-ups take up a dream that fits them; children wait until they grow up', () => {
    const sim = new Sim(7);
    tickAspirations(sim);
    for (const a of sim.agents) {
      if (ageOf(sim, a) < ADULT_AGE) expect(a.dream).toBeUndefined();
      else if (a.dream) expect(DREAMS[a.dream.key].weight(sim, a)).toBeGreaterThan(0);
    }
    const dreamers = sim.agents.filter((a) => a.dream).length;
    expect(dreamers).toBeGreaterThan(sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE).length * 0.8);
    // Nobody retired dreams of mastering a trade.
    expect(sim.agents.some((a) => a.role === 'retired' && a.dream?.key === 'master')).toBe(false);
  });

  it('a dream that comes true is a headline and the best day of their life', () => {
    const sim = new Sim(7);
    const a = adult(sim);
    a.dream = { key: 'master', since: sim.time };
    a.skills.craft.level = 8;
    tickAspirations(sim);
    expect(a.dream.done).toBe(sim.time);
    expect(a.memories.some((m) => m.kind === 'dreamCameTrue')).toBe(true);
    const line = sim.activity.find((e) => e.text.startsWith(`A dream come true: ${a.name} became a master of`))!;
    expect(line.weight).toBe(HEADLINE);
    expect(dreamLine(sim, a)).toMatchObject({ label: 'Dream come true', state: 'done' });
    // Fulfilled dreams stop leaning on choices.
    expect(dreamLean(a, 'work')).toBe(0);
  });

  it('a dream out of reach is let go, and a different one comes along a day later', () => {
    const sim = new Sim(7);
    const a = adult(sim);
    a.dream = { key: 'family', since: sim.time };
    a.birth = sim.time - (55 / 2) * 1440;
    tickAspirations(sim);
    expect(a.dream.lost).toBe(sim.time);
    expect(a.memories.some((m) => m.kind === 'dreamFaded')).toBe(true);
    expect(sim.activity.some((e) => e.text === `${a.name.split(' ')[0]} let go of a dream: the years for a big family have passed`)).toBe(true);
    sim.time += 1441;
    tickAspirations(sim);
    expect(a.dream).toBeDefined();
    expect(a.dream!.key).not.toBe('family');
  });

  it('a competitive soul outlives their rival, or makes peace', () => {
    const sim = new Sim(7);
    const a = adult(sim);
    const [b, c] = sim.agents.filter((x) => x.id !== a.id && ageOf(sim, x) >= 20);
    a.dream = { key: 'outlive', since: sim.time, about: b.id };
    die(sim, b, 'an accident');
    tickAspirations(sim);
    expect(a.dream.done).toBeDefined();
    expect(sim.activity.some((e) => e.text === `A dream come true: ${a.name} outlived ${b.name.split(' ')[0]}`)).toBe(true);

    a.dream = { key: 'outlive', since: sim.time, about: c.id };
    rel(a, c).opinion = 20;
    tickAspirations(sim);
    expect(a.dream.lost).toBeDefined();
    expect(sim.activity.some((e) => e.text === `${a.name.split(' ')[0]} made peace with ${c.name.split(' ')[0]}`)).toBe(true);
  });

  it('dreams lean on what people choose: a festival lover is keener on the festival', () => {
    const sim = new Sim(7);
    const a = adult(sim);
    a.dream = { key: 'festivals', since: sim.time, base: 0 };
    expect(dreamLean(a, 'party')).toBeGreaterThan(0);
    expect(dreamLean(a, 'work')).toBe(0);
  });

  it('festivals danced at and buildings raised are counted for a lifetime', () => {
    const sim = new Sim(7);
    sim.run(16 * 60 - sim.time);
    triggerWorldEvent(sim, 'festival');
    sim.run(200);
    expect(sim.agents.some((a) => deeds(a).festivals === 1)).toBe(true);
  }, 60_000);
});
