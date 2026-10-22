import { describe, expect, it } from 'vitest';
import { ageOf } from '../src/sim/agents';
import { ADULT_AGE } from '../src/sim/defs';
import { addMemory } from '../src/sim/social';
import { loadSim, saveSim } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { capacity, members, tickPlanner } from '../src/sim/planner';
import { arrive, cantTravel, expectCart, JOURNEY, partyFor, PURSE_MAX, readTravelers, sendAway, type TravelerFile } from '../src/sim/travel';
import type { Agent } from '../src/sim/types';

/** A household with a couple and at least one child, from a town a few days old. */
function familyTown(): { sim: Sim; family: Agent[] } {
  const sim = new Sim(7);
  sim.run(3 * 1440 + 10 * 60);
  const hh = sim.town.households.find((h) => {
    const fam = sim.agents.filter((a) => a.household === h.id);
    return fam.some((a) => a.partner !== null) && fam.some((a) => ageOf(sim, a) < ADULT_AGE) && fam.length <= 6;
  })!;
  return { sim, family: sim.agents.filter((a) => a.household === hh.id) };
}

const roundTrip = (file: TravelerFile) => readTravelers(JSON.stringify(file));

describe('travelers between towns', () => {
  it('a household sets off: they leave, close ties miss them rather than grieve, the chronicle notes it', () => {
    const { sim, family } = familyTown();
    sim.name = 'Millbrook';
    const friend = sim.agents.find((a) => !family.includes(a))!;
    friend.relations.set(family[0].id, { opinion: 70, familiarity: 80, lastTalk: -Infinity });
    const pop = sim.agents.length;
    const file = sendAway(sim, family);
    expect(sim.agents.length).toBe(pop - family.length);
    expect(sim.departed).toEqual(expect.arrayContaining(family));
    expect(friend.memories.some((m) => m.kind === 'missYou')).toBe(true);
    expect(sim.agents.some((a) => a.memories.some((m) => m.kind === 'grief'))).toBe(false);
    expect(sim.agents.some((a) => a.partner !== null && family.some((f) => f.id === a.partner))).toBe(false);
    expect(sim.activity.some((e) => / set off for another town$/.test(e.text))).toBe(true);
    expect(sim.history.some((h) => h.text.endsWith(' left Millbrook'))).toBe(true);
    expect(file.from.name).toBe('Millbrook');
    expect(file.people.length).toBe(family.length);
  }, 60_000);

  it('they arrive in another town a day and a half later with their trade, skills, family, memories and dream', () => {
    const { sim: home, family } = familyTown();
    home.name = 'Millbrook';
    const lead = family.find((a) => a.partner !== null)!;
    addMemory(home, lead, 'houseFire');
    lead.money = 900;
    const file = roundTrip(sendAway(home, family));

    const there = new Sim(3);
    there.run(1440 + 9 * 60);
    const pop = there.agents.length;
    const e = expectCart(there, file);
    expect(e.at).toBe(there.time + JOURNEY);
    expect(there.activity.some((x) => /on the road from Millbrook/.test(x.text))).toBe(true);
    there.run(JOURNEY - 10);
    expect(there.agents.length).toBe(pop);
    there.run(20);
    expect(there.agents.length).toBe(pop + family.length);
    const come = there.agents.slice(-family.length);
    expect(come.map((a) => a.name)).toEqual(family.map((a) => a.name));
    const lead2 = come[family.indexOf(lead)];
    expect(lead2.from).toBe('Millbrook');
    expect(lead2.traits).toEqual(lead.traits);
    expect(lead2.skills.craft.level).toBe(lead.skills.craft.level);
    expect(lead2.money).toBe(PURSE_MAX);
    expect(Math.abs(ageOf(there, lead2) - ageOf(home, lead))).toBeLessThan(0.5);
    // Family ties come along: the couple is still a couple, the kids still theirs.
    const partner2 = there.agent(lead2.partner!)!;
    expect(come).toContain(partner2);
    const kids2 = come.filter((a) => ageOf(there, a) < ADULT_AGE);
    expect(kids2.length).toBeGreaterThan(0);
    for (const k of kids2) expect(k.parents.length).toBeGreaterThan(0);
    // They talk about the fire back home.
    expect(lead2.memories.some((m) => m.kind === 'houseFire' && /back home/.test(m.label))).toBe(true);
    expect(lead2.memories.some((m) => m.kind === 'freshStart')).toBe(true);
    if (lead.dream && lead.dream.done === undefined && lead.dream.lost === undefined) expect(lead2.dream?.key).toBe(lead.dream.key);
    // One household, and a line in the feed (and so the chronicle).
    expect(new Set(come.map((a) => a.household)).size).toBe(1);
    expect(there.activity.some((x) => x.text.startsWith(`A cart came down the east road: ${lead2.name === come[0].name ? come[0].name : ''}`) && / from Millbrook/.test(x.text))).toBe(true);
    expect(there.chronicle.some((x) => /A cart came down the east road/.test(x.text))).toBe(true);
  }, 120_000);

  it('a town with the same name says so, and a namesake gets a numeral', () => {
    const { sim: home, family } = familyTown();
    const file = roundTrip(sendAway(home, [family.find((a) => ageOf(home, a) >= ADULT_AGE)!]));
    const there = new Sim(7);
    there.run(9 * 60);
    expectCart(there, file);
    there.run(JOURNEY + 5);
    const arrival = there.activity.find((x) => /A cart came down the east road/.test(x.text))!;
    expect(arrival.text).toMatch(/from another town called Northwind/);
    // Seed 7 again: the same founders, so this traveler's name is taken here.
    expect(there.agents[there.agents.length - 1].name).toBe(`${file.people[0].name} II`);
  }, 120_000);

  it('turns away a cart that already came, a third cart in a day, and files that are not travelers', () => {
    const { sim: home, family } = familyTown();
    const adults = family.filter((a) => ageOf(home, a) >= ADULT_AGE);
    const one = roundTrip(sendAway(home, [adults[0]]));
    const two = roundTrip(sendAway(home, [adults[1]]));
    const three = roundTrip(sendAway(home, [home.agents.find((a) => ageOf(home, a) >= ADULT_AGE && !a.illness)!]));
    const there = new Sim(3);
    expectCart(there, one);
    expect(() => expectCart(there, one)).toThrow(/already came/);
    expectCart(there, two);
    expect(() => expectCart(there, three)).toThrow(/already expecting 2 carts today/);
    there.run(1440);
    expect(() => expectCart(there, three)).not.toThrow();

    expect(() => readTravelers('not json')).toThrow(/isn't JSON/);
    expect(() => readTravelers(saveSim(there))).toThrow(/Saved towns go in with Import/);
    expect(() => readTravelers('{"kind":"something-else"}')).toThrow(/isn't a traveler file/);
    expect(() => readTravelers(JSON.stringify({ ...one, people: Array(9).fill(one.people[0]) }))).toThrow(/at most 8/);
    expect(() => readTravelers(JSON.stringify({ ...one, version: 99 }))).toThrow(/different version/);
  }, 120_000);

  it('cleans what it reads: markup, unknown traits and skills out of range never get in', () => {
    const { sim: home, family } = familyTown();
    const raw = JSON.parse(JSON.stringify(sendAway(home, [family[0]])));
    raw.people[0].name = 'Mara <b>Okafor</b>';
    raw.people[0].traits = ['curious', 'telepathic', 'telepathic'];
    raw.people[0].skills.craft = 99;
    raw.people[0].money = 1e9;
    raw.people[0].role = 'emperor';
    raw.from.name = '<img src=x>Millbrook';
    const file = readTravelers(JSON.stringify(raw));
    const p = file.people[0];
    expect(p.name).toBe('Mara bOkafor/b');
    expect(p.traits.every((t) => t !== ('telepathic' as never))).toBe(true);
    expect(p.skills.craft).toBe(10);
    expect(p.money).toBe(PURSE_MAX);
    expect(p.role).toBe('laborer');
    expect(file.from.name).toBe('img src=xMillbrook');
  }, 60_000);

  it('a child never sets off alone', () => {
    const { sim, family } = familyTown();
    const kid = family.find((a) => ageOf(sim, a) < ADULT_AGE)!;
    expect(cantTravel(sim, partyFor(sim, kid, false))).toMatch(/Children travel with a grown-up/);
    expect(cantTravel(sim, partyFor(sim, kid, true))).toBeNull();
  }, 60_000);

  it('a cart on the road survives saving', () => {
    const { sim: home, family } = familyTown();
    const file = roundTrip(sendAway(home, [family[0]]));
    const there = new Sim(3);
    there.name = 'Millbrook';
    expectCart(there, file);
    const again = loadSim(saveSim(there));
    expect(again.name).toBe('Millbrook');
    expect(again.expected.length).toBe(1);
    expect(again.travelSeen).toEqual([file.id]);
    again.run(JOURNEY + 5);
    expect(again.agents.some((a) => a.name === file.people[0].name || a.name === `${file.people[0].name} II`)).toBe(true);
  }, 120_000);

  it('savings over the purse stay behind with the partner, else the children, else the town', () => {
    const { sim } = familyTown();
    const grown = sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE && !a.illness);
    const withPartner = grown.find((a) => a.partner !== null && sim.agent(a.partner) && !sim.agent(a.partner)!.illness)!;
    const partner = sim.agent(withPartner.partner!)!;
    withPartner.money = 1802;
    const partnerBefore = partner.money;
    const file = sendAway(sim, [withPartner]);
    expect(file.people[0].money).toBe(PURSE_MAX);
    expect(partner.money).toBeCloseTo(partnerBefore + 1602, 5);
    expect(sim.activity.some((e) => new RegExp(`left \\$1602 behind to ${partner.name.split(' ')[0]}`).test(e.text))).toBe(true);

    // Nobody to leave it with: the treasury gets it, and nothing vanishes from the world.
    const alone = grown.find((a) => a.partner === null && a.children.every((id) => !sim.agent(id)) && a.id !== withPartner.id)!;
    expect(alone).toBeDefined();
    alone.money = 1000;
    const world = () => sim.agents.reduce((n, a) => n + a.money, 0) + sim.treasury;
    const before = world();
    const file2 = sendAway(sim, [alone]);
    expect(file2.people[0].money).toBe(PURSE_MAX);
    expect(world() + file2.people[0].money).toBeCloseTo(before, 5);
    expect(sim.activity.some((e) => /left \$800 behind to the town/.test(e.text))).toBe(true);
  }, 60_000);

  it('a lone traveler with nowhere to live gets a home proposed with the right verb, even when the town is busy', () => {
    const { sim: home } = familyTown();
    const solo = roundTrip(sendAway(home, [home.agents.find((a) => ageOf(home, a) >= ADULT_AGE && !a.illness && a.partner === null)!]));
    const there = new Sim(3);
    there.run(1440 + 8 * 60);
    const [guest] = arrive(there, solo);
    expect(there.town.households[guest.household].building).toBeLessThan(0);
    // Fill the town's building capacity with other work: a family without a roof still gets its house.
    const busy = there.projects[0];
    expect(busy).toBeDefined();
    while (there.projects.length < 3) there.projects.push({ ...busy, id: there.nextProjectId++, builders: new Set() });
    const had = there.projects.length;
    there.timers.plan = 0;
    tickPlanner(there, 1);
    const house = there.projects.find((p) => p.forAgents.includes(guest.id));
    expect(there.projects.length).toBeGreaterThan(had);
    expect(house?.blueprint).toBe('house');
    expect(house?.reason).toBe(`${guest.name.split(' ')[0]} has nowhere to live`);
  }, 120_000);

  it('a cart takes a spare bed in a home that is not empty before waiting on a house', () => {
    const { sim: home } = familyTown();
    const file = roundTrip(sendAway(home, [home.agents.find((a) => ageOf(home, a) >= ADULT_AGE && !a.illness && a.partner === null)!]));
    const there = new Sim(3);
    there.run(1440 + 8 * 60);
    const h = there.town.households.find((x) => x.building >= 0 && members(there, x.id).length >= 2 && capacity(there, x.id) >= members(there, x.id).length)!;
    expect(h).toBeDefined();
    sendAway(there, [members(there, h.id).find((a) => ageOf(there, a) >= ADULT_AGE && !a.illness)!]);
    expect(capacity(there, h.id) - members(there, h.id).length).toBeGreaterThanOrEqual(1);
    const [guest] = arrive(there, file);
    expect(there.town.households[guest.household].building).toBeGreaterThanOrEqual(0);
    expect(there.activity.some((x) => /nowhere to live yet/.test(x.text))).toBe(false);
  }, 120_000);
});
