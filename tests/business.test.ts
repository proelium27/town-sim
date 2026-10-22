import { describe, expect, it } from 'vitest';
import { ageOf } from '../src/sim/agents';
import { type Business, type BusinessKind, BUSINESSES, buildCost, closeBusiness, FLOAT, founderFor, neighbourlyDinner, ownedBy, priceAt, sell, settleBusinesses, townMeal, wealthWord } from '../src/sim/business';
import { startFestival } from '../src/sim/events';
import { ADULT_AGE, MIN_PER_DAY, RETIRE_AGE, YEARS_PER_DAY } from '../src/sim/defs';
import { die, tickLife } from '../src/sim/life';
import { price, TAX } from '../src/sim/market';
import { completeProject, findSite, proposals, startProject } from '../src/sim/planner';
import { loadSim, saveSim } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { sendAway } from '../src/sim/travel';
import type { Agent } from '../src/sim/types';
import { BLUEPRINTS } from '../src/world/blueprints';

const at = (sim: Sim, day: number, hour: number) => sim.run(day * 1440 + hour * 60 - sim.time);
/** Makes someone this many years old. */
const ageTo = (sim: Sim, a: Agent, years: number) => (a.birth = sim.time - (years / YEARS_PER_DAY) * MIN_PER_DAY);
const adults = (sim: Sim) => sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE && a.role !== 'retired' && sim.mayor !== a.id);

/** A town of 22 with no business yet, mid-morning (seed 6, day 8). */
function town(): Sim {
  const sim = new Sim(6);
  at(sim, 8, 9);
  return sim;
}

/** Someone with the itch and the savings to start a place. */
function founder(sim: Sim, kind: BusinessKind, money = 400): Agent {
  const a = adults(sim).find((x) => !ownedBy(sim, x) && x.role !== 'builder')!;
  a.traits = ['workaholic'];
  a.skills.cooking.level = 6;
  a.skills.charisma.level = 6;
  a.money = money;
  for (const o of adults(sim)) if (o !== a) o.money = Math.min(o.money, kind === 'bakery' ? 100 : 120);
  return a;
}

/** Builds the business straight away, where the town would put it, run by its founder. */
function open(sim: Sim, kind: BusinessKind, owner: Agent): Business {
  const site = findSite(sim, kind)!;
  const bp = BLUEPRINTS[kind];
  completeProject(sim, {
    id: sim.nextProjectId++, blueprint: kind, name: kind === 'bakery' ? `${owner.name.split(' ')[0]}'s Bakery` : 'The Old Oak', x: site.x, y: site.y, w: bp.w, h: bp.h,
    doorTop: site.doorTop, path: site.path, need: {}, delivered: {}, work: bp.work, progress: bp.work, reason: 'test', forAgents: [], started: sim.time, builders: new Set(), owner: owner.id, loan: 0,
  });
  return ownedBy(sim, owner)!;
}

