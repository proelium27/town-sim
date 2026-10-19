import type { Prop } from '../world/map';
import { PRIORITY_WEIGHT } from './defs';
import { buildCap, clutter, stageOf } from './planner';
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
  material?: 'wood' | 'stone';
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

/** A walkable cell inside a project's footprint to stand and work from, near the agent. */
function siteCell(sim: Sim, a: Agent, pr: Project): { cell: number; path: number[] } | null {
  const m = sim.map;
  const cells: number[] = [];
  for (let y = pr.y; y < pr.y + pr.h; y++) for (let x = pr.x; x < pr.x + pr.w; x++) {
    // Work from the outline so builders spread around the site.
    const edge = x === pr.x || y === pr.y || x === pr.x + pr.w - 1 || y === pr.y + pr.h - 1;
    if (edge && m.walkable(x, y)) cells.push(m.idx(x, y));
  }
  const busy = new Set(sim.agents.filter((o) => o.id !== a.id && o.action.projectId === pr.id).map((o) => o.action.dest));
  cells.sort((i, j) => (busy.has(i) ? 50 : 0) + Math.hypot(m.cx(i) - a.x, m.cy(i) - a.y) - ((busy.has(j) ? 50 : 0) + Math.hypot(m.cx(j) - a.x, m.cy(j) - a.y)));
  for (const cell of cells.slice(0, 3)) {
    const path = cell === a.at ? [] : sim.nav.findPath(a.at, cell, 40000);
    if (path) return { cell, path };
  }
  return null;
}

function inFlight(sim: Sim, pr: Project, mat: 'wood' | 'stone'): number {
  return sim.agents.filter((o) => o.action.kind === 'haul' && o.action.projectId === pr.id && o.action.material === mat).length * CARRY;
}

/** Best outdoor job for this worker right now, or null if there's nothing useful to do. */
export function laborPlan(sim: Sim, a: Agent): LaborPlan | null {
  const role = a.role;
  const plans: (() => LaborPlan | null)[] = [];
  const m = sim.map;

  // Anything in hand goes where it belongs first.
  if (a.carry) {
    return (() => {
      const d = depositSpot(sim, a);
      if (!d) return null;
      return { kind: 'deposit', label: `Bringing ${a.carry!.kind} to the storehouse`, reason: `Carrying ${a.carry!.amount} ${a.carry!.kind}`, dest: d.cell, path: d.path, timer: 2, score: 2 };
    })();
  }

  const builderish = role === 'builder' || role === 'laborer';
  const projects = [...sim.projects].sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
  for (const pr of projects) {
    if (!builderish && role !== 'woodcutter') break;
    const stage = stageOf(sim, pr);
    const mult = role === 'builder' ? 1 : role === 'laborer' ? 0.85 : 0.7;
    // Clearing the site: the timber and stone go straight into the build.
    const junk = clutter(sim, pr).filter((p) => free(sim, a, p));
    if (junk.length) {
      plans.push(() => {
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
    for (const mat of ['wood', 'stone'] as const) {
      const short = pr.need[mat] - pr.delivered[mat] - inFlight(sim, pr, mat);
      if (short > 0 && sim.stock[mat] >= 1) {
        plans.push(() => {
          const d = depositSpot(sim, a);
          if (!d) return null;
          return { kind: 'haul', label: `Hauling ${mat} to ${pr.name}`, reason: `${pr.name} needs ${Math.ceil(short)} more ${mat}`, dest: d.cell, path: d.path, projectId: pr.id, leg: 'pickup', material: mat, timer: 2, score: 0.95 * mult };
        });
      }
    }
    if (stage !== 'clearing' && pr.progress < buildCap(pr) - 0.5) {
      plans.push(() => {
        const c = siteCell(sim, a, pr);
        if (!c) return null;
        return { kind: 'build', label: `Building ${pr.name}`, reason: `Construction (${Math.floor((pr.progress / pr.work) * 100)}%)`, dest: c.cell, path: c.path, projectId: pr.id, timer: 60, score: 1.1 * mult };
      });
    }
  }

  // Gathering for the stockpile.
  const mw = PRIORITY_WEIGHT[sim.priorities.materials];
  const woodWant = 90 * mw - sim.stock.wood;
  const stoneWant = 60 * mw - sim.stock.stone;
  if ((role === 'woodcutter' || builderish) && (woodWant > 0 || stoneWant > 0)) {
    const kind = woodWant / 90 >= stoneWant / 60 ? 'wood' : 'stone';
    const base = role === 'woodcutter' ? 0.9 : role === 'laborer' ? 0.6 : 0.4;
    plans.push(() => {
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

  // Farming.
  const farmers = sim.agents.filter((o) => o.role === 'farmer').length;
  if (role === 'farmer' || (role === 'laborer' && farmers < 2)) {
    const base = role === 'farmer' ? 1 : 0.55;
    plans.push(() => {
      const crops = m.props.filter((p) => p.use === 'farm' && free(sim, a, p));
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

  // Resolve in order of their intended score; the closures only path-find when needed.
  let best: LaborPlan | null = null;
  for (const make of plans) {
    const p = make();
    if (p && (!best || p.score > best.score)) best = p;
  }
  return best;
}
