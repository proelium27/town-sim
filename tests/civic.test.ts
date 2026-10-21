import { describe, expect, it } from 'vitest';
import { ageOf } from '../src/sim/agents';
import { approvalLine, approvalOf, BONUS_RATE, callProtest, DEFAULT_POLICIES, FETE_COST, judgePromise, recallVote, recordPull, takeOffice, TAX_RATE, townApproval } from '../src/sim/civic';
import { priceMood } from '../src/sim/business';
import { Rng } from '../src/sim/rng';
import { ADULT_AGE, ELECTION_DAY, MIN_PER_DAY, ROLES, SEASON_DAYS, YEAR_DAYS } from '../src/sim/defs';
import { triggerWorldEvent } from '../src/sim/events';
import { payWage } from '../src/sim/market';
import { completeProject, findSite, proposals } from '../src/sim/planner';
import { BLUEPRINTS } from '../src/world/blueprints';
import { voteScore } from '../src/sim/politics';
import { loadSim, saveSim } from '../src/sim/save';
import { Sim } from '../src/sim/sim';

const at = (sim: Sim, day: number, hour: number) => sim.run(day * 1440 + hour * 60 - sim.time);
const adults = (sim: Sim) => sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE);

/** A town just after its first election, mid-afternoon. */
function town(seed = 7): Sim {
  const sim = new Sim(seed);
  at(sim, 3, 13);
  expect(sim.mayor).not.toBeNull();
  return sim;
}

/** Sours every grown-up on the mayor (for days, as far as protests are concerned). */
function sour(sim: Sim, to = 20): void {
  for (const a of adults(sim)) if (a.id !== sim.mayor) sim.civic.approval.set(a.id, to);
}

