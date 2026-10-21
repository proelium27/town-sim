import { describe as group, expect, it } from 'vitest';
import { createAgent } from '../src/sim/agents';
import { CLASSIC, type Character, describe, rollCharacter } from '../src/sim/character';
import { Nav } from '../src/sim/nav';
import { findSite, newHousehold, proposals, tickPlanner } from '../src/sim/planner';
import { loadSim, saveSim } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
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
  const roadGap = (s: { x: number; y: number }) => {
    const across = s.y > 28 ? s.y - 28 : s.y + 6 <= 24 ? 24 - (s.y + 6) : 0;
    const along = s.x > 44 ? s.x - 44 : s.x + 9 <= 40 ? 40 - (s.x + 9) : 0;
    return Math.min(across, along);
  };

  it('a roadside town strings its homes along the main roads', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const ribbon = findSite(town(seed, { layout: 'roadside', whim: 0 }), 'house')!;
      const spread = findSite(town(seed, { layout: 'scattered', whim: 0 }), 'house')!;
      expect(roadGap(ribbon), `seed ${seed}`).toBeLessThanOrEqual(roadGap(spread));
    }
  });

  it('a town leans the way it grows', () => {
    const seed = SEEDS[0];
    const at = (heading: number) => findSite(town(seed, { layout: 'clustered', whim: 0, lean: 18, heading }), 'house')!;
    const east = at(0);
    const west = at(Math.PI);
    expect(east.x).toBeGreaterThan(west.x);
  });

  it('a welcoming town builds homes ahead of newcomers more readily than a wary one', () => {
    const score = (openness: number) => {
      const sim = town(SEEDS[0], { openness, whim: 0 });
      // Every bed taken, so the town has no room for anyone new.
      for (const h of sim.town.households) {
        while (sim.agents.filter((a) => a.household === h.id).length < sim.map.props.filter((p) => p.use === 'sleep' && p.household === h.id).length) {
          sim.agents.push(createAgent(sim, { role: 'child', household: h.id, age: 6, cell: sim.map.idx(h.door.x, h.door.y + 2) }));
        }
      }
      return proposals(sim).find((p) => p.reason === 'there is no room for anyone new')?.score ?? 0;
    };
    expect(score(0.9)).toBeGreaterThan(score(0.1));
  });

  it('a timber town wants its workshop sooner', () => {
    const wants = (c: Partial<Character>) => proposals(town(SEEDS[0], c)).some((p) => p.bp === 'workshop');
    expect(wants({ trade: 'timber', workshopAt: 18 })).toBe(true);
    expect(wants({ workshopAt: 22 })).toBe(false);
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
      sim.projects = [];
      sim.treasury = 500;
      sim.timers.plan = 0;
      tickPlanner(sim, 0.05);
      expect(sim.projects[0]?.forAgents, `seed ${seed}`).toContain(a.id);
    }
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
});
