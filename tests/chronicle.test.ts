import { describe, expect, it } from 'vitest';
import { createAgent } from '../src/sim/agents';
import { familyTree, obituary, yearPage, years } from '../src/sim/chronicle';
import { RETIRE_AGE, YEAR_DAYS } from '../src/sim/defs';
import { triggerWorldEvent } from '../src/sim/events';
import { die, newcomers, tickLife } from '../src/sim/life';
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

  it('a year page only credits a writer who kept the chronicle that year', () => {
    const sim = new Sim(7);
    sim.run(1);
    // Someone takes up the pen, but only after Year 1 was written up.
    sim.annals[0].writer = undefined;
    const w = sim.agents[0];
    w.role = 'writer';
    expect(yearPage(sim, 1).byline).toMatch(/^Pieced together/);
    sim.run(1);
    expect(sim.annals[0].writer).toEqual({ id: w.id, name: w.name });
    expect(yearPage(sim, 1).byline).toBe(`Kept by ${w.name}, writer`);
    // A later year does not rewrite the credit for earlier ones.
    sim.annals.push({ year: 2, pop: 1, buildings: 1 });
    expect(yearPage(sim, 1).byline).toBe(`Kept by ${w.name}, writer`);
    expect(yearPage(sim, 2).byline).toMatch(/^Pieced together/);
  });

  it('the year summary counts newcomers', () => {
    const sim = new Sim(7);
    sim.run(1);
    const made = newcomers(sim, 3, true);
    sim.run(1);
    expect(made).toHaveLength(3);
    expect(yearPage(sim, 1).summary).toMatch(/3 newcomers/);
  });

  it('survivors are written down at death and do not change as they die in turn', () => {
    const sim = new Sim(7);
    const parent = sim.agents.find((a) => a.children.some((id) => sim.agent(id)) && a.partner !== null)!;
    const partner = sim.agent(parent.partner!)!;
    die(sim, parent, 'old age');
    const before = obituary(sim, parent);
    expect(before).toContain(`Survived by ${partner.name.split(' ')[0]}`);
    die(sim, partner, 'grief');
    for (const id of parent.children) {
      const kid = sim.agent(id);
      if (kid) die(sim, kid, 'old age');
    }
    expect(obituary(sim, parent)).toBe(before);
  });

  it('a widow keeps their late partner on the family tree', () => {
    const sim = new Sim(7);
    const a = sim.agents.find((x) => x.partner !== null && sim.agent(x.partner))!;
    const b = sim.agent(a.partner!)!;
    die(sim, b, 'old age');
    expect(a.partner).toBeNull();
    expect(familyTree(sim, a.id)!.partner).toMatchObject({ id: b.id, alive: false });
    // And the other way round, as before.
    expect(familyTree(sim, b.id)!.partner).toMatchObject({ id: a.id, alive: true });
  });

  it('obituaries mention the skill that set someone apart, not just the one everybody has', () => {
    const sim = new Sim(7);
    for (const a of sim.agents) {
      a.skills.craft.level = 7;
      a.skills.music.level = 1;
    }
    const [plain, singer] = sim.agents.filter((a) => a.role !== 'retired' && a.role !== 'child');
    plain.skills.craft.level = 8;
    singer.skills.music.level = 9;
    die(sim, plain, 'old age');
    die(sim, singer, 'old age');
    expect(obituary(sim, plain)).not.toMatch(/with their hands|making things|built things/);
    expect(obituary(sim, singer)).toMatch(/music|singing|tune/);
  });

  it('a retired person is remembered by the trade they retired from', () => {
    const sim = new Sim(7);
    const a = sim.agents.find((x) => x.role !== 'child' && x.role !== 'retired')!;
    const trade = a.role;
    a.birth = sim.time - ((RETIRE_AGE + 1) / 2) * 1440;
    sim.timers.life = 0;
    tickLife(sim, 1);
    expect(a.role).toBe('retired');
    expect(a.career).toBe(trade);
    die(sim, a, 'old age');
    expect(obituary(sim, a)).toMatch(/worked as an? /);
  });
});
