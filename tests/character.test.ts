import { describe as group, expect, it } from 'vitest';
import { createAgent } from '../src/sim/agents';
import { CLASSIC, type Character, describe, rollCharacter } from '../src/sim/character';
import { Nav } from '../src/sim/nav';
import { triggerWorldEvent } from '../src/sim/events';
import { capacity, findSite, newHousehold, proposals, tickPlanner } from '../src/sim/planner';
import { loadSim, saveSim } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { BLUEPRINTS } from '../src/world/blueprints';
import { CORE_H, CORE_W, buildTown } from '../src/world/town';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 3);

/** A town with this seed's character, overridden where a test needs it. */
const town = (seed: number, over: Partial<Character> = {}) => new Sim(seed, { character: { ...rollCharacter(seed), ...over } });

group('town character', () => {
  it('is the same every time for a seed, and towns differ from seed to seed', () => {
    expect(rollCharacter(42)).toEqual(rollCharacter(42));
    const cs = SEEDS.map(rollCharacter);
    expect(new Set(cs.map((c) => c.setting)).size).toBe(4);
    expect(new Set(cs.map((c) => c.trade)).size).toBe(4);
    expect(new Set(cs.map((c) => c.layout)).size).toBe(3);
    expect(new Set(cs.map((c) => c.name)).size).toBeGreaterThanOrEqual(25);
    expect(new Set(cs.map((c) => c.founders.join())).size).toBe(cs.length);
    for (const c of cs) {
      expect(new Set(c.founders).size).toBe(6);
      expect(describe(c).summary).toMatch(/^An? \w+ \w+ .+\.$/);
    }
  });

  it('names the town, its office and its founding families', () => {
    const sim = new Sim(42);
    const c = sim.character;
    expect(sim.name).toBe(c.name);
    expect(sim.town.workplaces.find((w) => w.id === 'office')!.name).toBe(`${c.name} Studio`);
    expect(sim.town.households.map((h) => h.name)).toEqual(c.founders.map((s) => `${s} home`));
    expect(sim.history[0].text).toContain(c.name);
  });

  it('starts out with what the town was founded on', () => {
    const base = new Sim(42, { character: CLASSIC, agents: false });
    const by = (trade: Character['trade']) => SEEDS.map((s) => new Sim(s, { agents: false })).find((s) => s.character.trade === trade)!;
    expect(by('timber').stock.wood).toBeGreaterThan(base.stock.wood);
    expect(by('quarry').stock.stone).toBeGreaterThan(base.stock.stone);
    expect(by('farming').stock.food).toBeGreaterThan(base.stock.food);
    expect(by('market').treasury).toBeGreaterThan(base.treasury);
  });
});

group('the land a town sits on', () => {
  it('keeps lakes off the roads and out of the original town, and every home can still reach the east road', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const { map: m, households } = buildTown(seed, rollCharacter(seed));
      for (let i = 0; i < m.ground.length; i++) {
        if (m.ground[i] !== 'water') continue;
        const x = m.cx(i);
        const y = m.cy(i);
        // The original town's own pond is in the park (north of the east road, east of the north road).
        if (x < CORE_W && y < CORE_H) expect(x >= 45 && y < 24, `seed ${seed}: water at ${x},${y}`).toBe(true);
        expect(y >= 24 && y <= 28, `seed ${seed}: water on the east road`).toBe(false);
        expect(x >= 40 && x <= 44, `seed ${seed}: water on the north road`).toBe(false);
      }
      const nav = new Nav(m);
      for (const h of households) expect(nav.findPath(m.idx(h.door.x, h.door.y), m.idx(m.w - 1, 27), 60000), `seed ${seed}: ${h.name}`).not.toBeNull();
    }
  });

  it('woodland is wooded and highland is rocky', () => {
    const count = (setting: Character['setting'], resource: 'wood' | 'stone') => {
      const seed = SEEDS.find((s) => rollCharacter(s).setting === setting)!;
      return buildTown(seed, rollCharacter(seed)).map.props.filter((p) => p.resource === resource).reduce((n, p) => n + (p.amount ?? 0), 0);
    };
    const classic = buildTown(7, CLASSIC).map.props;
    const classicOf = (r: string) => classic.filter((p) => p.resource === r).reduce((n, p) => n + (p.amount ?? 0), 0);
    expect(count('woodland', 'wood')).toBeGreaterThan(count('meadow', 'wood'));
    expect(count('woodland', 'wood')).toBeGreaterThan(classicOf('wood'));
    expect(count('highland', 'stone')).toBeGreaterThan(count('meadow', 'stone'));
  });
});

