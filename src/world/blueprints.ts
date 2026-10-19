import type { Building, BuildingKind, TownMap } from './map';
import { Stamper } from './stamp';

export interface Blueprint {
  kind: BuildingKind;
  /** Label used when someone proposes it ("a new home"). */
  noun: string;
  w: number;
  h: number;
  wood: number;
  stone: number;
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

export const BLUEPRINTS: Record<'house' | 'farm' | 'storehouse' | 'school' | 'diner' | 'park', Blueprint> = {
  house: {
    kind: 'house', noun: 'a new home', w: 11, h: 8, wood: 40, stone: 20, work: 360, doorX: 4, outdoor: false,
    stamp: (m, x, y, top, name, hh) => stampHouse(m, x, y, top, name, hh ?? 0, true),
  },
  farm: { kind: 'farm', noun: 'a farm', w: 10, h: 7, wood: 10, stone: 0, work: 140, doorX: 4, outdoor: true, stamp: (m, x, y, top, name) => stampFarm(m, x, y, top, name) },
  storehouse: { kind: 'storehouse', noun: 'a storehouse', w: 7, h: 6, wood: 25, stone: 10, work: 200, doorX: 3, outdoor: false, stamp: (m, x, y, top, name) => stampStorehouse(m, x, y, top, name) },
  school: { kind: 'school', noun: 'a schoolhouse', w: 11, h: 8, wood: 40, stone: 30, work: 420, doorX: 1, outdoor: false, stamp: (m, x, y, top, name) => stampSchool(m, x, y, top, name) },
  diner: { kind: 'cafe', noun: 'a diner', w: 11, h: 8, wood: 35, stone: 25, work: 380, doorX: 9, outdoor: false, stamp: (m, x, y, top, name) => stampDiner(m, x, y, top, name) },
  park: { kind: 'park', noun: 'a little park', w: 8, h: 8, wood: 6, stone: 8, work: 100, doorX: 3, outdoor: true, stamp: (m, x, y, top, name) => stampPark(m, x, y, top, name) },
};

export type BlueprintKey = keyof typeof BLUEPRINTS;

export { stampFarm, stampStorehouse };
