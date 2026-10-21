import { describe, expect, it } from 'vitest';
import { ageOf } from '../src/sim/agents';
import { approvalLine, approvalOf, callProtest, DEFAULT_POLICIES, FETE_COST, judgePromise, recallVote, recordPull, takeOffice, TAX_RATE, townApproval } from '../src/sim/civic';
import { ADULT_AGE, MIN_PER_DAY, ROLES, SEASON_DAYS } from '../src/sim/defs';
import { triggerWorldEvent } from '../src/sim/events';
import { payWage } from '../src/sim/market';
import { proposals } from '../src/sim/planner';
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

  it('a big protest over a policy can make the mayor climb down instead', () => {
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
      if (sim.activity.some((e) => /climbed down after \d+ people protested: tax back to 15%/.test(e.text))) {
        expect(sim.civic.policies.tax).toBe('normal');
        climbed = true;
        break;
      }
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
    judgePromise(sim);
    expect(sim.civic.promise!.kept).toBe(false);
    expect(sim.activity.some((e) => e.text === `A year on: Mayor ${m.name.split(' ')[0]} promised more homes (0 built). Promise broken.`)).toBe(true);
    expect(recordPull(sim, m.id)).toBe(-0.12);
    expect(voteScore(sim, voter, cand)).toBeCloseTo(neutral - 0.12);
  }, 60_000);

  it('once it is a town it wants a town hall, and meetings move there', () => {
    const sim = town();
    expect(proposals(sim).some((p) => p.bp === 'townhall')).toBe(false);
    sim.tier = 1;
    const p = proposals(sim).find((x) => x.bp === 'townhall')!;
    expect(p.name).toBe(`${sim.name} Town Hall`);
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