group('how a town settles', () => {
  const H = BLUEPRINTS.house;
  const roadGap = (s: { x: number; y: number }) => {
    const across = s.y > 28 ? s.y - 28 : s.y + H.h <= 24 ? 24 - (s.y + H.h) : 0;
    const along = s.x > 44 ? s.x - 44 : s.x + H.w <= 40 ? 40 - (s.x + H.w) : 0;
    return Math.min(across, along);
  };
  /** Tiles of open ground between a plot and the nearest other building. */
  const gap = (sim: Sim, s: { x: number; y: number }, w: number, h: number) =>
    Math.min(...sim.map.buildings.map((b) => Math.max(Math.max(b.x - (s.x + w), s.x - (b.x + b.w), 0), Math.max(b.y - (s.y + h), s.y - (b.y + b.h), 0))));
  /** Where a town's next few homes go, each built before the next is sited. */
  const homes = (sim: Sim, n: number) => {
    const out: { x: number; y: number; gap: number }[] = [];
    for (let k = 0; k < n; k++) {
      const s = findSite(sim, 'house')!;
      out.push({ ...s, gap: gap(sim, s, H.w, H.h) });
      const hh = newHousehold(sim, `Test ${k}`);
      H.stamp(sim.map, s.x, s.y, s.doorTop, `Test ${k}`, hh.id);
    }
    return out;
  };
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

  it('a roadside town strings its first homes along the main roads', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const ribbon = homes(town(seed, { layout: 'roadside', whim: 0 }), 4).map(roadGap);
      const huddle = homes(town(seed, { layout: 'clustered', whim: 0 }), 4).map(roadGap);
      expect(Math.min(...ribbon), `seed ${seed}`).toBeLessThanOrEqual(3);
      expect(mean(ribbon), `seed ${seed}`).toBeLessThan(mean(huddle));
    }
  });

  it('a clustered town builds onto its edge; a scattered one leaves room between homesteads', () => {
    const huddle: number[] = [];
    const spread: number[] = [];
    for (const seed of SEEDS.slice(0, 6)) {
      huddle.push(...homes(town(seed, { layout: 'clustered', whim: 0 }), 5).map((s) => s.gap));
      spread.push(...homes(town(seed, { layout: 'scattered', whim: 0 }), 5).map((s) => s.gap));
    }
    expect(mean(huddle)).toBeLessThan(4.5);
    expect(mean(spread)).toBeGreaterThan(mean(huddle) * 2);
  });

  it('a town leans the way it grows', () => {
    const seed = SEEDS[0];
    const at = (heading: number) => homes(town(seed, { layout: 'clustered', whim: 0, lean: 16, heading }), 3);
    const east = mean(at(0).map((s) => s.x));
    const south = at(Math.PI / 2);
    expect(east).toBeGreaterThan(mean(south.map((s) => s.x)));
  });

  it('farms go out to open land on their own side of town', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const sim = town(seed, { whim: 0 });
      const s = findSite(sim, 'farm')!;
      expect(gap(sim, s, BLUEPRINTS.farm.w, BLUEPRINTS.farm.h), `seed ${seed}`).toBeGreaterThanOrEqual(3);
    }
  });

  /** Every bed in town taken, so there is no room for anyone new. */
  const fill = (sim: Sim) => {
    for (const h of sim.town.households) {
      while (sim.agents.filter((a) => a.household === h.id).length < sim.map.props.filter((p) => p.use === 'sleep' && p.household === h.id).length) {
        sim.agents.push(createAgent(sim, { role: 'child', household: h.id, age: 6, cell: sim.map.idx(h.door.x, h.door.y + 2) }));
      }
    }
    return sim;
  };

  it('a welcoming town builds homes ahead of newcomers sooner than a wary one, but even a wary one does', () => {
    const score = (openness: number) => proposals(fill(town(SEEDS[0], { openness, whim: 0 }))).find((p) => p.reason === 'there is no room for anyone new')?.score ?? 0;
    expect(score(0.9)).toBeGreaterThan(score(0.1));
    // A meeting only takes up a case scoring 0.5 or more.
    expect(score(0.1)).toBeGreaterThanOrEqual(0.5);
  });

  it('a town that cares little for public works still gets a diner, just later', () => {
    const diner = (civic: number) => {
      const c = rollCharacter(SEEDS[0]);
      const sim = town(SEEDS[0], { civic, trade: 'farming', dinerEvery: Math.round(28 - civic * 8), bias: { ...c.bias, diner: 0.85 + civic * 0.3 } });
      while (sim.agents.length < 30) sim.agents.push(createAgent(sim, { role: 'laborer', household: 0, age: 30, cell: sim.map.idx(10, 33) }));
      return proposals(sim).find((p) => p.bp === 'diner')?.score ?? 0;
    };
    expect(diner(0.1)).toBeGreaterThanOrEqual(0.5);
    expect(diner(0.9)).toBeGreaterThan(diner(0.1));
  });

  it('a timber town wants its workshop sooner', () => {
    const wants = (c: Partial<Character>) => proposals(town(SEEDS[0], c)).some((p) => p.bp === 'workshop');
    expect(wants({ trade: 'timber', workshopAt: 18 })).toBe(true);
    expect(wants({ workshopAt: 22 })).toBe(false);
  });

  it('a family-minded couple with every bed full builds on before the next baby', () => {
    const propose = (kin: number) => {
      const sim = town(SEEDS[0], { kin, whim: 0 });
      const site = findSite(sim, 'house')!;
      const hh = newHousehold(sim, 'Test home');
      const b = H.stamp(sim.map, site.x, site.y, site.doorTop, 'Test home', hh.id);
      Object.assign(hh, { building: b.id, room: b.rooms[0], door: b.door });
      const cell = sim.map.idx(b.door.x, b.door.y + 2);
      const mum = createAgent(sim, { role: 'laborer', household: hh.id, age: 30, cell });
      const dad = createAgent(sim, { role: 'laborer', household: hh.id, age: 31, cell });
      mum.partner = dad.id;
      dad.partner = mum.id;
      sim.agents.push(mum, dad);
      while (sim.agents.filter((a) => a.household === hh.id).length < capacity(sim, hh.id)) {
        const kid = createAgent(sim, { role: 'child', household: hh.id, age: 3, parents: [mum, dad], cell });
        sim.agents.push(kid);
        mum.children.push(kid.id);
        dad.children.push(kid.id);
      }
      return proposals(sim).some((p) => p.bp === 'extension' && p.reason.includes('room for another child'));
    };
    expect(propose(0.85)).toBe(true);
    expect(propose(0.5)).toBe(false);
  });
});

