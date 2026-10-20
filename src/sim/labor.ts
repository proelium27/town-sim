import type { Prop } from '../world/map';
import { billGoods, type Good, GOODS, goodNoun, PRIORITY_WEIGHT } from './defs';
import { buildCap, clutter, shortOf, stageOf, supplied } from './planner';
import { paveFrontier } from './growth';
import { chill, FIREWOOD_STOCK, HEARTH_FULL, SPLIT } from './seasons';
import { canMake, CRAFT_ROLES, hasWorkshop, RECIPES, shortfall, stationProps } from './workshop';
import type { ActionKind, Agent, Project } from './types';
import type { Sim } from './sim';

/** A concrete outdoor job for a worker: where to go and what to do there. */
export interface LaborPlan {
  kind: ActionKind;
  label: string;
  reason: string;
  dest: number;
  path: number[];
  propId?: number;
  projectId?: number;
  leg?: 'pickup' | 'deliver';
  material?: Good;
  household?: number;
  timer: number;
  score: number;
}

export const CARRY = 6;

/** Nearest walkable tile next to a (blocking) prop, by path. */
function besideProp(sim: Sim, a: Agent, p: Prop): { cell: number; path: number[] } | null {
  const m = sim.map;
  const opts: number[] = [];
  for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
    const x = p.x + dx;
    const y = p.y + dy;
    if (m.walkable(x, y)) opts.push(m.idx(x, y));
  }
  opts.sort((i, j) => Math.hypot(m.cx(i) - a.x, m.cy(i) - a.y) - Math.hypot(m.cx(j) - a.x, m.cy(j) - a.y));
  for (const cell of opts.slice(0, 2)) {
    const path = cell === a.at ? [] : sim.nav.findPath(a.at, cell, 40000);
    if (path) return { cell, path };
  }
  return null;
}

