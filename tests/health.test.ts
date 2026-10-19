import { describe, expect, it } from 'vitest';
import { triggerWorldEvent } from '../src/sim/events';
import { fallIll, FRAIL_NOTICE, frailty, needsCare, tickTownHealth } from '../src/sim/health';
import { kinship } from '../src/sim/social';
import { findSite } from '../src/sim/planner';
import { allocateRoles } from '../src/sim/planner';
import { Sim } from '../src/sim/sim';
import { BLUEPRINTS } from '../src/world/blueprints';

const sickCount = (sim: Sim) => sim.agents.filter((a) => a.illness).length;

describe('illness', () => {
  it('an outbreak spreads, peaks and fades, and leaves people immune for a while', () => {
    const sim = new Sim(7);
    sim.run(2 * 1440 + 8 * 60 - sim.time);
    triggerWorldEvent(sim, 'outbreak');
    let peak = 0;
    const caught = new Set<number>();
    for (let k = 0; k < 48; k++) {
      sim.run(60);
      peak = Math.max(peak, sickCount(sim));
      for (const a of sim.agents) if (a.illness) caught.add(a.id);
    }
    expect(caught.size).toBeGreaterThan(3);
    expect(peak).toBeGreaterThanOrEqual(3);
    expect(sickCount(sim)).toBeLessThan(peak);
    const recovered = sim.agents.find((a) => caught.has(a.id) && !a.illness)!;
    fallIll(sim, recovered, 'flu', '');
    expect(recovered.illness).toBeUndefined();
  }, 120_000);

  it('the ill stay home in bed instead of going to work, and family look in on them', () => {
    const sim = new Sim(7);
    sim.run(1440 + 7 * 60 - sim.time);
    const patient = sim.agents.find((a) => a.role !== 'child' && a.role !== 'retired' && sim.agents.some((o) => o.household === a.household && o.id !== a.id))!;
    fallIll(sim, patient, 'flu', '');
    patient.illness!.severity = 0.7;
    patient.illness!.age = 0.3 * 1.1 * 1440;
    let rested = 0;
    let lookedAfter = false;
    for (let k = 0; k < 20; k++) {
      sim.run(30);
      if (patient.action.kind === 'rest') rested++;
      lookedAfter ||= sim.agents.some((o) => o.memories.some((m) => m.kind === 'lookedAfter' && m.about === patient.id));
      // Nobody goes to work while properly ill (they may once they're on the mend).
      if ((patient.illness?.severity ?? 0) > 0.35) expect(patient.action.kind).not.toBe('work');
    }
    expect(rested).toBeGreaterThan(5);
    expect(lookedAfter).toBe(true);
  }, 120_000);
});

describe('clinic', () => {
  it('a doctor at the clinic treats patients, who recover faster', () => {
    const run = (withClinic: boolean) => {
      const sim = new Sim(7);
      sim.run(1440 + 7 * 60 - sim.time);
      if (withClinic) {
        const site = findSite(sim, 'clinic')!;
        const bp = BLUEPRINTS.clinic;
        for (const p of sim.map.props.filter((p) => p.x >= site.x - 1 && p.x <= site.x + bp.w && p.y >= site.y - 1 && p.y <= site.y + bp.h)) sim.map.removeProp(p);
        bp.stamp(sim.map, site.x, site.y, site.doorTop, 'Test Clinic');
        sim.stock.medicine = 5;
        allocateRoles(sim);
      }
      const patient = sim.agents.find((a) => a.role === 'engineer')!;
      fallIll(sim, patient, 'flu', '');
      let minutes = 0;
      while (patient.illness && minutes < 3 * 1440) {
        sim.run(30);
        minutes += 30;
      }
      return { minutes, treated: sim.activity.some((e) => e.text.includes(`treated ${patient.name.split(' ')[0]}`)) };
    };
    const home = run(false);
    const clinic = run(true);
    expect(clinic.treated).toBe(true);
    expect(clinic.minutes).toBeLessThan(home.minutes);
  }, 120_000);
});

describe('frailty', () => {
  it('builds with age and illness, not on a birthday', () => {
    const sim = new Sim(7);
    const a = sim.agents[0];
    a.birth = sim.time - (50 / 2) * 1440;
    expect(frailty(sim, a)).toBe(0);
    a.birth = sim.time - (84 / 2) * 1440;
    const old = frailty(sim, a);
    expect(old).toBeGreaterThan(0.6);
    a.wear = 0.1;
    expect(frailty(sim, a)).toBeCloseTo(Math.min(1, old + 0.1));
  });

  it('old age never comes without warning: the frail are announced once, and family visit first', () => {
    const sim = new Sim(7);
    // Everyone is 70, just short of frail; then the years roll on, two hours at a time.
    for (const a of sim.agents) a.birth = sim.time - (70 / 2) * 1440;
    const elder = sim.agents.find((a) => sim.agents.some((o) => o.id !== a.id && kinship(sim, o, a)))!;
    const kin = sim.agents.find((o) => o.id !== elder.id && kinship(sim, o, elder))!;
    let oldAge = 0;
    for (let k = 0; k < 12 * 20 && sim.agents.length; k++) {
      sim.time += 120;
      const before = new Map(sim.agents.map((a) => [a.id, a.frailSince]));
      tickTownHealth(sim);
      if (elder.frailSince !== undefined && sim.agents.includes(kin) && sim.agents.includes(elder)) expect(needsCare(sim, kin)).toBeDefined();
      for (const [id, since] of before) {
        if (sim.agents.some((a) => a.id === id)) continue;
        const dead = sim.person(id)!;
        if (!sim.activity.some((e) => e.text === `${dead.name} passed away (old age at ${Math.floor((sim.time - dead.birth) / 720)})`)) continue;
        oldAge++;
        expect(since).toBeDefined();
        expect(sim.time - since!).toBeGreaterThanOrEqual(FRAIL_NOTICE);
      }
    }
    expect(oldAge).toBeGreaterThan(5);
    // Announced once each, however long they lived.
    for (const a of [...sim.agents, ...sim.deceased]) {
      expect(sim.activity.filter((e) => e.text.startsWith(`${a.name.split(' ')[0]} is growing frail`) && e.agentId === a.id).length).toBeLessThanOrEqual(1);
    }
  });
});