group('town meetings', () => {
  it('chance never puts anything ahead of a family with nowhere to live', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const sim = town(seed, { whim: 0.45 });
      const hh = newHousehold(sim, 'Newcomers');
      const a = createAgent(sim, { role: 'laborer', household: hh.id, age: 30, cell: sim.map.idx(sim.map.w - 1, 27) });
      sim.agents.push(a);
      sim.priorities.food = 2;
      // Food running low too: pressing, but the homeless still come first.
      sim.stock.food = 10;
      sim.projects = [];
      sim.treasury = 500;
      sim.timers.plan = 0;
      tickPlanner(sim, 0.05);
      expect(sim.projects[0]?.forAgents, `seed ${seed}`).toContain(a.id);
    }
  });

  it('the dead waiting for a grave come first even when the cemetery is full', () => {
    const sim = town(SEEDS[0], { whim: 0.45 });
    const site = findSite(sim, 'cemetery')!;
    BLUEPRINTS.cemetery.stamp(sim.map, site.x, site.y, site.doorTop, 'Old Cemetery');
    const dead = sim.agents.pop()!;
    sim.deceased.push(dead);
    sim.unburied.push(dead.id);
    const p = proposals(sim).find((x) => x.bp === 'cemetery')!;
    expect(p.reason).toBe('the cemetery is full');
    expect(p.urgent).toBe(true);
  });

  it('when food runs low, a new farm is not left to the luck of the meeting', () => {
    const sim = town(SEEDS[0], { whim: 0.45 });
    sim.stock.food = 10;
    expect(proposals(sim).find((p) => p.bp === 'farm')?.pressing).toBe(true);
  });

  it('towns with different characters grow differently from the same start', () => {
    const grown = [1, 2, 3].map((seed) => {
      const sim = new Sim(seed);
      sim.run(2 * 1440);
      const mine = [...sim.map.buildings.slice(12), ...sim.projects];
      expect(mine.length, sim.name).toBeGreaterThan(0);
      return mine.map((b) => `${b.name}@${b.x},${b.y}`).join('|');
    });
    expect(new Set(grown).size).toBe(3);
  }, 120_000);
});

