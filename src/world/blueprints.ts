import type { Bill } from '../sim/defs';
import type { Building, BuildingKind, TownMap } from './map';
import { Stamper } from './stamp';

export interface Blueprint {
  kind: BuildingKind;
  /** Label used when someone proposes it ("a new home"). */
  noun: string;
  w: number;
  h: number;
  /** Materials the build consumes. */
  cost: Bill;
  /** What it takes instead once the town has a workshop: refined materials, and furniture for homes. */
  refined?: Bill;
  /** Coins the treasury pays to start it (tools, nails, the things the town can't make). */
  coins: number;
  /** Builder-minutes of construction. */
  work: number;
  /** Door column in local coordinates (door sits on the top wall, or bottom when flipped). */
  doorX: number;
  /** Outdoor lots (farms, parks) have no walls. */
  outdoor: boolean;
  stamp: (m: TownMap, x: number, y: number, doorTop: boolean, name: string, household?: number) => Building;
}

function begin(m: TownMap, kind: BuildingKind, name: string, x: number, y: number, w: number, h: number, doorX: number, doorTop: boolean, time: number): [Stamper, Building] {
  const door = doorTop ? { x: x + doorX, y: y - 1 } : { x: x + doorX, y: y + h };
  const b = m.addBuilding({ kind, name, x, y, w, h, rooms: [], door, built: time });
  return [new Stamper(m, x, y, h, !doorTop, b.id), b];
}

/** Two-adult home; the wider variant fits a second child's bed. */
export function stampHouse(m: TownMap, x: number, y: number, doorTop: boolean, name: string, household: number, wide: boolean, time = 0): Building {
  const W = wide ? 11 : 9;
  const H = 8;
  const [s, b] = begin(m, 'house', name, x, y, W, H, 4, doorTop, time);
  s.wallRect(0, 0, W, H);
  const home = s.room(name, 'home', 1, 1, W - 2, H - 2, 'floorWood', name);
  b.rooms.push(home.id);
  s.vwall(W - 4, 1, 2);
  s.hwall(W - 4, W - 2, 3);
  s.door(W - 3, 3, 'floorTile');
  s.fill(W - 3, 1, 2, 2, 'floorTile');
  s.door(4, 0, 'floorWood');
  const h = household;
  s.drawn('toilet', W - 3, 1, 1, 1, { use: 'toilet', spot: [W - 3, 1, 'down'], blocks: false, household: h });
  s.drawn('shower', W - 2, 1, 1, 1, { use: 'shower', spot: [W - 2, 1, 'down'], blocks: false, household: h });
  s.prop('bedDouble', 1, 1, 2, 2, { blocks: false, cost: 6, household: h });
  s.spot('sleep', 1, 1, 'down', h);
  s.spot('sleep', 2, 1, 'down', h);
  s.prop('bedSingle', 1, 3, 1, 2, { blocks: false, cost: 6, household: h });
  s.spot('sleep', 1, 3, 'down', h);
  if (wide) {
    s.prop('bedSingle', 5, 1, 1, 2, { blocks: false, cost: 6, household: h });
    s.spot('sleep', 5, 1, 'down', h);
  }
  s.prop('bookshelf2', 3, 1, 1, 1, { use: 'read', spot: [3, 2, 'up'], household: h });
  s.prop('counter', 1, 6, 1, 1);
  s.prop('stove', 2, 6, 1, 1, { use: 'cook', spot: [2, 5, 'down'], household: h });
  s.prop('tableSmall', W - 4, 5, 1, 1);
  s.seat('chairRight', W - 5, 5, 'right', 'eat', h);
  s.seat('chairLeft', W - 3, 5, 'left', 'eat', h);
  s.prop('couchLeft', W - 2, 4, 1, 2, { use: 'sit', spot: [W - 2, 4, 'left'], blocks: false, cost: 3, household: h });
  s.prop(h % 2 ? 'rugGreen' : 'rugOrange', 2, 3, 3, 1, { blocks: false, flat: true });
  return b;
}

