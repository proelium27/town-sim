import { describe, expect, it } from 'vitest';
import { goodNoun, plural, ROLES } from '../src/sim/defs';
import { tickEvents } from '../src/sim/events';
import { CLASSIC } from '../src/sim/character';
import { Sim } from '../src/sim/sim';

/** Advance to a given day index and hour. */
function runTo(sim: Sim, day: number, hour: number): void {
  sim.run(day * 1440 + hour * 60 - sim.time);
}

describe('daily routines', () => {
  // The original town: its office headcount and opening hours are what these check.
  const sim = new Sim(11, { character: CLASSIC });

  it('everyone is asleep at home in the small hours', () => {
    runTo(sim, 1, 2.5);
    for (const a of sim.agents) {
      expect(a.action.kind, a.name).toBe('sleep');
      const room = sim.roomOf(a)!;
      expect(room.id, a.name).toBe(sim.town.households[a.household].room);
    }
  });

  it('weekday mornings: office staff at standup or work, service staff at their posts', () => {
    runTo(sim, 1, 10.15);
    const office = sim.agents.filter((a) => ROLES[a.role].workplace === 'office');
    const inMeeting = office.filter((a) => a.action.kind === 'meet');
    expect(inMeeting.length).toBeGreaterThanOrEqual(office.length - 2);
    const barista = sim.agents.find((a) => a.role === 'barista')!;
    runTo(sim, 1, 11);
    expect(['work', 'toilet', 'snack', 'coffee']).toContain(barista.action.kind);
    expect(sim.roomOf(barista)?.kind).toBe('cafe');
  });

  it('weekday afternoons are spent mostly at desks', () => {
    runTo(sim, 1, 14.5);
    const working = sim.agents.filter((a) => a.action.kind === 'work');
    expect(working.length).toBeGreaterThanOrEqual(7);
  });

  it('no spot is held by someone who is not using it', () => {
    for (const [propId, agentId] of sim.reserved) {
      expect(sim.agent(agentId)!.action.propId).toBe(propId);
    }
  });

  it('weekends are work-free', () => {
    runTo(sim, 5, 11);
    expect(sim.agents.filter((a) => a.action.kind === 'work').length).toBe(0);
  }, 60_000);

  it('a week produces friendships, finished work, skill growth and few near misses', () => {
    runTo(sim, 7, 0);
    expect(sim.tasksCompleted).toBeGreaterThan(20);
    const opinions = sim.agents.flatMap((a) => [...a.relations.values()].map((r) => r.opinion));
    expect(Math.max(...opinions)).toBeGreaterThan(35);
    expect(sim.agents.some((a) => a.skills.craft.level > 6 || a.skills.athletics.xp > 0)).toBe(true);
    const scares = sim.activity.filter((e) => e.text.includes('nearly got hit')).length;
    expect(scares).toBeLessThan(6);
    // Newborns and fresh arrivals haven't had much time to think yet. The arrival log names
    // every newcomer in the group, not just the one it's attached to.
    const arrived = (x: (typeof sim.agents)[number]) =>
      sim.activity.some((e) => sim.time - e.t < 2 * 1440 && (e.text.split('arrived: ')[1]?.split(', ') ?? []).includes(x.name.split(' ')[0]));
    for (const a of sim.agents.filter((x) => sim.time - Math.max(x.birth, 0) > 2 * 1440 && !arrived(x))) {
      expect(a.thoughts.length, a.name).toBeGreaterThan(5);
      expect(a.mood, a.name).toBeGreaterThan(20);
    }
  }, 60_000);
});

describe('events', () => {
  it('a broken coffee machine gets fixed by someone', () => {
    const sim = new Sim(3);
    runTo(sim, 0, 9.5);
    sim.events.coffeeBroken = true;
    sim.run(6 * 60);
    expect(sim.events.coffeeBroken).toBe(false);
    expect(sim.activity.some((e) => e.text.includes('fixed the coffee machine'))).toBe(true);
  });

  it('friday party draws a crowd and leaves good memories', () => {
    const sim = new Sim(5);
    runTo(sim, 4, 20);
    const partied = sim.agents.filter((a) => a.memories.some((m) => m.kind === 'party'));
    expect(partied.length).toBeGreaterThanOrEqual(4);
  }, 30_000);

  it('a party with one guest says "1 person", not "1 people"', () => {
    const sim = new Sim(5);
    sim.events.party = { until: sim.time, attendees: new Set([sim.agents[0].id]) };
    tickEvents(sim, 0);
    expect(sim.activity.map((e) => e.text)).toContain('The party wound down. 1 person had a good time');
  });
});

describe('counts in player-facing text', () => {
  it('pluralise their nouns', () => {
    expect(plural(1, 'person', 'people')).toBe('1 person');
    expect(plural(3, 'person', 'people')).toBe('3 people');
    expect(plural(0, 'person', 'people')).toBe('0 people');
    expect(plural(1, 'friend')).toBe('1 friend');
    expect(plural(2, 'friend')).toBe('2 friends');
    expect(plural(1, 'tree')).toBe('1 tree');
  });

  it('count goods as units or as a mass', () => {
    expect(goodNoun(1, 'planks')).toBe('plank');
    expect(goodNoun(5, 'planks')).toBe('planks');
    expect(goodNoun(1, 'tools')).toBe('tool');
    expect(goodNoun(1, 'bricks')).toBe('brick');
    expect(goodNoun(1, 'food')).toBe('food');
    expect(goodNoun(1, 'firewood')).toBe('firewood');
  });
});