describe('mayors with real power', () => {
  it('a new mayor sets policy from what they ran on and who they are', () => {
    const sim = town();
    const m = sim.agent(sim.mayor!)!;
    m.traits = ['introvert'];
    m.money = 100;
    takeOffice(sim, m, 'community', false);
    expect(sim.civic.policies).toEqual({ tax: 'normal', festivals: 'twice', bonus: 'generous', priceCap: false });
    takeOffice(sim, m, 'materials', false);
    expect(sim.civic.policies.tax).toBe('high');
    takeOffice(sim, m, 'food', false);
    expect(sim.civic.policies.priceCap).toBe(true);
    m.traits = ['grumpy'];
    takeOffice(sim, m, 'housing', false);
    expect(sim.civic.policies).toEqual({ tax: 'normal', festivals: 'cancelled', bonus: 'thrifty', priceCap: false });
    expect(sim.activity.some((e) => e.text.startsWith(`Mayor ${m.name.split(' ')[0]} sets out their policies: Tax 15%, Festivals cancelled`))).toBe(true);
  }, 60_000);

  it('policies pull real levers: the tax on wages, a cancelled fair, a fête the town pays for', () => {
    const sim = town();
    const worker = sim.agents.find((a) => ROLES[a.role].workplace === 'office')!;
    const taxOn = (tax: 'low' | 'high') => {
      sim.civic.policies.tax = tax;
      const t = sim.treasury;
      payWage(sim, worker, 100);
      return sim.treasury - t;
    };
    expect(taxOn('high')).toBeCloseTo(100 * TAX_RATE.high);
    expect(taxOn('low')).toBeCloseTo(100 * TAX_RATE.low);

    // Cancelled: the season's fair doesn't happen.
    sim.civic.policies.festivals = 'cancelled';
    const next = (Math.floor(sim.day / SEASON_DAYS) + 1) * SEASON_DAYS;
    at(sim, next + 1, 18);
    expect(sim.events.festival).toBeFalsy();
    expect(sim.activity.some((e) => / this season: Mayor .* cancelled it$/.test(e.text))).toBe(true);

    // Twice a season: a fête on the season's first evening, paid for by the town.
    sim.civic.policies.festivals = 'twice';
    sim.treasury = 500;
    at(sim, next + SEASON_DAYS, 16.9);
    // An evening with nothing else on (the fête gives way to office parties, weddings and funerals).
    sim.events.plan = sim.events.plan.filter((e) => e.kind !== 'party');
    sim.events.weddings = [];
    sim.events.funerals = [];
    sim.events.snowstorm = null;
    const spent = sim.ledger.projects;
    at(sim, next + SEASON_DAYS, 17.3);
    expect(sim.events.festival?.name).toBe("Mayor's fête");
    expect(sim.ledger.projects - spent).toBe(FETE_COST);
  }, 120_000);

  it('approval follows how policy lands on each person: high tax costs the mayor the office workers', () => {
    const sim = town();
    const office = adults(sim).find((a) => ROLES[a.role].workplace === 'office' && a.id !== sim.mayor)!;
    sim.civic.policies = { ...DEFAULT_POLICIES };
    const before = approvalOf(sim, office);
    sim.civic.policies.tax = 'high';
    expect(approvalOf(sim, office)).toBeLessThan(before - 10);
    sim.civic.policies = { ...DEFAULT_POLICIES };
    sour(sim, 30);
    expect(townApproval(sim)).toBeLessThan(31);
    expect(approvalLine(sim)).toMatch(/^Mayor \S+ is unpopular \(30%/);
    sour(sim, 80);
    expect(approvalLine(sim)).toMatch(/^Most people back Mayor \S+ \(80%/);
  }, 60_000);

  it('two sour days bring a protest; a crowd, a petition and a recall vote can unseat the mayor', () => {
    const sim = town();
    const mayor = sim.agent(sim.mayor!)!;
    sim.civic.policies = { ...DEFAULT_POLICIES };
    sour(sim);
    sim.civic.lowDays = 1;
    // Midnight: still sour, the second day running.
    at(sim, sim.day + 1, 0.1);
    sour(sim);
    expect(sim.civic.protest).not.toBeNull();
    expect(sim.activity.some((e) => /people are planning a protest outside the park/.test(e.text))).toBe(true);
    at(sim, sim.day, 17.4);
    sour(sim);
    let crowd = 0;
    for (let k = 0; k < 18; k++) {
      sim.run(5);
      crowd = Math.max(crowd, sim.agents.filter((a) => a.action.kind === 'protest' && a.action.stage === 'perform').length);
    }
    expect(crowd).toBeGreaterThanOrEqual(3);
    expect(mayor.action.kind).not.toBe('protest');
    sour(sim);
    at(sim, sim.day, 19.2);
    // Nothing to give ground on, so the petition goes round, carries, and forces a vote tonight.
    expect(sim.activity.some((e) => /A petition to recall Mayor .* signatures: a recall vote tonight/.test(e.text))).toBe(true);
    sour(sim);
    at(sim, sim.day, 19.7);
    expect(sim.mayor).toBeNull();
    expect(sim.activity.some((e) => new RegExp(`Mayor ${mayor.name.split(' ')[0]} was recalled, \\d+ votes to \\d+\\. A new election tomorrow`).test(e.text))).toBe(true);
    expect(mayor.memories.some((m) => m.kind === 'recalled')).toBe(true);
    // A special election the next day, without the recalled mayor.
    at(sim, sim.day + 1, 20);
    expect(sim.activity.some((e) => /^A special election after the recall!/.test(e.text))).toBe(true);
    expect(sim.mayor).not.toBeNull();
    expect(sim.mayor).not.toBe(mayor.id);
  }, 180_000);

  it('a big protest over a policy makes the mayor climb down or sends a petition round, as their dice fall', () => {
    let climbed = false;
    for (const seed of [7, 3, 5, 6]) {
      const sim = town(seed);
      sim.civic.policies.tax = 'high';
      const m = sim.agent(sim.mayor!)!;
      m.traits = ['introvert'];
      sour(sim);
      callProtest(sim);
      sim.civic.protest!.grievance = 'tax';
      at(sim, sim.day + (sim.hour > 17 ? 1 : 0), 17.4);
      for (let k = 0; k < 22; k++) {
        sour(sim);
        sim.run(5);
      }
      // Too small a crowd forces nothing; otherwise the same dice endProtest rolls decide (not stubborn: 0.6).
      if (sim.activity.some((e) => /^Only \d+ turned out to protest/.test(e.text))) continue;
      const gives = new Rng(sim.seed * 53 + sim.day).chance(0.6);
      const down = sim.activity.some((e) => /climbed down after \d+ people protested: tax back to 15%/.test(e.text));
      expect(down, `seed ${seed}`).toBe(gives);
      if (down) {
        expect(sim.civic.policies.tax).toBe('normal');
        climbed = true;
      } else expect(sim.activity.some((e) => /A petition to recall Mayor/.test(e.text)), `seed ${seed}`).toBe(true);
    }
    expect(climbed).toBe(true);
  }, 300_000);

  it('a failed recall leaves the mayor in office', () => {
    const sim = town();
    const m = sim.mayor;
    sour(sim, 85);
    expect(recallVote(sim)).toBe(false);
    expect(sim.mayor).toBe(m);
    expect(sim.activity.some((e) => /^The recall vote failed, \d+ to \d+\. Mayor \S+ stays$/.test(e.text))).toBe(true);
  }, 60_000);

  it('the Recall vote world event forces a vote that evening', () => {
    const sim = town();
    triggerWorldEvent(sim, 'recall');
    expect(sim.civic.recallAt).toBe(sim.day * MIN_PER_DAY + 19.5 * 60);
    sour(sim, 10);
    at(sim, sim.day, 19.6);
    expect(sim.mayor).toBeNull();
  }, 60_000);

  it('a year on, the town judges the promise, and voters weigh the record', () => {
    const sim = town();
    const m = sim.agent(sim.mayor!)!;
    takeOffice(sim, m, 'housing', false);
    const voter = adults(sim).find((a) => a.id !== m.id)!;
    const cand = { id: m.id, platform: 'housing' as const };
    const neutral = voteScore(sim, voter, cand);
    // Not judged a few hours in (a special election just before the regular one)...
    judgePromise(sim);
    expect(sim.civic.promise!.kept).toBeUndefined();
    // ...but after a term.
    sim.civic.promise!.since -= 3 * MIN_PER_DAY;
    judgePromise(sim);
    expect(sim.civic.promise!.kept).toBe(false);
    expect(sim.activity.some((e) => e.text === `A year on: Mayor ${m.name.split(' ')[0]} promised more homes (0 built). Promise broken.`)).toBe(true);
    expect(recordPull(sim, m.id)).toBe(-0.12);
    expect(voteScore(sim, voter, cand)).toBeCloseTo(neutral - 0.12);
    // A new term replaces the promise; the verdict stays on show.
    takeOffice(sim, m, 'housing', true);
    expect(sim.civic.verdict).toEqual({ mayor: m.id, platform: 'housing', kept: false, year: sim.year });
  }, 60_000);

  it('a food promise is counted in days of eating', () => {
    const sim = town();
    const m = sim.agent(sim.mayor!)!;
    takeOffice(sim, m, 'food', false);
    sim.civic.promise!.since -= 3 * MIN_PER_DAY;
    sim.civic.promise!.baseline = 2;
    sim.stock.food = sim.agents.length * 2.6 * 3;
    judgePromise(sim);
    expect(sim.activity.some((e) => /promised full stores \(3\.\d days of food in store\)\. Promise kept\./.test(e.text))).toBe(true);
  }, 60_000);

  it('once it is a town it wants a town hall, which people can walk into', () => {
    const sim = town();
    expect(proposals(sim).some((p) => p.bp === 'townhall')).toBe(false);
    sim.tier = 1;
    const p = proposals(sim).find((x) => x.bp === 'townhall')!;
    expect(p.name).toBe(`${sim.name} Town Hall`);
    const site = findSite(sim, 'townhall')!;
    const bp = BLUEPRINTS.townhall;
    completeProject(sim, { id: sim.nextProjectId++, blueprint: 'townhall', name: p.name, x: site.x, y: site.y, w: bp.w, h: bp.h, doorTop: site.doorTop, path: site.path, need: {}, delivered: {}, work: bp.work, progress: bp.work, reason: 'test', forAgents: [], started: sim.time, builders: new Set() });
    const hall = sim.map.buildings.find((b) => b.kind === 'townhall')!;
    const m = sim.map;
    const seats = m.props.filter((x) => x.building === hall.id && x.use === 'sit');
    expect(seats.length).toBeGreaterThan(0);
    for (const seat of seats) expect(sim.nav.findPath(m.idx(hall.door.x, hall.door.y), m.idx(seat.x, seat.y), 40000), `seat at ${seat.x},${seat.y}`).not.toBeNull();
  }, 60_000);

  it('the price cap stops shops charging over the odds; the bonus policy sets the share paid out', () => {
    const sim = town();
    sim.stock.food = 0;
    sim.civic.policies.priceCap = false;
    expect(priceMood(sim)).toBe(1.25);
    sim.civic.policies.priceCap = true;
    expect(priceMood(sim)).toBe(1);
    sim.stock.food = 5000;
    expect(priceMood(sim)).toBe(0.85);
    // The same town at midnight with a full treasury, thrifty against generous.
    at(sim, sim.day, 23.9);
    const paid = (bonus: 'thrifty' | 'generous') => {
      const t = loadSim(saveSim(sim));
      t.treasury = 4000;
      t.civic.policies.bonus = bonus;
      t.run(0.2 * 60);
      return t.ledger.bonuses;
    };
    const thrifty = paid('thrifty');
    const generous = paid('generous');
    expect(thrifty).toBeGreaterThan(0);
    expect(generous / thrifty).toBeCloseTo(BONUS_RATE.generous / BONUS_RATE.thrifty, 0);
  }, 120_000);

  it('the fête gives way to an election rally', () => {
    const sim = new Sim(7);
    at(sim, YEAR_DAYS + ELECTION_DAY, 16.5);
    expect(sim.election?.stage).toBe('campaign');
    sim.civic.policies.festivals = 'twice';
    sim.treasury = 1000;
    at(sim, sim.day, 18);
    expect(sim.events.festival?.name).not.toBe("Mayor's fête");
    expect(sim.activity.some((e) => /fête in the park tonight/.test(e.text) && e.t > sim.day * MIN_PER_DAY)).toBe(false);
  }, 120_000);

  it('a blizzard snows off a protest, which can be called again once it clears', () => {
    const sim = town();
    sour(sim);
    callProtest(sim);
    const p = sim.civic.protest!;
    at(sim, Math.floor(p.at / MIN_PER_DAY), 17);
    sim.events.snowstorm = { until: sim.time + 4 * 60 };
    at(sim, sim.day, 17.6);
    expect(sim.civic.protest).toBeNull();
    expect(sim.activity.some((e) => /was snowed off$/.test(e.text))).toBe(true);
    expect(sim.time - sim.civic.lastProtest).toBeGreaterThanOrEqual(3 * MIN_PER_DAY);
  }, 60_000);

  it('a recall on election day keeps the recalled mayor off the ballot, with no second election after', () => {
    const sim = new Sim(7);
    at(sim, YEAR_DAYS + ELECTION_DAY, 12);
    const race = sim.election!;
    const mayor = sim.mayor!;
    expect(race.candidates.some((c) => c.id === mayor)).toBe(true);
    sour(sim, 5);
    expect(recallVote(sim)).toBe(true);
    expect(sim.snapElection).toBeNull();
    expect(race.candidates.some((c) => c.id === mayor)).toBe(false);
    expect(sim.activity.some((e) => /was recalled, \d+ votes to \d+\. The election goes ahead without them$/.test(e.text))).toBe(true);
    at(sim, sim.day, 19.5);
    expect(sim.mayor).not.toBeNull();
    expect(sim.mayor).not.toBe(mayor);
    at(sim, sim.day + 1, 12);
    expect(sim.activity.some((e) => /^A special election/.test(e.text))).toBe(false);
  }, 120_000);

  it('a special election on the regular election day opens one campaign, not two', () => {
    const sim = new Sim(7);
    at(sim, YEAR_DAYS + ELECTION_DAY - 1, 20);
    sour(sim, 5);
    expect(recallVote(sim)).toBe(true);
    expect(sim.snapElection).toBe(sim.day + 1);
    at(sim, sim.day + 1, 10);
    expect(sim.activity.filter((e) => /Standing for mayor:/.test(e.text) && e.t >= sim.day * MIN_PER_DAY).length).toBe(1);
  }, 120_000);

  it('a new mayor starts with a clean slate: no leftover protest, recall or approval trend', () => {
    const sim = town();
    const m = sim.agent(sim.mayor!)!;
    sour(sim);
    callProtest(sim);
    sim.civic.recallAt = sim.time + 60;
    sim.civic.history = [40, 38, 35];
    const next = adults(sim).find((a) => a.id !== m.id && a.role !== 'retired')!;
    sim.mayor = next.id;
    takeOffice(sim, next, 'housing', false);
    expect(sim.civic.protest).toBeNull();
    expect(sim.civic.recallAt).toBeNull();
    expect(sim.civic.history).toEqual([]);
  }, 60_000);

  it('an old save without the mayor\'s office loads with default policies', () => {
    const sim = town();
    const raw = JSON.parse(saveSim(sim));
    delete raw.sim.civic;
    delete raw.sim.recalled;
    delete raw.sim.snapElection;
    const again = loadSim(JSON.stringify(raw));
    expect(again.civic.policies).toEqual(DEFAULT_POLICIES);
    expect(again.snapElection).toBeNull();
    again.run(60);
    expect(again.civic.approval.size).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('policy, approval and a planned protest survive saving', () => {
    const sim = town();
    sim.civic.policies.tax = 'high';
    sour(sim, 33);
    callProtest(sim);
    const again = loadSim(saveSim(sim));
    expect(again.civic.policies.tax).toBe('high');
    expect(again.civic.approval.get(adults(sim).find((a) => a.id !== sim.mayor)!.id)).toBe(33);
    expect(again.civic.protest?.grievance).toBe(sim.civic.protest?.grievance);
  }, 60_000);
});