function stampFarm(m: TownMap, x: number, y: number, doorTop: boolean, name: string, time = 0): Building {
  const [s, b] = begin(m, 'farm', name, x, y, 10, 7, 4, doorTop, time);
  s.fill(0, 0, 10, 7, 'dirt');
  for (let dy = 1; dy <= 5; dy++) {
    for (let dx = 1; dx <= 8; dx++) {
      s.fill(dx, dy, 1, 1, 'field');
      const p = s.drawn('crop0', dx, dy, 1, 1, { use: 'farm', spot: [dx, dy, 'down'], blocks: false, flat: true, cost: 0.6 });
      p.growth = 0.2 + ((dx * 7 + dy * 13) % 10) / 20;
    }
  }
  s.drawn('crate', 9, 0, 1, 1);
  return b;
}

function stampStorehouse(m: TownMap, x: number, y: number, doorTop: boolean, name: string, time = 0): Building {
  const [s, b] = begin(m, 'storehouse', name, x, y, 7, 6, 3, doorTop, time);
  s.wallRect(0, 0, 7, 6);
  const r = s.room(name, 'storehouse', 1, 1, 5, 4, 'floorTile', name);
  b.rooms.push(r.id);
  s.door(3, 0, 'floorTile');
  s.drawn('logs', 1, 3, 2, 1);
  s.drawn('stones', 4, 3, 2, 1);
  s.drawn('crate', 1, 4, 1, 1);
  s.drawn('crate', 5, 4, 1, 1);
  s.drawn('crate', 2, 4, 1, 1);
  for (const dx of [2, 3, 4]) s.spot('deposit', dx, 2, 'down');
  return b;
}

function stampSchool(m: TownMap, x: number, y: number, doorTop: boolean, name: string, time = 0): Building {
  const [s, b] = begin(m, 'school', name, x, y, 11, 8, 1, doorTop, time);
  s.wallRect(0, 0, 11, 8);
  const r = s.room(name, 'school', 1, 1, 9, 6, 'floorBeige', name);
  b.rooms.push(r.id);
  s.door(1, 0, 'floorBeige');
  s.drawn('chalkboard', 4, 1, 3, 1);
  s.seat('officeChairDown', 5, 2, 'down', 'teach');
  for (const dy of [3, 5]) {
    for (const dx of [2, 4, 6, 8]) {
      s.drawn('deskKid', dx, dy, 1, 1);
      s.seat('chairUp', dx, dy + 1, 'up', 'learn');
    }
  }
  s.prop('bookshelf', 9, 1, 1, 1, { use: 'read', spot: [9, 2, 'up'] });
  s.prop('plant', 1, 6, 1, 1);
  return b;
}

function stampDiner(m: TownMap, x: number, y: number, doorTop: boolean, name: string, time = 0): Building {
  const [s, b] = begin(m, 'cafe', name, x, y, 11, 8, 9, doorTop, time);
  s.wallRect(0, 0, 11, 8);
  const r = s.room(name, 'cafe', 1, 1, 9, 6, 'floorWood', name);
  b.rooms.push(r.id);
  s.door(9, 0, 'floorWood');
  s.prop('stove', 1, 1, 1, 1);
  s.prop('oven', 2, 1, 1, 1);
  s.seat('officeChairDown', 3, 2, 'down', 'work');
  for (let dx = 1; dx <= 5; dx++) s.prop(dx === 4 ? 'drinks' : 'counter', dx, 3, 1, 1);
  s.drawn('coffee', 2, 3, 1, 1, { use: 'coffee', spot: [2, 4, 'up'] });
  for (const [tx, ty] of [[7, 3], [7, 6], [4, 6]]) {
    s.prop('tableRound', tx, ty, 1, 1);
    s.seat('chairRight', tx - 1, ty, 'right', 'eat');
    s.seat('chairLeft', tx + 1, ty, 'left', 'eat');
  }
  s.prop('plant2', 9, 6, 1, 1);
  return b;
}

