import type { TownMap } from '../world/map';
import { replan } from './ai';
import type { Agent } from './types';
import type { Sim } from './sim';
import { NOTABLE } from './types';

/**
 * The lake: fish off the dock in every season (through the ice in winter, which makes it the one harvest that
 * outlasts the first frost), skating once it freezes, and summer afternoons on the shore.
 */

/** Food in a 40-minute stint at the end of the pier, by season (spring, summer, autumn, winter through the ice). */
export const CATCH = [2.5, 2.5, 3, 1.5];

/** What someone brings up in one stint: the season's catch, more with practice. */
export function catchFor(sim: Sim, a: Agent): number {
  return CATCH[sim.season] * (1 + a.skills.craft.level * 0.04);
}

const cache = new WeakMap<TownMap, { v: number; water: number[]; shore: number[] }>();

/** Open-water cells (skating, once frozen) and the dry, walkable cells right beside them (sitting by the water). */
export function lakeCells(m: TownMap): { water: number[]; shore: number[] } {
  const hit = cache.get(m);
  if (hit && hit.v === m.groundVersion) return hit;
  const water: number[] = [];
  const shore: number[] = [];
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const i = m.idx(x, y);
      if (m.ground[i] === 'water') water.push(i);
      else if (m.cell[i] === 0 && m.room[i] < 0 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => m.inBounds(x + dx, y + dy) && m.ground[m.idx(x + dx, y + dy)] === 'water')) shore.push(i);
    }
  }
  const out = { v: m.groundVersion, water, shore };
  cache.set(m, out);
  return out;
}

/** Ice comes with winter and goes with spring. Anyone caught out on it at the thaw steps ashore and thinks again. */
export function tickLake(sim: Sim): void {
  const m = sim.map;
  const frozen = sim.season === 3;
  if (m.ice === frozen) return;
  m.setIce(frozen);
  if (!lakeCells(m).water.length) return;
  if (frozen) {
    sim.log('The lake has frozen over: skating weather', 'event', 'good').weight = NOTABLE;
    return;
  }
  sim.log('The ice on the lake broke up', 'event', 'neutral');
  for (const a of sim.agents) {
    const onWater = m.ground[a.at] === 'water';
    const crossing = a.path.slice(a.pathPos).some((i) => m.ground[i] === 'water');
    if (onWater) {
      const land = nearestLand(m, a.at);
      if (land >= 0) {
        a.at = land;
        a.x = a.px = m.cx(land);
        a.y = a.py = m.cy(land);
      }
    }
    if (onWater || crossing) replan(sim, a);
  }
}

function nearestLand(m: TownMap, from: number): number {
  const fx = m.cx(from);
  const fy = m.cy(from);
  for (let r = 1; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (m.walkable(fx + dx, fy + dy)) return m.idx(fx + dx, fy + dy);
    }
  }
  return -1;
}
