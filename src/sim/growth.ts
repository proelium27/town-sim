import type { GroundKey } from '../assets/manifest';
import { type Building, Cell } from '../world/map';
import { triggerWorldEvent } from './events';
import { addMemory } from './social';
import type { Sim } from './sim';

/** Extensions add a 4-tile-wide bedroom wing along one side of a house. */
export const EXTENSION_W = 4;
/** Houses don't grow past this width. */
const MAX_HOUSE_W = 19;
const BUILDABLE = new Set<GroundKey>(['grass', 'sand', 'worn', 'trail']);

export interface ExtensionSite {
  building: number;
  side: 'east' | 'west';
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A clear strip beside a house where a wing could go, east side first. */
export function extensionSite(sim: Sim, b: Building): ExtensionSite | null {
  if (b.kind !== 'house' || b.w + EXTENSION_W > MAX_HOUSE_W) return null;
  const m = sim.map;
  const taken = (x: number, y: number) => sim.projects.some((p) => x >= p.x - 1 && x <= p.x + p.w && y >= p.y - 1 && y <= p.y + p.h);
  for (const side of ['east', 'west'] as const) {
    const x0 = side === 'east' ? b.x + b.w : b.x - EXTENSION_W;
    let ok = true;
    // The strip plus a one-tile margin beyond it must be open ground.
    const xs = side === 'east' ? [x0, x0 + EXTENSION_W] : [x0 - 1, x0 + EXTENSION_W - 1];
    for (let y = b.y - 1; y <= b.y + b.h && ok; y++) {
      for (let x = xs[0]; x <= xs[1] && ok; x++) {
        if (!m.inBounds(x, y)) { ok = false; break; }
        const i = m.idx(x, y);
        const inStrip = x >= x0 && x < x0 + EXTENSION_W && y >= b.y && y < b.y + b.h;
        if (inStrip && (!BUILDABLE.has(m.ground[i]) || m.cell[i] !== Cell.Open || m.room[i] >= 0)) ok = false;
        else if (!inStrip && (m.cell[i] !== Cell.Open || m.room[i] >= 0)) ok = false;
        else if (m.propsOn(x, y).some((p) => !p.resource) || taken(x, y)) ok = false;
        // Don't build over a doorstep or the path to it.
        else if (x === b.door.x && y === b.door.y) ok = false;
      }
    }
    if (ok) return { building: b.id, side, x: x0, y: b.y, w: EXTENSION_W, h: b.h };
  }
  return null;
}

/**
 * Knock through the side wall and build a bedroom wing: the home's one room (and the
 * building) simply get wider, with two more beds.
 */
export function stampExtension(sim: Sim, site: ExtensionSite, household: number): void {
  const m = sim.map;
  const b = sim.building(site.building)!;
  const home = m.rooms[sim.town.households[household].room];
  const { x: x0, y: y0, w, h } = site;
  const east = site.side === 'east';
  for (const p of m.props.filter((p) => p.x >= x0 && p.x < x0 + w && p.y >= y0 && p.y < y0 + h)) m.removeProp(p);
  // New outer walls on three sides; the old side wall becomes floor.
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const outer = y === y0 || y === y0 + h - 1 || (east ? x === x0 + w - 1 : x === x0);
      m.setCell(x, y, outer ? Cell.Wall : Cell.Open);
      if (!outer) {
        m.setGround(x, y, 'floorWood');
        m.room[m.idx(x, y)] = home.id;
      }
    }
  }
  const oldWall = east ? b.x + b.w - 1 : b.x;
  const inner = east ? oldWall - 1 : oldWall + 1;
  for (let y = y0 + 1; y < y0 + h - 1; y++) {
    // The bathroom sits in an east corner: keep its walls (and any inside wall) standing.
    const i = m.idx(inner, y);
    if (m.cell[i] !== Cell.Open || m.ground[i] === 'floorTile') continue;
    m.setCell(oldWall, y, Cell.Open);
    m.setGround(oldWall, y, 'floorWood');
    m.room[m.idx(oldWall, y)] = home.id;
  }
  // The room and building now span the wing.
  if (east) {
    home.w += w;
    b.w += w;
  } else {
    home.x -= w;
    home.w += w;
    b.x -= w;
    b.w += w;
  }
  b.extended = (b.extended ?? 0) + 1;
  // Two more beds against the new outer wall, and a rug.
  const bx = east ? x0 + w - 2 : x0 + 1;
  for (const by of [y0 + 1, y0 + 4]) {
    if (by + 1 >= y0 + h - 1) continue;
    m.addProp({ key: 'bedSingle', x: bx, y: by, w: 1, h: 2, blocks: false, cost: 6, household, building: b.id });
    m.addProp({ key: 'plant', x: 0, y: 0, w: 0, h: 0, use: 'sleep', spot: { x: bx, y: by, facing: 'down' }, blocks: false, household, building: b.id });
  }
  m.refreshAll();
}

export const TIERS = ['Village', 'Town', 'City'] as const;
/** People and buildings needed for each tier. */
export const TIER_AT: [number, number][] = [[0, 0], [30, 18], [50, 30]];

/** Promote the settlement when it's grown enough, with a Charter Day in the park. */
export function checkTier(sim: Sim): void {
  const next = sim.tier + 1;
  if (next >= TIERS.length) return;
  const [pop, blds] = TIER_AT[next];
  if (sim.agents.length < pop || sim.map.buildings.length < blds) return;
  sim.tier = next;
  sim.log(`Northwind is now a ${TIERS[next].toLowerCase()}! There's a charter day in the park`, 'event', 'good');
  sim.milestone(`Northwind became a ${TIERS[next].toLowerCase()}`);
  for (const a of sim.agents) addMemory(sim, a, 'proudTown');
  if (!sim.events.festival) {
    triggerWorldEvent(sim, 'festival');
    sim.events.festival!.name = 'Charter day';
  }
}

const paveCache = new WeakMap<object, { version: number; cells: number[] }>();
const STREETS = new Set<GroundKey>(['sidewalk', 'plaza', 'crossH', 'crossV', 'asphalt']);

/** Dirt paths and trodden trails next to pavement: where paving spreads from next. */
export function paveFrontier(sim: Sim): number[] {
  const m = sim.map;
  let c = paveCache.get(m);
  if (!c || c.version !== m.groundVersion) {
    const cells: number[] = [];
    // Farm plots, park walks and cemetery paths are part of their lots, not the street.
    const lot = new Uint8Array(m.ground.length);
    for (const b of m.buildings) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (m.inBounds(x, y)) lot[m.idx(x, y)] = 1;
    for (let i = 0; i < m.ground.length; i++) {
      if ((m.ground[i] !== 'dirt' && m.ground[i] !== 'trail') || m.room[i] >= 0 || m.cell[i] !== Cell.Open || lot[i]) continue;
      const x = m.cx(i);
      const y = m.cy(i);
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => m.inBounds(x + dx, y + dy) && STREETS.has(m.ground[m.idx(x + dx, y + dy)]))) cells.push(i);
    }
    c = { version: m.groundVersion, cells };
    paveCache.set(m, c);
  }
  return c.cells;
}
