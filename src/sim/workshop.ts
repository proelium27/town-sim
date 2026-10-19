import type { Prop } from '../world/map';
import { ageOf } from './agents';
import { ADULT_AGE, type Bill, billGoods, type Good, GOODS, type RoleKey } from './defs';
import type { Sim } from './sim';

export type Station = 'saw' | 'kiln' | 'bench';

export interface Recipe {
  good: Good;
  inputs: Bill;
  out: number;
  station: Station;
  /** Minutes at the station for one batch, before skill. */
  minutes: number;
  role: RoleKey;
  verb: string;
}

/** What the workshop makes from what, at which station, and who does it. */
export const RECIPES: Recipe[] = [
  { good: 'planks', inputs: { wood: 3 }, out: 4, station: 'saw', minutes: 20, role: 'carpenter', verb: 'Sawing planks' },
  { good: 'bricks', inputs: { stone: 3 }, out: 4, station: 'kiln', minutes: 25, role: 'mason', verb: 'Firing bricks' },
  { good: 'furniture', inputs: { planks: 4 }, out: 1, station: 'bench', minutes: 40, role: 'carpenter', verb: 'Building furniture' },
  { good: 'tools', inputs: { planks: 1, stone: 2 }, out: 2, station: 'bench', minutes: 30, role: 'toolmaker', verb: 'Making tools' },
];

/** Which station a workshop prop is. */
export const STATION_OF: Partial<Record<string, Station>> = { sawbench: 'saw', kiln: 'kiln', workbench: 'bench' };

export const CRAFT_ROLES: RoleKey[] = ['carpenter', 'mason', 'toolmaker'];

export function hasWorkshop(sim: Sim): boolean {
  return sim.map.buildings.some((b) => b.kind === 'workshop');
}

/** The town's own workers who use tools on the job (farming goes no faster with them). */
export function toolUsers(sim: Sim): number {
  return sim.agents.filter((a) => ageOf(sim, a) >= ADULT_AGE && ['builder', 'woodcutter', 'laborer', 'carpenter', 'mason', 'toolmaker'].includes(a.role)).length;
}

/** How much of a good the town wants on hand: a working buffer plus whatever builds still need. */
export function targetOf(sim: Sim, g: Good): number {
  const owed = sim.projects.reduce((s, p) => s + Math.max(0, (p.need[g] ?? 0) - (p.delivered[g] ?? 0)), 0);
  const base: Partial<Record<Good, number>> = { planks: 24, bricks: 16, furniture: 2, tools: Math.ceil(toolUsers(sim) * 0.5) };
  // Planks also feed furniture and tools.
  const forFurniture = g === 'planks' ? Math.max(0, targetOf(sim, 'furniture') - sim.stock.furniture) * 4 : 0;
  return (base[g] ?? 0) + owed + forFurniture;
}

/** Batches still to make for a recipe (none if stocked). */
export function shortfall(sim: Sim, r: Recipe): number {
  const making = sim.agents.filter((a) => a.action.kind === 'craft' && a.action.material === r.good).length * r.out;
  return Math.max(0, targetOf(sim, r.good) - sim.stock[r.good] - making);
}

export function canMake(sim: Sim, r: Recipe): boolean {
  return billGoods(r.inputs).every((g) => sim.stock[g] >= r.inputs[g]!);
}

export function stationProps(sim: Sim, st: Station): Prop[] {
  return sim.map.props.filter((p) => STATION_OF[p.key] === st && p.spot);
}

export interface ChainStatus {
  recipe: Recipe;
  have: number;
  target: number;
  /** Why nothing is being made when it's needed, or null if it's flowing (or not needed). */
  stuck: string | null;
}

/** For the Town view: each chain, how stocked it is, and what (if anything) is holding it up. */
export function chains(sim: Sim): ChainStatus[] {
  const shop = hasWorkshop(sim);
  return RECIPES.map((r) => {
    const target = targetOf(sim, r.good);
    const have = sim.stock[r.good];
    let stuck: string | null = null;
    if (have < target) {
      if (!shop) stuck = 'no workshop yet';
      else if (!sim.agents.some((a) => a.role === r.role)) stuck = `no ${r.role}`;
      else if (!canMake(sim, r)) stuck = `needs ${billGoods(r.inputs).filter((g) => sim.stock[g] < r.inputs[g]!).map((g) => GOODS[g].label.toLowerCase()).join(' and ')}`;
    }
    return { recipe: r, have, target, stuck };
  });
}