function stampPark(m: TownMap, x: number, y: number, doorTop: boolean, name: string, time = 0): Building {
  const [s, b] = begin(m, 'park', name, x, y, 8, 8, 3, doorTop, time);
  s.fill(0, 0, 8, 8, 'grass');
  s.fill(3, 0, 2, 8, 'dirt');
  s.fill(0, 3, 8, 2, 'dirt');
  s.prop('treeLime', 0, 0, 1, 1);
  s.prop('treeGreen', 7, 0, 1, 1);
  s.prop('treeOrange', 0, 7, 1, 1);
  s.prop('treeGreen', 7, 7, 1, 1);
  s.prop('bushGreen', 1, 6, 1, 1);
  s.prop('bushLime', 6, 1, 1, 1);
  s.prop('bench', 1, 2, 2, 1, { use: 'sit', spot: [1, 2, 'down'], blocks: false, cost: 2 });
  s.prop('bench', 5, 5, 2, 1, { use: 'sit', spot: [6, 5, 'up'], blocks: false, cost: 2 });
  s.spot('play', 2, 5, 'right');
  s.spot('play', 5, 2, 'left');
  return b;
}

function stampWorkshop(m: TownMap, x: number, y: number, doorTop: boolean, name: string, time = 0): Building {
  const [s, b] = begin(m, 'workshop', name, x, y, 11, 8, 5, doorTop, time);
  s.wallRect(0, 0, 11, 8);
  const r = s.room(name, 'workshop', 1, 1, 9, 6, 'floorGray', name);
  b.rooms.push(r.id);
  s.door(5, 0, 'floorGray');
  // Stations along the back wall, each worked from the tile in front.
  s.drawn('sawbench', 1, 6, 2, 1, { use: 'craft', spot: [1, 5, 'down'] });
  s.drawn('workbench', 4, 6, 2, 1, { use: 'craft', spot: [4, 5, 'down'] });
  s.drawn('workbench', 6, 6, 2, 1, { use: 'craft', spot: [7, 5, 'down'] });
  s.drawn('kiln', 9, 6, 1, 1, { use: 'craft', spot: [9, 5, 'down'] });
  s.drawn('logs', 1, 1, 2, 1);
  s.drawn('stones', 8, 1, 2, 1);
  s.drawn('crate', 3, 1, 1, 1);
  return b;
}

function stampClinic(m: TownMap, x: number, y: number, doorTop: boolean, name: string, time = 0): Building {
  const [s, b] = begin(m, 'clinic', name, x, y, 9, 7, 4, doorTop, time);
  s.wallRect(0, 0, 9, 7);
  const r = s.room(name, 'clinic', 1, 1, 7, 5, 'floorTile', name);
  b.rooms.push(r.id);
  s.door(4, 0, 'floorTile');
  // The doctor's desk by the door, three beds along the back.
  s.prop('desk', 1, 1, 2, 1);
  s.seat('officeChairDown', 2, 2, 'up', 'work');
  s.prop('bookshelf', 7, 1, 1, 1);
  for (const dx of [1, 3, 5]) {
    s.prop('bedSingle', dx, 4, 1, 2, { blocks: false, cost: 6 });
    s.spot('rest', dx, 4, 'down');
  }
  return b;
}

function stampCemetery(m: TownMap, x: number, y: number, doorTop: boolean, name: string, time = 0): Building {
  const [s, b] = begin(m, 'cemetery', name, x, y, 9, 7, 4, doorTop, time);
  s.fill(0, 0, 9, 7, 'grass');
  s.fill(4, 0, 1, 7, 'dirt');
  s.prop('treeTall', 0, 0, 1, 1);
  s.prop('treeTall', 8, 0, 1, 1);
  s.prop('bushGreen', 0, 6, 1, 1);
  s.prop('bushGreen', 8, 6, 1, 1);
  s.prop('bench', 5, 6, 2, 1, { use: 'sit', spot: [5, 6, 'up'], blocks: false, cost: 2 });
  return b;
}

