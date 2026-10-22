import { describe, expect, it } from 'vitest';
import { awayMinutes, CATCH_UP_MAX, digest, hasHeadline, runFor } from '../src/sim/digest';
import { triggerWorldEvent } from '../src/sim/events';
import { die } from '../src/sim/life';
import { Sim } from '../src/sim/sim';
import { HEADLINE, NOTABLE } from '../src/sim/types';

/** A quiet town with a hand-written feed, one line per game minute. */
function feed(lines: [string, number?, ('good' | 'bad')?][]): Sim {
  const sim = new Sim(7);
  sim.activity = [];
  for (const [text, w, tone] of lines) {
    sim.time += 1;
    sim.log(text, 'event', tone ?? 'neutral').weight = w;
  }
  return sim;
}

describe('away digest', () => {
  it('keeps headlines over notable news and chatter, in the order they happened', () => {
    const sim = feed([
      ['chat 1'],
      ['fell in love', NOTABLE],
      ['a baby', HEADLINE],
      ['chat 2'],
      ['a death', HEADLINE, 'bad'],
      ['came of age', NOTABLE],
    ]);
    const d = digest(sim, 0, 3);
    expect(d.lines.map((e) => e.text)).toEqual(['a baby', 'a death', 'came of age']);
    expect(d.more).toBe(3);
    expect(hasHeadline(d)).toBe(true);
  });

  it('only looks at the window it was asked about', () => {
    const sim = feed([['old news', HEADLINE], ['new news', HEADLINE]]);
    const from = sim.activity[1].t;
    expect(digest(sim, from).lines.map((e) => e.text)).toEqual(['new news']);
  });

  it('tells the same news once', () => {
    const sim = feed([['Northwind is without a mayor', HEADLINE], ['chat'], ['Northwind is without a mayor', HEADLINE]]);
    const d = digest(sim, 0);
    expect(d.lines).toHaveLength(1);
    expect(d.more).toBe(2);
  });

  it('a chatty window with no news has nothing to headline', () => {
    const d = digest(feed([['chat'], ['chat again']]), 0);
    expect(d.lines).toEqual([]);
    expect(hasHeadline(d)).toBe(false);
  });

  it('deaths and disasters are logged as headlines', () => {
    const sim = new Sim(7);
    const from = sim.time;
    die(sim, sim.agents[3], 'an accident');
    triggerWorldEvent(sim, 'drought');
    const d = digest(sim, from);
    expect(d.lines.some((e) => /passed away/.test(e.text) && e.weight === HEADLINE)).toBe(true);
    expect(d.lines.some((e) => /drought has begun/.test(e.text) && e.weight === HEADLINE)).toBe(true);
  });

  it('warns about people with nowhere to live', () => {
    const sim = new Sim(7);
    triggerWorldEvent(sim, 'newcomers');
    expect(digest(sim, 0).worry).toMatch(/nowhere to live/);
  });
});

describe('catching up', () => {
  it('turns real time away into game time at the speed the town was running, up to a day', () => {
    expect(awayMinutes(60_000, 1)).toBe(60);
    expect(awayMinutes(60_000, 3)).toBe(180);
    expect(awayMinutes(60_000, 0)).toBe(0);
    expect(awayMinutes(10 * 3600_000, 1)).toBe(CATCH_UP_MAX);
  });

  it('runs exactly the minutes asked for when there is time', () => {
    const sim = new Sim(7);
    const t0 = sim.time;
    expect(runFor(sim, 30, 60_000)).toBeCloseTo(30);
    expect(sim.time - t0).toBeCloseTo(30);
  });

  it('stops when the frame budget runs out and picks up from there', () => {
    const sim = new Sim(7);
    let clock = 0;
    // Each check of the clock costs a millisecond: a 5 ms budget runs a few game minutes, not the hour.
    const ran = runFor(sim, 60, 5, () => clock++);
    expect(ran).toBeGreaterThan(0);
    expect(ran).toBeLessThan(60);
  });
});
