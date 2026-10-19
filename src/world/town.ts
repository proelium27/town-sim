import type { Facing, GroundKey, PropKey } from '../assets/manifest';
import { Cell, type DrawnKey, type RoomKind, TownMap, type UseKind } from './map';

export const TOWN_W = 84;
export const TOWN_H = 54;

/** Movement cost added per ground type (base step is 1). Roads are crossable but avoided. */
export const GROUND_COST: Partial<Record<GroundKey, number>> = {
  grass: 0.35,
  dirt: 0.1,
  asphalt: 8,
  laneH: 8,
  laneV: 8,
  water: 99,
};

export interface Household {
  id: number;
  name: string;
  /** Room id of the home. */
  room: number;
  door: { x: number; y: number };
}

export interface Workplace {
  id: string;
  name: string;
  /** Rooms that count as "at work". */
  rooms: number[];
  /** Hours the place is open (24h clock). */
  open: number;
  close: number;
}

export interface Town {
  map: TownMap;
  households: Household[];
  workplaces: Workplace[];
}

/**
 * Hand-laid town: an office, a café and park to the north, homes, a market and a library to the south,
 * split by two crossing roads.
 */
export function buildTown(): Town {
  const m = new TownMap(TOWN_W, TOWN_H);
  const households: Household[] = [];

  const fill = (x: number, y: number, w: number, h: number, g: GroundKey) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (m.inBounds(xx, yy)) m.ground[m.idx(xx, yy)] = g;
  };
  const wallRect = (x: number, y: number, w: number, h: number) => {
    for (let xx = x; xx < x + w; xx++) {
      m.cell[m.idx(xx, y)] = Cell.Wall;
      m.cell[m.idx(xx, y + h - 1)] = Cell.Wall;
    }
    for (let yy = y; yy < y + h; yy++) {
      m.cell[m.idx(x, yy)] = Cell.Wall;
      m.cell[m.idx(x + w - 1, yy)] = Cell.Wall;
    }
  };
  const hwall = (x0: number, x1: number, y: number) => {
    for (let x = x0; x <= x1; x++) m.cell[m.idx(x, y)] = Cell.Wall;
  };
  const vwall = (x: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) m.cell[m.idx(x, y)] = Cell.Wall;
  };
  const door = (x: number, y: number, floor?: GroundKey) => {
    m.cell[m.idx(x, y)] = Cell.Door;
    if (floor) m.ground[m.idx(x, y)] = floor;
  };
  const room = (name: string, kind: RoomKind, x: number, y: number, w: number, h: number, floor: GroundKey, building: string) => {
    fill(x, y, w, h, floor);
    return m.addRoom({ name, kind, x, y, w, h, building });
  };
  const prop = (key: PropKey, x: number, y: number, w: number, h: number, opts: { use?: UseKind; spot?: [number, number, Facing]; blocks?: boolean; flat?: boolean; cost?: number; household?: number } = {}) =>
    m.addProp({ key, x, y, w, h, use: opts.use, spot: opts.spot && { x: opts.spot[0], y: opts.spot[1], facing: opts.spot[2] }, blocks: opts.blocks, flat: opts.flat, cost: opts.cost, household: opts.household });
  const drawn = (key: DrawnKey, x: number, y: number, w: number, h: number, opts: { use?: UseKind; spot?: [number, number, Facing]; blocks?: boolean; flat?: boolean } = {}) =>
    m.addProp({ key, drawn: true, x, y, w, h, use: opts.use, spot: opts.spot && { x: opts.spot[0], y: opts.spot[1], facing: opts.spot[2] }, blocks: opts.blocks, flat: opts.flat });
  /** A seat: walkable chair tile that is also the use spot. */
  const seat = (key: PropKey, x: number, y: number, facing: Facing, use: UseKind) => prop(key, x, y, 1, 1, { use, spot: [x, y, facing], blocks: false, cost: 2 });

  // ---------------------------------------------------------------- roads
  // Sidewalks first, then asphalt over them, so the roads cut cleanly through at the crossings.
  fill(0, 24, TOWN_W, 1, 'sidewalk');
  fill(0, 28, TOWN_W, 1, 'sidewalk');
  fill(40, 0, 1, TOWN_H, 'sidewalk');
  fill(44, 0, 1, TOWN_H, 'sidewalk');
  fill(41, 0, 3, TOWN_H, 'asphalt');
  fill(42, 0, 1, TOWN_H, 'laneV');
  fill(0, 25, TOWN_W, 3, 'asphalt');
  fill(0, 26, TOWN_W, 1, 'laneH');
  fill(40, 25, 5, 3, 'asphalt');
  for (const x of [20, 62]) fill(x, 25, 1, 3, 'crossH');
  for (const y of [14, 38]) fill(41, y, 3, 1, 'crossV');

  // ---------------------------------------------------------------- office (NW)
  const OFFICE = 'Northwind Studio';
  fill(18, 22, 4, 2, 'plaza');
  wallRect(3, 3, 36, 19);
  hwall(3, 29, 14);
  vwall(29, 3, 21);
  hwall(29, 38, 10);
  vwall(14, 14, 21);
  vwall(25, 14, 21);
  const openOffice = room('Open Office', 'office', 4, 4, 25, 10, 'floorGray', OFFICE);
  const meeting = room('Meeting Room', 'meeting', 30, 4, 8, 6, 'floorBeige', OFFICE);
  const kitchen = room('Kitchen', 'kitchen', 30, 11, 8, 10, 'floorTile', OFFICE);
  const lounge = room('Lounge', 'lounge', 4, 15, 10, 6, 'floorWood', OFFICE);
  const lobby = room('Lobby', 'lobby', 15, 15, 10, 6, 'floorBeige', OFFICE);
  const restroom = room('Restrooms', 'restroom', 26, 15, 3, 6, 'floorTile', OFFICE);
  for (const [x, y] of [[19, 14], [20, 14], [9, 14], [27, 14], [29, 12], [29, 6], [33, 10], [14, 18], [19, 21], [20, 21]]) door(x, y, 'floorBeige');

  // Desk pods: a 2x2 block of desks, four chairs around it.
  for (const px of [5, 11, 17]) {
    for (const py of [6, 10]) {
      prop('desk', px, py, 2, 1);
      prop('desk', px, py + 1, 2, 1);
      for (const dx of [0, 1]) {
        drawn('monitor', px + dx, py, 1, 1, { blocks: false });
        drawn('monitor', px + dx, py + 1, 1, 1, { blocks: false });
        seat('officeChairDown', px + dx, py - 1, 'down', 'work');
        seat('officeChairUp', px + dx, py + 2, 'up', 'work');
      }
    }
  }
  drawn('whiteboard', 23, 4, 3, 1);
  prop('bookshelf', 27, 4, 1, 1, { use: 'read', spot: [27, 5, 'up'] });
  prop('bookshelf2', 28, 4, 1, 1, { use: 'read', spot: [28, 5, 'up'] });
  prop('plant', 4, 4, 1, 1);
  prop('plant2', 28, 13, 1, 1);
  prop('plant', 22, 13, 1, 1);
  prop('rugTeal', 23, 8, 3, 1, { blocks: false, flat: true });
  seat('chairDown', 24, 7, 'down', 'sit');
  seat('chairUp', 24, 9, 'up', 'sit');

  // Meeting room
  drawn('whiteboard', 32, 4, 3, 1);
  prop('tableLong', 31, 6, 3, 2);
  prop('tableLong', 34, 6, 3, 2);
  for (let x = 31; x <= 36; x++) {
    seat('chairDown', x, 5, 'down', 'meet');
    seat('chairUp', x, 8, 'up', 'meet');
  }

  // Kitchen
  prop('counter', 30, 11, 1, 1);
  prop('sink', 31, 11, 1, 1, { use: 'snack', spot: [31, 12, 'up'] });
  prop('stove', 32, 11, 1, 1, { use: 'cook', spot: [32, 12, 'up'] });
  prop('counterDrawers', 33, 11, 1, 1);
  drawn('coffee', 34, 11, 1, 1, { use: 'coffee', spot: [34, 12, 'up'] });
  prop('drinks', 35, 11, 1, 1, { use: 'snack', spot: [35, 12, 'up'] });
  prop('counter', 36, 11, 1, 1);
  prop('vending', 37, 15, 1, 2, { use: 'snack', spot: [36, 16, 'right'] });
  for (const [tx, ty] of [[31, 15], [34, 15], [31, 18], [34, 18]]) {
    prop('tableRound', tx, ty, 1, 1);
    seat('chairRight', tx - 1, ty, 'right', 'eat');
    seat('chairLeft', tx + 1, ty, 'left', 'eat');
  }
  prop('plant2', 37, 20, 1, 1);

  // Lounge
  prop('pingPong', 6, 16, 3, 2);
  drawn('net', 7, 16, 1, 2, { blocks: false });
  m.addProp({ key: 'pingPong', x: 0, y: 0, w: 0, h: 0, use: 'play', spot: { x: 5, y: 17, facing: 'right' }, blocks: false });
  m.addProp({ key: 'pingPong', x: 0, y: 0, w: 0, h: 0, use: 'play', spot: { x: 9, y: 16, facing: 'left' }, blocks: false });
  prop('rugBig', 9, 18, 3, 2, { blocks: false, flat: true });
  prop('couchLeft', 13, 15, 1, 2, { use: 'sit', spot: [13, 16, 'left'], blocks: false, cost: 3 });
  seat('chairRight', 9, 19, 'right', 'sit');
  prop('piano', 4, 19, 2, 2, { use: 'music', spot: [6, 20, 'left'] });
  prop('plant', 4, 15, 1, 1);
  prop('bookshelf', 12, 20, 1, 1, { use: 'read', spot: [12, 19, 'down'] });

  // Lobby
  prop('desk', 18, 17, 2, 1);
  drawn('monitor', 18, 17, 1, 1, { blocks: false });
  seat('officeChairDown', 18, 16, 'down', 'work');
  prop('couchRight', 15, 19, 1, 2, { use: 'sit', spot: [15, 19, 'right'], blocks: false, cost: 3 });
  prop('plant', 15, 15, 1, 1);
  prop('plant2', 24, 15, 1, 1);
  prop('vending2', 23, 15, 1, 2, { use: 'snack', spot: [22, 16, 'right'] });
  prop('painting', 21, 15, 1, 1, { blocks: true });

  // Restrooms
  drawn('toilet', 26, 15, 1, 1, { use: 'toilet', spot: [26, 15, 'down'], blocks: false });
  drawn('toilet', 28, 15, 1, 1, { use: 'toilet', spot: [28, 15, 'down'], blocks: false });
  drawn('basin', 26, 20, 1, 1, { use: 'snack', spot: [26, 19, 'down'] });
  drawn('basin', 28, 20, 1, 1);

  // ---------------------------------------------------------------- park + café (NE)
  fill(45, 12, 19, 1, 'dirt');
  fill(54, 0, 1, 24, 'dirt');
  for (let x = 48; x <= 52; x++) for (let y = 4; y <= 6; y++) fill(x, y, 1, 1, 'water');
  for (const [x, y, k] of [[47, 2, 'treeGreen'], [57, 3, 'treeLime'], [60, 7, 'treeGreen'], [47, 9, 'treeOrange'], [58, 16, 'treeGreen'], [49, 18, 'treeLime'], [61, 20, 'treeTall'], [46, 15, 'treeTall'], [52, 21, 'treeOrange']] as [number, number, PropKey][]) {
    prop(k, x, y, 1, 1);
  }
  for (const [x, y, k] of [[56, 9, 'bushGreen'], [51, 9, 'bushLime'], [59, 13, 'bushOrange'], [46, 21, 'bushGreen']] as [number, number, PropKey][]) prop(k, x, y, 1, 1);
  prop('bench', 50, 11, 2, 1, { use: 'sit', spot: [50, 11, 'down'], blocks: false, cost: 2 });
  prop('bench', 56, 13, 2, 1, { use: 'sit', spot: [57, 13, 'up'], blocks: false, cost: 2 });
  prop('bench', 49, 7, 2, 1, { use: 'sit', spot: [50, 7, 'up'], blocks: false, cost: 2 });

  const CAFE = 'Bean There Café';
  wallRect(64, 3, 18, 12);
  const cafe = room('Café', 'cafe', 65, 4, 16, 10, 'floorWood', CAFE);
  door(72, 14, 'floorWood');
  door(73, 14, 'floorWood');
  fill(72, 15, 2, 9, 'plaza');
  for (let x = 66; x <= 71; x++) prop(x === 68 ? 'drinks' : x === 70 ? 'drinks2' : 'counter', x, 6, 1, 1);
  drawn('coffee', 67, 6, 1, 1, { use: 'coffee', spot: [67, 7, 'up'] });
  seat('officeChairDown', 68, 5, 'down', 'work');
  seat('officeChairDown', 70, 5, 'down', 'work');
  prop('stove', 66, 4, 1, 1);
  prop('oven', 67, 4, 1, 1);
  for (const [tx, ty] of [[75, 6], [78, 6], [75, 10], [78, 10], [68, 10], [71, 10]]) {
    prop('tableRound', tx, ty, 1, 1);
    seat('chairRight', tx - 1, ty, 'right', 'eat');
    seat('chairLeft', tx + 1, ty, 'left', 'eat');
  }
  prop('plant', 65, 13, 1, 1);
  prop('plant2', 80, 13, 1, 1);
  prop('rugOrange', 74, 8, 3, 1, { blocks: false, flat: true });

  // ---------------------------------------------------------------- homes (SW)
  fill(2, 40, 38, 1, 'sidewalk');
  const surnames = ['Okafor', 'Lindqvist', 'Reyes', 'Tanaka', 'Haddad', 'Novak'];
  let hh = 0;
  for (const y0 of [31, 42]) {
    for (const x0 of [3, 15, 27]) {
      const name = `${surnames[hh]} home`;
      wallRect(x0, y0, 9, 8);
      const home = room(name, 'home', x0 + 1, y0 + 1, 7, 6, 'floorWood', name);
      // Bathroom tucked into the top-right corner.
      vwall(x0 + 5, y0 + 1, y0 + 2);
      hwall(x0 + 5, x0 + 7, y0 + 3);
      door(x0 + 6, y0 + 3, 'floorTile');
      fill(x0 + 6, y0 + 1, 2, 2, 'floorTile');
      door(x0 + 4, y0, 'floorWood');
      fill(x0 + 4, y0 - 2, 1, 2, 'plaza');
      drawn('toilet', x0 + 6, y0 + 1, 1, 1, { use: 'toilet', spot: [x0 + 6, y0 + 1, 'down'], blocks: false });
      drawn('shower', x0 + 7, y0 + 1, 1, 1, { use: 'shower', spot: [x0 + 7, y0 + 1, 'down'], blocks: false });
      prop('bedDouble', x0 + 1, y0 + 1, 2, 2, { blocks: false, cost: 6, household: hh });
      m.addProp({ key: 'bedDouble', x: 0, y: 0, w: 0, h: 0, use: 'sleep', spot: { x: x0 + 1, y: y0 + 1, facing: 'down' }, blocks: false, household: hh });
      m.addProp({ key: 'bedDouble', x: 0, y: 0, w: 0, h: 0, use: 'sleep', spot: { x: x0 + 2, y: y0 + 1, facing: 'down' }, blocks: false, household: hh });
      prop('bookshelf2', x0 + 3, y0 + 1, 1, 1, { use: 'read', spot: [x0 + 3, y0 + 2, 'up'], household: hh });
      prop('counter', x0 + 1, y0 + 6, 1, 1);
      prop('stove', x0 + 2, y0 + 6, 1, 1, { use: 'cook', spot: [x0 + 2, y0 + 5, 'down'], household: hh });
      prop('tableSmall', x0 + 5, y0 + 5, 1, 1);
      seat('chairRight', x0 + 4, y0 + 5, 'right', 'eat').household = hh;
      seat('chairLeft', x0 + 6, y0 + 5, 'left', 'eat').household = hh;
      prop('couchLeft', x0 + 7, y0 + 4, 1, 2, { use: 'sit', spot: [x0 + 7, y0 + 4, 'left'], blocks: false, cost: 3, household: hh });
      prop(hh % 2 ? 'rugGreen' : 'rugOrange', x0 + 2, y0 + 3, 3, 1, { blocks: false, flat: true });
      households.push({ id: hh, name, room: home.id, door: { x: x0 + 4, y: y0 - 1 } });
      hh++;
    }
  }

  // ---------------------------------------------------------------- market + library (SE)
  const MARKET = 'Corner Market';
  wallRect(46, 30, 15, 10);
  const market = room('Corner Market', 'shop', 47, 31, 13, 8, 'floorTile', MARKET);
  door(53, 30, 'floorTile');
  fill(53, 29, 1, 1, 'plaza');
  prop('desk', 49, 32, 2, 1);
  seat('officeChairUp', 49, 33, 'up', 'work');
  for (const sy of [35, 37]) {
    for (let x = 48; x <= 58; x++) {
      if (x === 53) continue;
      prop(x % 3 === 0 ? 'drinks' : x % 3 === 1 ? 'drinks2' : 'counterDrawers', x, sy, 1, 1, { use: 'shop', spot: [x, sy - 1, 'down'] });
    }
  }
  prop('vending', 58, 31, 1, 2);
  prop('plant', 47, 31, 1, 1);

  const LIB = 'Town Library';
  wallRect(64, 30, 17, 12);
  const library = room('Town Library', 'library', 65, 31, 15, 10, 'floorBeige', LIB);
  door(72, 30, 'floorBeige');
  fill(72, 29, 1, 1, 'plaza');
  prop('desk', 66, 32, 2, 1);
  seat('officeChairUp', 66, 33, 'up', 'work');
  for (let x = 74; x <= 79; x++) prop(x % 2 ? 'bookshelf' : 'bookshelf2', x, 31, 1, 1, { use: 'read', spot: [x, 32, 'up'] });
  for (let x = 74; x <= 79; x++) prop(x % 2 ? 'bookshelf2' : 'bookshelf', x, 35, 1, 1, { use: 'read', spot: [x, 36, 'up'] });
  for (const tx of [67, 70]) {
    prop('tableLong', tx, 37, 3, 2);
    for (let dx = 0; dx < 3; dx++) {
      seat('chairDown', tx + dx, 36, 'down', 'read');
      seat('chairUp', tx + dx, 39, 'up', 'read');
    }
  }
  prop('plant', 79, 40, 1, 1);
  prop('rugGreen', 74, 39, 3, 1, { blocks: false, flat: true });

  // Parking lot with a few parked cars handled by the renderer.
  fill(46, 43, 15, 9, 'asphalt');

  // Street furniture
  for (const x of [6, 30, 50, 70]) prop('lamp', x, 22, 1, 3, { blocks: false });
  for (const x of [12, 58, 76]) prop('trash', x, 29, 1, 1);
  prop('hydrant', 39, 23, 1, 1);
  for (const [x, y] of [[1, 2], [1, 10], [1, 18], [82, 18], [82, 45], [62, 48], [36, 51], [12, 51]]) prop('treeGreen', x, y, 1, 1);

  const workplaces: Workplace[] = [
    { id: 'office', name: OFFICE, rooms: [openOffice.id, meeting.id, kitchen.id, lounge.id, lobby.id, restroom.id], open: 8, close: 18 },
    { id: 'cafe', name: CAFE, rooms: [cafe.id], open: 7, close: 19 },
    { id: 'market', name: MARKET, rooms: [market.id], open: 8, close: 20 },
    { id: 'library', name: LIB, rooms: [library.id], open: 9, close: 17 },
  ];

  // Ground cost from surface type.
  for (let i = 0; i < m.ground.length; i++) {
    const c = GROUND_COST[m.ground[i]];
    if (c) m.cost[i] += c;
    if (m.ground[i] === 'water') m.blocked[i] = 1;
  }
  return { map: m, households, workplaces };
}