/** Headstone tiles in a cemetery, in burial order: three rows either side of the center path. */
export function graveSlots(b: Building): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const dy of [1, 3, 5]) for (const dx of [3, 5, 2, 6, 1, 7]) out.push({ x: b.x + dx, y: b.y + dy });
  return out;
}

export const BLUEPRINTS: Record<'house' | 'farm' | 'storehouse' | 'school' | 'diner' | 'park' | 'cemetery' | 'workshop' | 'clinic' | 'extension', Blueprint> = {
  house: {
    kind: 'house', noun: 'a new home', coins: 40, w: 11, h: 8, cost: { wood: 40, stone: 20 }, refined: { wood: 16, stone: 10, planks: 16, bricks: 8, furniture: 2 }, work: 300, doorX: 4, outdoor: false,
    stamp: (m, x, y, top, name, hh) => stampHouse(m, x, y, top, name, hh ?? 0, true),
  },
  farm: { kind: 'farm', noun: 'a farm', coins: 20, w: 10, h: 7, cost: { wood: 10, stone: 0 }, work: 140, doorX: 4, outdoor: true, stamp: (m, x, y, top, name) => stampFarm(m, x, y, top, name) },
  storehouse: { kind: 'storehouse', noun: 'a storehouse', coins: 30, w: 7, h: 6, cost: { wood: 25, stone: 10 }, refined: { wood: 10, planks: 12, bricks: 6 }, work: 200, doorX: 3, outdoor: false, stamp: (m, x, y, top, name) => stampStorehouse(m, x, y, top, name) },
  school: { kind: 'school', noun: 'a schoolhouse', coins: 90, w: 11, h: 8, cost: { wood: 40, stone: 30 }, refined: { wood: 12, stone: 10, planks: 20, bricks: 16, furniture: 2 }, work: 420, doorX: 1, outdoor: false, stamp: (m, x, y, top, name) => stampSchool(m, x, y, top, name) },
  diner: { kind: 'cafe', noun: 'a diner', coins: 80, w: 11, h: 8, cost: { wood: 35, stone: 25 }, refined: { wood: 10, stone: 8, planks: 18, bricks: 14, furniture: 2 }, work: 380, doorX: 9, outdoor: false, stamp: (m, x, y, top, name) => stampDiner(m, x, y, top, name) },
  park: { kind: 'park', noun: 'a little park', coins: 25, w: 8, h: 8, cost: { wood: 6, stone: 8 }, work: 100, doorX: 3, outdoor: true, stamp: (m, x, y, top, name) => stampPark(m, x, y, top, name) },
  workshop: { kind: 'workshop', noun: 'a workshop', coins: 70, w: 11, h: 8, cost: { wood: 35, stone: 25 }, work: 320, doorX: 5, outdoor: false, stamp: (m, x, y, top, name) => stampWorkshop(m, x, y, top, name) },
  clinic: { kind: 'clinic', noun: 'a clinic', coins: 60, w: 9, h: 7, cost: { wood: 25, stone: 20 }, refined: { wood: 8, planks: 12, bricks: 12, furniture: 1 }, work: 260, doorX: 4, outdoor: false, stamp: (m, x, y, top, name) => stampClinic(m, x, y, top, name) },
  // A bedroom wing on an existing house; its footprint comes from the house, not from a site search.
  extension: {
    kind: 'house', noun: 'a new wing', coins: 20, w: 4, h: 8, cost: { wood: 14, stone: 6 }, refined: { wood: 4, planks: 8, bricks: 4, furniture: 1 }, work: 140, doorX: 0, outdoor: false,
    stamp: () => {
      throw new Error('Extensions are built by stampExtension');
    },
  },
  cemetery: { kind: 'cemetery', noun: 'a cemetery', coins: 15, w: 9, h: 7, cost: { wood: 4, stone: 10 }, work: 100, doorX: 4, outdoor: true, stamp: (m, x, y, top, name) => stampCemetery(m, x, y, top, name) },
};

export type BlueprintKey = keyof typeof BLUEPRINTS;

export { stampFarm, stampStorehouse };
