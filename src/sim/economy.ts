import type { PropKey } from '../assets/manifest';
import type { DrawnKey, Prop } from '../world/map';
import { CORE_H, CORE_W } from '../world/town';
import { cropSeason } from './seasons';
import type { Sim } from './sim';

/** Days for a crop to ripen untended. */
export const CROP_DAYS = 1.5;
export const FOOD_PER_CROP = 2;
const TREES: PropKey[] = ['treeGreen', 'treeLime', 'treeOrange', 'treeTall'];

export function cropStage(growth: number): DrawnKey {
  return growth >= 1 ? 'crop3' : growth >= 0.6 ? 'crop2' : growth >= 0.25 ? 'crop1' : 'crop0';
}

const cache = new WeakMap<object, { version: number; crops: Prop[]; temporary: Prop[] }>();

function lists(sim: Sim) {
  const m = sim.map;
  let c = cache.get(m);
  if (!c || c.version !== m.propVersion) {
    c = { version: m.propVersion, crops: m.props.filter((p) => p.use === 'farm'), temporary: m.props.filter((p) => p.expires !== undefined) };
    cache.set(m, c);
  }
  return c;
}

export function tickEconomy(sim: Sim, dt: number): void {
  const m = sim.map;
  const ev = sim.events;
  const rate = (dt / (CROP_DAYS * 1440)) * (ev.drought ? 0 : ev.rain ? 1.3 : 1) * cropSeason(sim);
  const { crops, temporary } = lists(sim);
  for (const p of crops) {
    if ((p.growth ?? 0) < 1) p.growth = Math.min(1, (p.growth ?? 0) + rate);
    p.key = cropStage(p.growth ?? 0);
  }
  for (const p of temporary) if (sim.time >= p.expires!) m.removeProp(p);

  // Forests slowly grow back from their edges, and untrodden trails grass over.
  sim.timers.regrow -= dt;
  if (sim.timers.regrow > 0) return;
  sim.timers.regrow = 30;
  m.fadeWear();
  const reserved = new Set(sim.projects.flatMap((pr) => cellsOf(sim, pr.x - 1, pr.y - 1, pr.w + 2, pr.h + 2)));
  for (let k = 0; k < 6; k++) {
    const x = sim.rng.int(0, m.w - 1);
    const y = sim.rng.int(0, m.h - 1);
    if (x < CORE_W && y < CORE_H) continue;
    const i = m.idx(x, y);
    if (m.ground[i] !== 'grass' || m.cell[i] !== 0 || m.room[i] >= 0 || m.propsOn(x, y).length || reserved.has(i)) continue;
    // Only next to existing trees, and away from buildings and roads.
    const nearTree = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]].some(([dx, dy]) => m.propsOn(x + dx, y + dy).some((p) => p.resource === 'wood'));
    if (!nearTree) continue;
    if (m.buildings.some((b) => x >= b.x - 2 && x < b.x + b.w + 2 && y >= b.y - 2 && y < b.y + b.h + 2)) continue;
    if (sim.agents.some((a) => a.at === i)) continue;
    m.addProp({ key: sim.rng.pick(TREES), x, y, w: 1, h: 1, resource: 'wood', amount: 6 });
  }
}

export function cellsOf(sim: Sim, x: number, y: number, w: number, h: number): number[] {
  const out: number[] = [];
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (sim.map.inBounds(xx, yy)) out.push(sim.map.idx(xx, yy));
  return out;
}

/**
 * Rough daily food production and consumption, for the planner and the Town panel.
 * With yearRound, production is averaged over the year (nothing grows in winter).
 */
export function foodBalance(sim: Sim, yearRound = false): { produce: number; eat: number } {
  const crops = sim.map.props.filter((p) => p.use === 'farm').length;
  const farmers = sim.agents.filter((a) => a.role === 'farmer').length;
  // Crops only turn into food if someone harvests them.
  const harvestable = Math.min(crops, farmers * 30);
  const season = yearRound ? 0.75 : cropSeason(sim);
  return { produce: ((harvestable * FOOD_PER_CROP) / CROP_DAYS) * season, eat: sim.agents.length * 2.6 };
}