describe('private businesses', () => {
  it('someone with savings, the trade and the itch proposes a bakery of their own; nobody broke does', () => {
    const sim = town();
    expect(sim.agents.length).toBeGreaterThanOrEqual(20);
    for (const a of sim.agents) a.money = Math.min(a.money, 60);
    expect(proposals(sim).some((p) => p.bp === 'bakery')).toBe(false);
    const f = founder(sim, 'bakery');
    const p = proposals(sim).find((x) => x.bp === 'bakery')!;
    expect(p.owner).toBe(f);
    expect(p.name).toBe(`${f.name.split(' ')[0]}'s Bakery`);
    expect(p.reason).toMatch(/saved up for a bakery of their own/);
  }, 60_000);

  it('the founder pays for the build, and borrows from the town what their savings do not cover', () => {
    const sim = town();
    const rich = founder(sim, 'bakery', 400);
    const p = proposals(sim).find((x) => x.bp === 'bakery')!;
    const treasury = sim.treasury;
    const pr = startProject(sim, p)!;
    expect(pr.owner).toBe(rich.id);
    expect(pr.loan).toBe(0);
    expect(rich.money).toBe(400 - 196);
    expect(sim.treasury).toBe(treasury + 196);

    const sim2 = town();
    const short = founder(sim2, 'bakery', 140);
    const p2 = proposals(sim2).find((x) => x.bp === 'bakery')!;
    const t2 = sim2.treasury;
    const pr2 = startProject(sim2, p2)!;
    expect(short.money).toBe(20);
    expect(pr2.loan).toBe(196 - 120);
    expect(sim2.treasury).toBe(t2 + 120 - 76);
    expect(sim2.activity.some((e) => /put \$120 of their savings into .* and borrowed \$76 from the town/.test(e.text))).toBe(true);
  }, 180_000);

  it('the owner runs the counter; customers pay the till, the town gets its cut and the food money', () => {
    const sim = town();
    const owner = founder(sim, 'bakery');
    const biz = open(sim, 'bakery', owner);
    expect(owner.role).toBe('baker');
    expect(owner.deskId).not.toBeNull();
    expect(sim.activity.some((e) => e.text === `${biz.name} opened its doors, run by ${owner.name.split(' ')[0]}`)).toBe(true);
    const customer = adults(sim).find((a) => a !== owner)!;
    customer.money = 100;
    const treasury = sim.treasury;
    const meal = priceAt(sim, biz.building, 'meal');
    sell(sim, customer, biz.building, 'meal');
    expect(customer.money).toBe(100 - meal);
    expect(biz.takings).toBe(meal);
    expect(biz.served).toBe(1);
    expect(sim.treasury - treasury).toBeGreaterThan(meal * TAX);
    expect(biz.till).toBeLessThan(FLOAT + meal * (1 - TAX));
    // The owner at their own counter pays the food and no more: no tax, nothing through the till.
    const till = biz.till;
    const takings = biz.takings;
    const served = biz.served;
    const ownerMoney = owner.money;
    const treasuryBefore = sim.treasury;
    expect(priceAt(sim, biz.building, 'meal', owner)).toBe(price(sim, 'food'));
    sell(sim, owner, biz.building, 'meal');
    expect(owner.money).toBeCloseTo(ownerMoney - price(sim, 'food'), 6);
    expect(sim.treasury - treasuryBefore).toBeCloseTo(price(sim, 'food'), 6);
    expect([biz.till, biz.takings, biz.served]).toEqual([till, takings, served]);
    // Owners aren't on the town payroll: they draw the till's profit at midnight.
    biz.till = FLOAT + 50;
    const before = owner.money;
    settleBusinesses(sim);
    // The day's upkeep comes out of the till first.
    expect(owner.money).toBe(before + 50 - BUSINESSES.bakery.upkeep);
    expect(biz.till).toBe(FLOAT);
  }, 60_000);

  it('prices float: cheaper than the café in a glut, dearer in a shortage', () => {
    const sim = town();
    const biz = open(sim, 'bakery', founder(sim, 'bakery'));
    sim.stock.food = 5000;
    expect(priceAt(sim, biz.building, 'meal')).toBeLessThan(townMeal(sim));
    sim.stock.food = 0;
    expect(priceAt(sim, biz.building, 'meal')).toBeGreaterThan(townMeal(sim));
    expect(priceAt(sim, undefined, 'meal')).toBe(townMeal(sim));
  }, 60_000);

  it('of an evening the tavern fills up, takes money for drinks, and sends people home happy', () => {
    const sim = town();
    const biz = open(sim, 'tavern', founder(sim, 'tavern'));
    for (const a of sim.agents) a.money = Math.max(a.money, 50);
    at(sim, sim.day, 19.5);
    let most = 0;
    for (let k = 0; k < 18; k++) {
      sim.run(10);
      most = Math.max(most, sim.agents.filter((a) => a.action.kind === 'drink' && a.action.stage === 'perform').length);
    }
    expect(most).toBeGreaterThanOrEqual(3);
    expect(biz.served).toBeGreaterThanOrEqual(3);
    expect(biz.takings).toBeGreaterThan(0);
    at(sim, sim.day + 1, 1);
    expect(sim.agents.some((a) => a.memories.some((m) => m.kind === 'tavernNight'))).toBe(true);
    expect(sim.agents.filter((a) => a.action.kind === 'drink').length).toBe(0);
  }, 120_000);

  it('when a festival breaks up the crowd drifts to the tavern for one more', () => {
    const sim = town();
    const biz = open(sim, 'tavern', founder(sim, 'tavern'));
    for (const a of sim.agents) a.money = Math.max(a.money, 50);
    at(sim, sim.day, 17);
    startFestival(sim, 'Test Fest');
    // Before the festival ends the whole town is in the park.
    sim.run(sim.events.festival!.until - sim.time - 5);
    expect(biz.served).toBe(0);
    let most = 0;
    for (let k = 0; k < 12; k++) {
      sim.run(10);
      most = Math.max(most, sim.agents.filter((a) => a.action.kind === 'drink' && a.action.stage === 'perform').length);
    }
    expect(most).toBeGreaterThanOrEqual(4);
    expect(biz.served).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('a season in the red closes it: the town buys the building, the owner finds other work', () => {
    const sim = town();
    const owner = founder(sim, 'bakery');
    const biz = open(sim, 'bakery', owner);
    biz.opened = -1e6;
    // A loan bigger than the buyout (half the build cost) and the till: some of it is never repaid.
    biz.loan = 400;
    biz.takings = 20;
    biz.costs = 90;
    biz.season -= 1;
    settleBusinesses(sim);
    expect(biz.owner).toBeNull();
    expect(owner.role).not.toBe('baker');
    expect(owner.memories.some((m) => m.kind === 'businessFailed')).toBe(true);
    expect(sim.building(biz.building)).toBeDefined();
    expect(sim.activity.some((e) => new RegExp(`${biz.name} closed \\(it lost money all season\\)\\. The town bought the building and keeps it open; \\$\\d+ of the town's loan was never repaid`).test(e.text))).toBe(true);
    // Town-run now: meals there go to the treasury at the town's price.
    const c = adults(sim).find((a) => a !== owner)!;
    c.money = 100;
    const t = sim.treasury;
    sell(sim, c, biz.building, 'meal');
    expect(sim.treasury - t).toBe(townMeal(sim));
  }, 60_000);

  it('a business passes to family when the owner dies; savings go to the partner, or the town', () => {
    const sim = town();
    const owner = adults(sim).find((a) => a.partner !== null && sim.agent(a.partner) && ageOf(sim, sim.agent(a.partner)!) >= ADULT_AGE && sim.agent(a.partner)!.role !== 'retired')!;
    owner.traits = ['workaholic'];
    const biz = open(sim, 'bakery', owner);
    const partner = sim.agent(owner.partner!)!;
    owner.money = 300;
    const had = partner.money;
    die(sim, owner, 'test');
    expect(partner.money).toBe(had + 300);
    expect(biz.owner).toBe(partner.id);
    expect(partner.role).toBe('baker');
    expect(sim.activity.some((e) => e.text === `${owner.name.split(' ')[0]} left $300 to ${partner.name.split(' ')[0]}`)).toBe(true);

    const loner = sim.agents.find((a) => a.partner === null && !a.children.length && ageOf(sim, a) >= ADULT_AGE)!;
    loner.money = 80;
    const t = sim.treasury;
    die(sim, loner, 'test');
    expect(sim.treasury).toBe(t + 80);
  }, 60_000);

  it('a well-off family has a struggling one over for dinner', () => {
    const sim = town();
    const host = adults(sim)[0];
    host.money = 2000;
    const guests = sim.town.households.find((h) => h.id !== host.household && h.building >= 0 && sim.agents.some((a) => a.household === h.id))!;
    // Hard up beside neighbours at $200, though well above a few dollars: struggling is relative to the town.
    for (const a of sim.agents.filter((x) => x.household === guests.id)) a.money = 70;
    for (const a of sim.agents.filter((x) => x.household !== guests.id && x !== host)) a.money = 200;
    const pantry = sim.pantry[guests.id];
    const t0 = sim.time;
    const dined = () => sim.activity.some((e) => e.t >= t0 && / over for dinner$/.test(e.text));
    let tries = 0;
    while (!dined() && tries++ < 6) {
      // A day's wages would lift them out of it: they're hard up again by dinnertime.
      at(sim, sim.day + (sim.hour >= 17.5 ? 1 : 0), 17.5);
      for (const a of sim.agents) a.money = a.household === guests.id ? 70 : 200;
      host.money = 2000;
      at(sim, sim.day, 18.2);
      neighbourlyDinner(sim);
    }
    expect(dined()).toBe(true);
    expect(sim.pantry[guests.id]).toBeGreaterThan(pantry - 3);
    expect(sim.agents.filter((a) => a.household === guests.id).every((a) => a.memories.some((m) => m.kind === 'dinnerGuest'))).toBe(true);
  }, 120_000);

  it('money reads as a sentence: broke, scraping by, comfortable, the richest person in town', () => {
    const sim = town();
    const [a, b, c] = adults(sim);
    for (const o of adults(sim)) o.money = 200;
    a.money = 1;
    b.money = 10;
    c.money = 5000;
    expect(wealthWord(sim, a)).toBe('broke');
    expect(wealthWord(sim, b)).toBe('scraping by');
    expect(wealthWord(sim, adults(sim)[3])).toBe('comfortable');
    expect(wealthWord(sim, c)).toBe('the richest person in town');
    // Well off is the top slice of the town, so it stays scarce however money is spread.
    const d = adults(sim)[4];
    d.money = 400;
    expect(wealthWord(sim, d)).toBe('well off');
    expect(wealthWord(sim, adults(sim)[5])).toBe('comfortable');
    adults(sim).forEach((o, i) => (o.money = 60 + i * 30));
    const all = adults(sim);
    const wellOff = all.filter((o) => wealthWord(sim, o) === 'well off').length;
    expect(wellOff).toBeGreaterThanOrEqual(1);
    expect(wellOff).toBeLessThanOrEqual(Math.ceil(all.length * 0.15));
  }, 60_000);

  it('owners hand a place on when they retire, or the town buys it and nobody mourns; the young and the old are not founders', () => {
    const sim = town();
    const crowd = adults(sim);
    const owner = founder(sim, 'bakery');
    const heir = crowd.find((a) => a !== owner && !ownedBy(sim, a))!;
    owner.partner = heir.id;
    heir.partner = owner.id;
    ageTo(sim, heir, 40);
    const biz = open(sim, 'bakery', owner);
    ageTo(sim, owner, RETIRE_AGE + 0.5);
    sim.timers.life = 0;
    tickLife(sim, 1);
    expect(owner.role).toBe('retired');
    expect(biz.owner).toBe(heir.id);
    expect(heir.role).toBe('baker');
    expect(sim.activity.some((e) => e.text === `${heir.name.split(' ')[0]} took over ${biz.name} from ${owner.name.split(' ')[0]}`)).toBe(true);

    // With nobody to take it on the town buys it; the retired owner keeps the payout and is not a failure.
    const solo = crowd.find((a) => a !== owner && a !== heir && !ownedBy(sim, a) && a.partner === null && !a.children.length && a.role !== 'builder')!;
    solo.traits = ['workaholic'];
    solo.skills.charisma.level = 6;
    solo.money = 300;
    const inn = open(sim, 'tavern', solo);
    inn.till = 25;
    ageTo(sim, solo, RETIRE_AGE + 0.5);
    const treasury = sim.treasury;
    sim.timers.life = 0;
    tickLife(sim, 1);
    expect(solo.role).toBe('retired');
    expect(inn.owner).toBeNull();
    expect(solo.money).toBe(300 + Math.round(buildCost('tavern') / 2) + 25);
    expect(treasury - sim.treasury).toBe(Math.round(buildCost('tavern') / 2));
    expect(solo.memories.some((m) => m.kind === 'businessFailed')).toBe(false);
    expect(sim.activity.some((e) => e.text.startsWith(`${inn.name} closed (${solo.name.split(' ')[0]} retired and nobody could take it on)`))).toBe(true);
    expect(sim.activity.some((e) => new RegExp(`${solo.name.split(' ')[0]} is gone`).test(e.text))).toBe(false);

    // Founders: the best fit and keenest, never the richest, and not someone about to retire.
    const rich = crowd.find((a) => !ownedBy(sim, a) && a.role !== 'retired' && a !== owner && a !== heir && a !== solo)!;
    const fit = crowd.find((a) => !ownedBy(sim, a) && a.role !== 'retired' && a !== owner && a !== heir && a !== solo && a !== rich)!;
    for (const a of crowd) a.money = Math.min(a.money, 100);
    for (const a of [rich, fit]) a.traits = ['workaholic'];
    rich.money = 1400;
    rich.skills.cooking.level = 4;
    fit.money = 150;
    fit.skills.cooking.level = 8;
    ageTo(sim, rich, 30);
    ageTo(sim, fit, 30);
    expect(founderFor(sim, 'bakery')).toBe(fit);
    ageTo(sim, fit, RETIRE_AGE - 3);
    expect(founderFor(sim, 'bakery')).toBe(rich);
    // A founder short of the full cost borrows the rest.
    ageTo(sim, fit, 30);
    const pr = startProject(sim, { bp: 'bakery', score: 1, reason: 'test', forAgents: [], proposer: fit, name: 'Fit Bakery', owner: fit })!;
    expect(pr.owner).toBe(fit.id);
    expect(pr.loan).toBe(buildCost('bakery') - 130);
  }, 180_000);

  it('a place the town took over still counts, so no second tavern goes up while one stands', () => {
    const sim = town();
    for (const a of sim.agents) a.money = Math.min(a.money, 60);
    const f = founder(sim, 'tavern');
    const inn = open(sim, 'tavern', f);
    expect(proposals(sim).some((p) => p.bp === 'tavern')).toBe(false);
    closeBusiness(sim, inn, 'test');
    expect(inn.owner).toBeNull();
    const g = adults(sim).find((a) => a !== f && !ownedBy(sim, a) && a.role !== 'builder')!;
    g.traits = ['workaholic'];
    g.skills.charisma.level = 6;
    g.money = 400;
    expect(sim.agents.length).toBeGreaterThanOrEqual(BUSINESSES.tavern.pop);
    expect(sim.agents.length).toBeLessThan(BUSINESSES.tavern.pop + 20);
    expect(founderFor(sim, 'tavern')).toBeDefined();
    expect(proposals(sim).some((p) => p.bp === 'tavern')).toBe(false);
  }, 120_000);

  it('the buyout is half the build cost with the till on top; leaving town is not a failure, and the payout follows the purse rules', () => {
    const sim = town();
    const crowd = adults(sim);
    const owner = founder(sim, 'bakery', 100);
    const biz = open(sim, 'bakery', owner);
    const half = Math.round(buildCost('bakery') / 2);
    expect(half).toBeGreaterThan(60);
    biz.till = 33;
    biz.loan = 20;
    const t0 = sim.treasury;
    const m0 = owner.money;
    closeBusiness(sim, biz, 'test');
    // Half the cost and the till, less the loan the town is owed.
    expect(owner.money).toBe(m0 + half + 33 - 20);
    expect(t0 - sim.treasury).toBe(half - 20);

    // Someone with no family sets off on a journey with a place of their own.
    const solo = crowd.find((a) => a !== owner && !ownedBy(sim, a) && a.partner === null && !a.children.length && a.role !== 'builder')!;
    solo.traits = ['workaholic'];
    solo.skills.charisma.level = 6;
    solo.money = 150;
    const inn = open(sim, 'tavern', solo);
    inn.till = 30;
    const world = () => sim.agents.reduce((n, a) => n + a.money, 0) + sim.treasury;
    const before = world();
    const file = sendAway(sim, [solo]);
    const buyout = Math.round(buildCost('tavern') / 2);
    expect(file.people[0].money).toBe(200);
    // Nothing vanished: the purse and the town's share add up to what they had, the buyout and the till's $30.
    expect(world() + file.people[0].money).toBeCloseTo(before + 30, 5);
    expect(solo.money).toBe(150 + buyout + 30);
    expect(solo.memories.some((m) => m.kind === 'businessFailed')).toBe(false);
    expect(solo.thoughts.some((t) => /put everything into/.test(t.text))).toBe(false);
    const closed = sim.activity.find((e) => e.text.startsWith(`${inn.name} closed`))!;
    expect(closed.text).toContain(`${solo.name.split(' ')[0]} left town and nobody could take it on`);
    expect(closed.text).not.toMatch(/is gone/);
  }, 120_000);

  it('the books survive saving', () => {
    const sim = town();
    const biz = open(sim, 'tavern', founder(sim, 'tavern'));
    biz.loan = 55;
    const again = loadSim(saveSim(sim));
    expect(again.businesses).toEqual(sim.businesses);
    closeBusiness(again, again.businesses[0], 'test');
    expect(again.businesses[0].owner).toBeNull();
  }, 60_000);
});