function nearestTo(a: Agent, props: Prop[], n = 6): Prop[] {
  return props
    .map((p) => ({ p, d: Math.hypot(p.x - a.x, p.y - a.y) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, n)
    .map((x) => x.p);
}

function free(sim: Sim, a: Agent, p: Prop): boolean {
  const h = sim.reserved.get(p.id);
  return h === undefined || h === a.id;
}

export function depositSpot(sim: Sim, a: Agent): { cell: number; path: number[] } | null {
  const m = sim.map;
  const spots = m.props.filter((p) => p.use === 'deposit' && p.spot);
  spots.sort((p, q) => Math.hypot(p.spot!.x - a.x, p.spot!.y - a.y) - Math.hypot(q.spot!.x - a.x, q.spot!.y - a.y));
  for (const s of spots.slice(0, 3)) {
    const cell = m.idx(s.spot!.x, s.spot!.y);
    const path = cell === a.at ? [] : sim.nav.findPath(a.at, cell, 40000);
    if (path) return { cell, path };
  }
  return null;
}

/** Walkable cells on a project's outline: where builders stand and loads are dropped. */
export function siteEdges(sim: Sim, pr: Project): number[] {
  const m = sim.map;
  const cells: number[] = [];
  for (let y = pr.y; y < pr.y + pr.h; y++) for (let x = pr.x; x < pr.x + pr.w; x++) {
    const edge = x === pr.x || y === pr.y || x === pr.x + pr.w - 1 || y === pr.y + pr.h - 1;
    if (edge && m.walkable(x, y)) cells.push(m.idx(x, y));
  }
  return cells;
}

const reach = new WeakMap<Project, { key: string; ok: boolean }>();

/** Can anyone walk from this cell onto the site at all? Cached until walls or props change. */
export function siteReachable(sim: Sim, pr: Project, from: number): boolean {
  const m = sim.map;
  const key = `${m.propVersion}:${m.wallVersion}:${from}`;
  const hit = reach.get(pr);
  if (hit?.key === key) return hit.ok;
  const ok = siteEdges(sim, pr).some((c) => sim.nav.connected(from, c));
  reach.set(pr, { key, ok });
  return ok;
}

/** How long hauling to a site waits after a load found no way onto it, in game minutes. */
export const HAUL_PAUSE = 60;

/** A walkable cell inside a project's footprint to stand and work from, near the agent. */
function siteCell(sim: Sim, a: Agent, pr: Project): { cell: number; path: number[] } | null {
  const m = sim.map;
  // Work from the outline so builders spread around the site.
  const cells = siteEdges(sim, pr);
  const busy = new Set(sim.agents.filter((o) => o.id !== a.id && o.action.projectId === pr.id).map((o) => o.action.dest));
  cells.sort((i, j) => (busy.has(i) ? 50 : 0) + Math.hypot(m.cx(i) - a.x, m.cy(i) - a.y) - ((busy.has(j) ? 50 : 0) + Math.hypot(m.cx(j) - a.x, m.cy(j) - a.y)));
  for (const cell of cells.slice(0, 3)) {
    const path = cell === a.at ? [] : sim.nav.findPath(a.at, cell, 40000);
    if (path) return { cell, path };
  }
  return null;
}

function inFlight(sim: Sim, pr: Project, mat: Good): number {
  return sim.agents.filter((o) => o.action.kind === 'haul' && o.action.projectId === pr.id && o.action.material === mat).length * CARRY;
}

/** Firewood still to be split to see every home through the cold: stored plus by the hearths, against a season's target. */
export function firewoodShort(sim: Sim): number {
  const homes = sim.town.households.filter((h) => h.building >= 0);
  const want = homes.length * HEARTH_FULL * FIREWOOD_STOCK[sim.season];
  const have = sim.stock.firewood + homes.reduce((s, h) => s + sim.fuel[h.id], 0);
  return Math.max(0, want - have);
}

/**
 * When wood and stone are both short, gatherers split up in proportion to how short each is
 * (as a share of its target), so a desperate need for wood isn't diluted by stone being one short.
 * Each worker's share is fixed by id, so the same people keep the same job from hour to hour.
 */
export function gatherKind(a: Agent, woodShort: number, stoneShort: number): 'wood' | 'stone' {
  const toStone = stoneShort / (woodShort + stoneShort);
  return ((a.id * 0.618034) % 1) < toStone ? 'stone' : 'wood';
}

/** Best outdoor job for this worker right now, or null if there's nothing useful to do. */
export function laborPlan(sim: Sim, a: Agent): LaborPlan | null {
  const role = a.role;
  // Each candidate job carries the best score it could reach, so the expensive ones (pathfinding)
  // only run if they could still win.
  const plans: { bound: number; make: () => LaborPlan | null }[] = [];
  const add = (bound: number, make: () => LaborPlan | null) => plans.push({ bound, make });
  const m = sim.map;
  // Many plans start at the storehouse; find the way there once.
  let dep: ReturnType<typeof depositSpot> | undefined;
  const storehouse = () => (dep === undefined ? (dep = depositSpot(sim, a)) : dep);

  // Anything in hand goes where it belongs first. A load already on its way somewhere isn't swapped for another job.
  const delivering = a.action.leg === 'deliver' && (a.action.kind === 'haul' || a.action.kind === 'stoke');
  if (a.carry) {
    // In a blizzard the load waits in hand until it blows over.
    if (delivering || sim.events.snowstorm) return null;
    return (() => {
      const d = storehouse();
      if (!d) return null;
      return { kind: 'deposit', label: `Bringing ${a.carry!.kind} to the storehouse`, reason: `Carrying ${a.carry!.amount} ${a.carry!.kind}`, dest: d.cell, path: d.path, timer: 2, score: 2 };
    })();
  }

  const crafter = CRAFT_ROLES.includes(role);
  // Crafters pitch in with general labor when the workshop has nothing for them.
  const builderish = role === 'builder' || role === 'laborer' || crafter;

  if (crafter && hasWorkshop(sim)) {
    const mine = RECIPES.filter((r) => r.role === role && shortfall(sim, r) > 0 && canMake(sim, r)).sort((x, y) => shortfall(sim, y) / y.out - shortfall(sim, x) / x.out);
    const r = mine[0];
    if (r) {
      add(1.2, () => {
        const stations = stationProps(sim, r.station).filter((p) => free(sim, a, p));
        for (const p of nearestTo(a, stations, 2)) {
          const cell = m.idx(p.spot!.x, p.spot!.y);
          const path = cell === a.at ? [] : sim.nav.findPath(a.at, cell, 40000);
          if (!path) continue;
          return { kind: 'craft', label: r.verb, reason: `The town needs ${GOODS[r.good].label.toLowerCase()}`, dest: cell, path, propId: p.id, material: r.good, timer: r.minutes, score: 1.2 };
        }
        return null;
      });
    }
  }
  // In a blizzard the outdoor work waits (the workshop is indoors), except a hearth about to go out.
  const storm = !!sim.events.snowstorm;
  const projects = storm ? [] : [...sim.projects].sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
  for (const pr of projects) {
    if (!builderish && role !== 'woodcutter') break;
    const stage = stageOf(sim, pr);
    const mult = role === 'builder' ? 1 : role === 'laborer' ? 0.85 : crafter ? 0.6 : 0.7;
    // Clearing the site: the timber and stone go straight into the build.
    const junk = clutter(sim, pr).filter((p) => free(sim, a, p));
    if (junk.length) {
      add(1.05 * mult, () => {
        for (const p of nearestTo(a, junk, 3)) {
          const b = besideProp(sim, a, p);
          if (!b) continue;
          const wood = p.resource === 'wood';
          return { kind: wood ? 'chop' : 'mine', label: `Clearing the site for ${pr.name}`, reason: 'The site needs clearing', dest: b.cell, path: b.path, propId: p.id, projectId: pr.id, timer: wood ? 18 : 26, score: 1.05 * mult };
        }
        return null;
      });
    }
    if (!builderish) continue;
    // No fetching for a site nobody can walk onto (still hemmed in by trees, or walled off).
    const paused = (pr.haulPause ?? 0) > sim.time;
    for (const mat of billGoods(pr.need)) {
      const short = shortOf(pr, mat) - inFlight(sim, pr, mat);
      if (short > 0 && sim.stock[mat] >= 1 && !paused) {
        add(0.95 * mult, () => {
          const d = storehouse();
          if (!d || !siteReachable(sim, pr, d.cell)) return null;
          return { kind: 'haul', label: `Hauling ${mat} to ${pr.name}`, reason: `${pr.name} needs ${Math.ceil(short)} more ${goodNoun(Math.ceil(short), mat)}`, dest: d.cell, path: d.path, projectId: pr.id, leg: 'pickup', material: mat, timer: 2, score: 0.95 * mult };
        });
      }
    }
    // Build while materials allow; once everything has arrived, finish the last sliver too, or a
    // builder who stopped within half a point of done would leave the site unfinished for good.
    if (stage !== 'clearing' && (pr.progress < buildCap(pr) - 0.5 || (supplied(pr) && pr.progress < pr.work - 0.01))) {
      add(1.1 * mult, () => {
        const c = siteCell(sim, a, pr);
        if (!c) return null;
        return { kind: 'build', label: `Building ${pr.name}`, reason: `Construction (${Math.floor((pr.progress / pr.work) * 100)}%)`, dest: c.cell, path: c.path, projectId: pr.id, timer: 60, score: 1.1 * mult };
      });
    }
  }

  // Gathering for the stockpile, plus the logs still to be split for winter.
  const mw = PRIORITY_WEIGHT[sim.priorities.materials];
  const woodTarget = 90 * mw + firewoodShort(sim) * 0.7;
  const stoneTarget = 60 * mw;
  const woodWant = woodTarget - sim.stock.wood;
  const stoneWant = stoneTarget - sim.stock.stone;
  if (!storm && (role === 'woodcutter' || builderish) && (woodWant > 0 || stoneWant > 0)) {
    const kind = woodWant > 0 && stoneWant > 0 ? gatherKind(a, woodWant / woodTarget, stoneWant / stoneTarget) : woodWant > 0 ? 'wood' : 'stone';
    const base = role === 'woodcutter' ? 0.9 : role === 'laborer' ? 0.6 : 0.4;
    add(base, () => {
      const busy = new Set(sim.reserved.keys());
      const near = nearestTo(a, m.props.filter((p) => p.resource === kind && !busy.has(p.id) && !sim.projects.some((pr) => p.x >= pr.x - 1 && p.x <= pr.x + pr.w && p.y >= pr.y - 1 && p.y <= pr.y + pr.h)), 4);
      for (const p of near) {
        const b = besideProp(sim, a, p);
        if (!b) continue;
        return { kind: kind === 'wood' ? 'chop' : 'mine', label: kind === 'wood' ? 'Chopping wood' : 'Quarrying stone', reason: `The town needs ${kind}`, dest: b.cell, path: b.path, propId: p.id, timer: kind === 'wood' ? 18 : 26, score: base };
      }
      return null;
    });
  }

  // A town paves its dirt paths, spreading out from the streets, a stone a tile.
  if (!storm && sim.tier >= 1 && builderish && sim.stock.stone >= 20) {
    const frontier = paveFrontier(sim);
    if (frontier.length) {
      add(0.5, () => {
        const near = frontier
          .filter((i) => !sim.agents.some((o) => o.action.kind === 'pave' && o.action.dest === i))
          .sort((i, j) => Math.hypot(m.cx(i) - a.x, m.cy(i) - a.y) - Math.hypot(m.cx(j) - a.x, m.cy(j) - a.y))
          .slice(0, 2);
        for (const cell of near) {
          const path = cell === a.at ? [] : sim.nav.findPath(a.at, cell, 40000);
          if (!path) continue;
          return { kind: 'pave', label: 'Paving the path', reason: `${sim.tier === 1 ? 'A town' : 'A city'} should have proper paths`, dest: cell, path, timer: 6, score: 0.5 };
        }
        return null;
      });
    }
  }

  // Firewood: split logs at the storehouse and carry it to hearths that are running low.
  const winterHands = role === 'woodcutter' || builderish || (role === 'farmer' && sim.season === 3);
  if (winterHands) {
    const homes = sim.town.households.filter((h) => h.building >= 0);
    const short = firewoodShort(sim);
    if (!storm && short > 0 && sim.stock.wood >= SPLIT.wood) {
      const base = role === 'woodcutter' ? 1 : role === 'farmer' ? 0.85 : role === 'laborer' ? 0.75 : 0.5;
      add(base * (sim.season === 3 ? 1.15 : 1), () => {
        const d = storehouse();
        if (!d) return null;
        return { kind: 'split', label: 'Splitting firewood', reason: `The town needs ${Math.ceil(short)} more firewood`, dest: d.cell, path: d.path, timer: 20, score: base * (sim.season === 3 ? 1.15 : 1) };
      });
    }
    const coming = new Set(sim.agents.filter((o) => o.action.kind === 'stoke').map((o) => o.action.household));
    const low = homes.filter((h) => sim.fuel[h.id] < (storm ? 3 : HEARTH_FULL * 0.5) && !coming.has(h.id)).sort((x, y) => sim.fuel[x.id] - sim.fuel[y.id])[0];
    if (low && sim.stock.firewood >= 1 && (sim.season >= 2 || chill(sim) > 0)) {
      add((role === 'builder' ? 0.9 : 1.15) * (sim.fuel[low.id] < 2 ? 1.3 : 1), () => {
        const d = storehouse();
        if (!d) return null;
        return {
          kind: 'stoke', label: `Fetching firewood for the ${low.name}`, reason: `The ${low.name} is low on firewood`,
          dest: d.cell, path: d.path, household: low.id, leg: 'pickup', timer: 2, score: (role === 'builder' ? 0.9 : 1.15) * (sim.fuel[low.id] < 2 ? 1.3 : 1),
        };
      });
    }
  }

  // Farming (nothing grows in winter; only ripe crops are worth a trip).
  const farmers = sim.agents.filter((o) => o.role === 'farmer').length;
  if (!storm && (role === 'farmer' || (role === 'laborer' && farmers < 2 && sim.priorities.food > 0))) {
    const base = role === 'farmer' ? 1 : 0.55;
    add(base * 1.1, () => {
      const crops = m.props.filter((p) => p.use === 'farm' && free(sim, a, p) && (sim.season !== 3 || (p.growth ?? 0) >= 1));
      const ripe = crops.filter((p) => (p.growth ?? 0) >= 1);
      const pick = ripe.length ? nearestTo(a, ripe, 2) : nearestTo(a, crops.sort((p, q) => (p.growth ?? 0) - (q.growth ?? 0)).slice(0, 12), 2);
      for (const p of pick) {
        const cell = m.idx(p.spot!.x, p.spot!.y);
        const path = cell === a.at ? [] : sim.nav.findPath(a.at, cell, 40000);
        if (!path) continue;
        const harvest = (p.growth ?? 0) >= 1;
        return { kind: 'farm', label: harvest ? 'Harvesting' : 'Tending the crops', reason: harvest ? 'The crop is ripe' : 'Crops need care', dest: cell, path, propId: p.id, timer: harvest ? 4 : 6, score: base * (harvest ? 1.1 : 0.8) };
      }
      return null;
    });
  }

  // Best first; stop once nothing left could beat what we have.
  plans.sort((x, y) => y.bound - x.bound);
  let best: LaborPlan | null = null;
  for (const { bound, make } of plans) {
    if (best && best.score >= bound) break;
    const p = make();
    if (p && (!best || p.score > best.score)) best = p;
  }
  return best;
}
