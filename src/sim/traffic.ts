import type { CarColor } from '../assets/manifest';
import { trade } from './market';
import { addMemory, say, think } from './social';
import type { Sim } from './sim';

export type Lane = 'E' | 'W' | 'N' | 'S';

export interface Car {
  id: number;
  color: CarColor;
  lane: Lane;
  /** Center position in tile units. */
  x: number;
  y: number;
  px: number;
  py: number;
  speed: number;
  /** A trader's cart: stops at the market to trade, then drives on. */
  trader?: boolean;
  stopUntil?: number;
  traded?: boolean;
}

/** Where a trader's cart pulls up, beside the market. */
const TRADER_STOP = 54;

/** Lane geometry: which row/column the lane runs along and the travel direction. */
const LANES: Record<Lane, { axis: 'x' | 'y'; fixed: number; dir: 1 | -1 }> = {
  W: { axis: 'x', fixed: 25.5, dir: -1 },
  E: { axis: 'x', fixed: 27.5, dir: 1 },
  S: { axis: 'y', fixed: 41.5, dir: 1 },
  N: { axis: 'y', fixed: 43.5, dir: -1 },
};
const CRUISE = 7;
const COLORS: CarColor[] = ['green', 'gray', 'orange'];

function along(c: Car): number {
  return LANES[c.lane].axis === 'x' ? c.x : c.y;
}

/** True when a point sits in this car's lane band within a few tiles ahead of (or under) it. */
export function laneThreat(c: Car, px: number, py: number, reach = 4.5): boolean {
  const L = LANES[c.lane];
  const lat = L.axis === 'x' ? Math.abs(py - L.fixed) : Math.abs(px - L.fixed);
  const ahead = ((L.axis === 'x' ? px : py) - along(c)) * L.dir;
  return lat < 1.2 && ahead > -1.3 && ahead < reach;
}

function spawn(sim: Sim, lane: Lane): void {
  const L = LANES[lane];
  const len = L.axis === 'x' ? sim.map.w : sim.map.h;
  const pos = L.dir > 0 ? -2 : len + 2;
  // Don't stack a new car on one that hasn't cleared the entry.
  if (sim.cars.some((c) => c.lane === lane && Math.abs(along(c) - pos) < 4)) return;
  const x = L.axis === 'x' ? pos : L.fixed;
  const y = L.axis === 'x' ? L.fixed : pos;
  sim.cars.push({ id: sim.nextCarId++, color: sim.rng.pick(COLORS), lane, x, y, px: x, py: y, speed: CRUISE });
}

/** A trader's cart sets off down the east-bound lane toward the market. */
export function spawnTrader(sim: Sim): void {
  if (sim.cars.some((c) => c.trader)) return;
  const L = LANES.E;
  sim.cars.push({ id: sim.nextCarId++, color: 'orange', lane: 'E', x: -2, y: L.fixed, px: -2, py: L.fixed, speed: CRUISE, trader: true });
  sim.log("A trader's cart is coming up the road", 'event', 'neutral');
}

export function tickTraffic(sim: Sim, dt: number): void {
  const h = sim.hour;
  const rush = (h > 7.5 && h < 9.5) || (h > 16.5 && h < 18.5);
  const night = h < 6 || h > 22;
  const rate = (rush ? 0.35 : night ? 0.04 : 0.14) * dt;
  for (const lane of ['E', 'W', 'N', 'S'] as Lane[]) if (sim.rng.chance(rate)) spawn(sim, lane);

  for (const c of sim.cars) {
    c.px = c.x;
    c.py = c.y;
    const L = LANES[c.lane];
    const pos = along(c);
    // Brake for the car ahead and for anyone standing in the lane just ahead.
    let target = CRUISE;
    for (const o of sim.cars) {
      if (o === c || o.lane !== c.lane) continue;
      // A trader pulled over at the curb is out of the way.
      if (o.stopUntil !== undefined && sim.time < o.stopUntil) continue;
      const gap = (along(o) - pos) * L.dir;
      if (gap > 0 && gap < 3.2) target = Math.min(target, gap < 2.6 ? 0 : o.speed);
    }
    for (const a of sim.agents) {
      const ax = a.x + 0.5;
      const ay = a.y + 0.5;
      const lat = L.axis === 'x' ? Math.abs(ay - L.fixed) : Math.abs(ax - L.fixed);
      const ahead = ((L.axis === 'x' ? ax : ay) - pos) * L.dir;
      if (lat < 1 && ahead > 0 && ahead < 4) target = 0;
      // A near miss: someone ended up right in front of a car that was still moving fast.
      if (lat < 0.8 && ahead > -0.2 && ahead < 1 && c.speed > 4.5 && sim.time - a.lastScare > 240) {
        a.lastScare = sim.time;
        addMemory(sim, a, 'commuteScare');
        say(sim, a, '!!', 'bad', 4);
        think(sim, a, 'That car came out of nowhere!', 'bad');
        sim.log(`${a.name.split(' ')[0]} nearly got hit by a car`, 'event', 'bad', a);
      }
    }
    if (c.trader) {
      // Pull up at the market, trade for an hour or so, then carry on.
      if (!c.traded && Math.abs(pos - TRADER_STOP) < 2) target = Math.min(target, Math.abs(pos - TRADER_STOP) * 3);
      if (!c.traded && Math.abs(pos - TRADER_STOP) < 0.15 && c.speed < 0.5) {
        c.traded = true;
        c.stopUntil = sim.time + 75;
        sim.log(`The trader stopped at the market: ${trade(sim)}`, 'event', 'good');
      }
      const parked = c.stopUntil !== undefined && sim.time < c.stopUntil;
      if (parked) target = 0;
      // Pull in to the curb while trading, back out after.
      const curb = L.fixed + (parked ? 0.9 : 0);
      c.y += (curb - c.y) * Math.min(1, dt * 3);
    }
    c.speed += Math.sign(target - c.speed) * Math.min(Math.abs(target - c.speed), 20 * dt);
    const d = c.speed * dt * L.dir;
    if (L.axis === 'x') c.x += d;
    else c.y += d;
  }
  const W = sim.map.w;
  const H = sim.map.h;
  sim.cars = sim.cars.filter((c) => c.x > -4 && c.x < W + 4 && c.y > -4 && c.y < H + 4);
}
