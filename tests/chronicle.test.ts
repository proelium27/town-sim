import { describe, expect, it } from 'vitest';
import { createAgent } from '../src/sim/agents';
import { familyTree, obituary, yearPage, years } from '../src/sim/chronicle';
import { YEAR_DAYS } from '../src/sim/defs';
import { triggerWorldEvent } from '../src/sim/events';
import { die } from '../src/sim/life';
import { loadSim, saveSim } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { HEADLINE } from '../src/sim/types';

describe('the chronicle', () => {
  it('keeps every headline after the feed has moved on', () => {
    const sim = new Sim(7);
    triggerWorldEvent(sim, 'drought');
    sim.run(1);
    expect(sim.chronicle.some((e) => /drought has begun/.test(e.text))).toBe(true);
    for (let i = 0; i < 600; i++) sim.log(`chatter ${i}`, 'social');
    sim.run(1);
    expect(sim.activity.some((e) => /drought has begun/.test(e.text))).toBe(false);
    expect(sim.chronicle.some((e) => /drought has begun/.test(e.text))).toBe(true);
    expect(sim.chronicle.some((e) => e.text.startsWith('chatter'))).toBe(false);
  });

  it('notes the town on the first morning of each year', () => {
    const sim = new Sim(7);
    sim.run(1);
    expect(sim.annals[0]).toMatchObject({ year: 1, pop: sim.agents.length });
    sim.run(YEAR_DAYS * 1440 - sim.time + 5);
    expect(sim.annals.map((a) => a.year)).toEqual([1, 2]);
    expect(years(sim)).toEqual([2, 1]);
  }, 120_000);

  it('a year page counts births and deaths from the record, and says so far for this year', () => {
    const sim = new Sim(7);
    sim.run(1);
    const [p, q] = sim.agents.filter((a) => a.partner !== null && sim.agent(a.partner)?.household === a.household);
    const baby = createAgent(sim, { role: 'child', household: p.household, age: 0, parents: [p, sim.agent(p.partner!)!], cell: p.at });
    sim.agents.push(baby);
    sim.milestone(`${baby.name} was born`);
    die(sim, q, 'old age');
    sim.run(1);
    const page = yearPage(sim, 1);
    expect(page.current).toBe(true);
    expect(page.summary).toMatch(/one birth/);
    expect(page.summary).toMatch(/one death/);
    expect(page.summary).toMatch(/so far\.$/);
    expect(page.lines.some((l) => l.text.startsWith(`${q.name} passed away`))).toBe(true);
    expect(page.byline).toMatch(/^Kept by .*, writer$|^Pieced together/);
  });

  it('an obituary only tells what is true, and who they left behind', () => {
    const sim = new Sim(7);
    const parent = sim.agents.find((a) => a.children.some((id) => sim.agent(id)) && a.partner !== null)!;
    const partner = sim.agent(parent.partner!)!;
    die(sim, parent, 'old age');
    const text = obituary(sim, parent);
    expect(text.startsWith(`${parent.name}, `)).toBe(true);
    expect(text).toMatch(/died in Year 1 at \d+\./);
    expect(text).toContain(`Survived by ${partner.name.split(' ')[0]}`);
    expect(text).toMatch(/raised (a child|\d+ children)/);
  });

  it('a family tree spans three generations, the dead included', () => {
    const sim = new Sim(7);
    const parent = sim.agents.find((a) => a.children.some((id) => sim.agent(id)))!;
    const kid = sim.agent(parent.children[0])!;
    const grandkid = createAgent(sim, { role: 'child', household: kid.household, age: 0, parents: [kid], cell: kid.at });
    sim.agents.push(grandkid);
    die(sim, parent, 'old age');
    const t = familyTree(sim, grandkid.id)!;
    expect(t.parents.map((n) => n.id)).toContain(kid.id);
    const gp = t.grandparents.find((n) => n.id === parent.id)!;
    expect(gp.alive).toBe(false);
    expect(gp.note).toMatch(/–Y1$/);
    expect(familyTree(sim, parent.id)!.grandchildren.map((n) => n.id)).toContain(grandkid.id);
  });

  it('survives saving, and an older save starts its chronicle from the headlines in its feed', () => {
    const sim = new Sim(7);
    triggerWorldEvent(sim, 'storm');
    sim.run(30);
    const again = loadSim(saveSim(sim));
    expect(again.chronicle).toEqual(sim.chronicle);
    again.run(30);
    expect(again.chronicle.filter((e) => /storm rolled through/.test(e.text))).toHaveLength(1);

    // A save from before the chronicle: no chronicle fields at all.
    const old = JSON.parse(saveSim(sim));
    delete old.sim.chronicle;
    delete old.sim.chronicleSeen;
    delete old.sim.annals;
    const older = loadSim(JSON.stringify(old));
    expect(older.chronicle.some((e) => /storm rolled through/.test(e.text))).toBe(true);
    older.run(30);
    expect(older.chronicle.filter((e) => /storm rolled through/.test(e.text))).toHaveLength(1);
    expect(older.chronicle.every((e) => sim.activity.some((x) => x.t === e.t && (x.weight ?? 0) >= HEADLINE) || e.t > sim.time)).toBe(true);
  });
});