group('rolled towns stay healthy', () => {
  // Two towns the other tests don't use, a game week and a half each: whatever they roll, they keep growing.
  for (const seed of [31337, 900001]) {
    it(`seed ${seed} houses everyone and keeps its people`, () => {
      const sim = new Sim(seed);
      let homeless = 0;
      for (let t = 0; t < 10 * 1440; t += 60) {
        sim.run(60);
        homeless = Math.max(homeless, sim.agents.filter((a) => sim.town.households[a.household].building < 0).length);
      }
      expect(sim.departed.length, sim.name).toBe(0);
      expect(homeless, sim.name).toBe(0);
      expect(sim.agents.length, sim.name).toBeGreaterThanOrEqual(18);
      expect(sim.map.buildings.length - 12, sim.name).toBeGreaterThanOrEqual(4);
    }, 300_000);
  }
});

group('winter', () => {
  it('a blizzard that empties the cupboards still sends someone to the market before night', () => {
    const sim = new Sim(11, { character: CLASSIC });
    // Winter, mid-afternoon on a workday, every pantry bare, and a blizzard blowing in.
    sim.run(6 * 1440 + 15 * 60 - sim.time);
    expect(sim.season).toBe(3);
    for (let i = 0; i < sim.pantry.length; i++) sim.pantry[i] = 0;
    triggerWorldEvent(sim, 'snowstorm');
    sim.run(5.4 * 60);
    const homes = sim.town.households.filter((h) => h.building >= 0 && sim.agents.some((a) => a.household === h.id && a.role !== 'child'));
    const fed = homes.filter((h) => sim.pantry[h.id] >= 1);
    expect(fed.length / homes.length).toBeGreaterThanOrEqual(0.6);
  }, 120_000);
});

group('saves', () => {
  it('a town keeps its character through a save', () => {
    const sim = new Sim(42);
    const back = loadSim(saveSim(sim));
    expect(back.character).toEqual(sim.character);
    expect(back.name).toBe(sim.name);
  });

  it('a town saved before characters loads as the original Northwind', () => {
    const file = JSON.parse(saveSim(new Sim(42, { character: CLASSIC })));
    delete file.sim.character;
    const back = loadSim(JSON.stringify(file));
    expect(back.character.classic).toBe(true);
    expect(back.name).toBe('Northwind');
  });

  it('dials added since a town was saved start neutral', () => {
    const file = JSON.parse(saveSim(new Sim(42)));
    delete file.sim.character.foodMargin;
    delete file.sim.character.woodStock;
    const back = loadSim(JSON.stringify(file));
    expect(back.character.foodMargin).toBe(1);
    expect(back.character.woodStock).toBe(1);
    expect(back.character.classic).toBeUndefined();
  });
});

group('the original town', () => {
  it('still grows the way it always did', () => {
    // A fingerprint of classic Northwind's first two days: founders, and the first projects in order.
    // If this changes, the original town (and every old save) has changed; make sure that was meant.
    const sim = new Sim(7, { character: CLASSIC });
    expect(sim.town.households.map((h) => h.name)).toEqual(['Okafor home', 'Lindqvist home', 'Reyes home', 'Tanaka home', 'Haddad home', 'Novak home']);
    expect(sim.map.buildings.find((b) => b.kind === 'farm')!.name).toBe('Meadow Farm');
    sim.run(2 * 1440);
    const projects = sim.history.filter((h) => h.text.startsWith('Built ')).map((h) => h.text);
    const meetings = sim.activity.filter((e) => e.text.includes('town meeting') || e.text.startsWith('Town meeting')).map((e) => e.text.replace(/^.*proposed /, ''));
    expect({ projects, meetings }).toMatchSnapshot();
  }, 120_000);
});
