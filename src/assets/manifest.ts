/**
 * Every pixel-art frame the game uses, addressed by sheet + cell. All packs are Kenney (CC0), 16px tiles.
 * Swapping in another 16px pack later only means editing this file.
 */
export const TILE = 16;

export type SheetKey = 'city' | 'urban' | 'indoors';

export interface SheetDef {
  url: string;
  /** Gap between tiles in the source image (Kenney "transparent" sheets use 1px). */
  spacing: number;
}

export const SHEETS: Record<SheetKey, SheetDef> = {
  city: { url: 'assets/kenney/city/sheet.png', spacing: 0 },
  urban: { url: 'assets/kenney/urban/sheet.png', spacing: 0 },
  indoors: { url: 'assets/kenney/indoors/sheet.png', spacing: 1 },
};

/** A frame: one or more tiles (w x h) starting at a cell, or an explicit pixel rect. */
export interface FrameRef {
  sheet: SheetKey;
  col: number;
  row: number;
  w?: number;
  h?: number;
  /** Explicit pixel rect, for sprites that don't sit on the tile grid (cars, tall trees). */
  px?: { x: number; y: number; w: number; h: number };
}

const c = (col: number, row: number, w = 1, h = 1): FrameRef => ({ sheet: 'city', col, row, w, h });
const u = (col: number, row: number, w = 1, h = 1): FrameRef => ({ sheet: 'urban', col, row, w, h });
const i = (col: number, row: number, w = 1, h = 1): FrameRef => ({ sheet: 'indoors', col, row, w, h });
const cpx = (x: number, y: number, w: number, h: number): FrameRef => ({ sheet: 'city', col: 0, row: 0, px: { x, y, w, h } });

// ------------------------------------------------------------------ ground tiles

export const GROUND = {
  grass: [c(0, 24), c(1, 24)],
  /** Grass trampled by feet; painted with bare patches on top of the grass tile. */
  worn: [c(0, 24), c(1, 24)],
  /** A desire path worn down to earth; painted with grass creeping in at the edges. */
  trail: [c(4, 24), c(5, 24)],
  dirt: [c(4, 24), c(5, 24)],
  sand: [c(6, 24), c(7, 24)],
  sidewalk: [c(1, 20), c(2, 20), c(1, 19)],
  sidewalkBlue: [c(7, 20), c(8, 20)],
  plaza: [c(4, 20), c(5, 20)],
  asphalt: [c(11, 19), c(14, 19), c(10, 23)],
  laneH: [c(13, 19)],
  laneV: [c(13, 20)],
  crossH: [c(12, 22)],
  crossV: [c(9, 22)],
  floorGray: [c(7, 19), c(8, 19), c(7, 20)],
  floorBeige: [c(27, 0), c(26, 1)],
  floorWood: [c(21, 4), c(22, 4), c(23, 4)],
  floorTile: [c(1, 20), c(2, 20)],
  water: [u(9, 7)],
  field: [c(5, 24)],
} satisfies Record<string, FrameRef[]>;

export type GroundKey = keyof typeof GROUND;

// ------------------------------------------------------------------ props & furniture

export const PROPS = {
  desk: i(4, 3, 2, 1),
  tableLong: i(0, 0, 3, 2),
  tableRound: i(7, 0),
  tableSmall: i(5, 2),
  chairDown: i(0, 2),
  chairUp: i(1, 2),
  chairRight: i(2, 2),
  chairLeft: i(3, 2),
  officeChairDown: i(0, 8),
  officeChairUp: i(1, 8),
  officeChairRight: i(2, 8),
  officeChairLeft: i(3, 8),
  bedDouble: i(14, 6, 2, 2),
  bedSingle: i(10, 6, 1, 2),
  counter: i(1, 12),
  counterDrawers: i(4, 12),
  sink: i(8, 12),
  drinks: i(5, 12),
  drinks2: i(6, 12),
  stove: i(14, 14),
  oven: i(15, 14),
  couchLeft: i(25, 11, 1, 2),
  couchRight: i(26, 11, 1, 2),
  sofaBig: i(23, 11, 2, 3),
  rugTeal: i(16, 14, 3, 1),
  rugOrange: i(16, 15, 3, 1),
  rugGreen: i(16, 16, 3, 1),
  rugBig: i(16, 8, 3, 2),
  pingPong: i(7, 9, 3, 2),
  piano: i(23, 8, 2, 2),
  plant: i(16, 0),
  plant2: i(17, 0),
  bookshelf: i(19, 17),
  bookshelf2: i(20, 17),
  painting: i(19, 15),
  painting2: i(20, 15),
  mirror: i(22, 14, 1, 2),
  vending: c(29, 7, 1, 2),
  vending2: c(27, 7, 1, 2),
  atm: c(28, 8),
  bench: c(15, 15, 2, 1),
  benchV: c(16, 15, 1, 2),
  lamp: c(0, 16, 1, 3),
  trash: c(15, 13),
  hydrant: c(15, 14),
  bushGreen: c(33, 13),
  bushLime: c(31, 13),
  bushOrange: c(32, 13),
  treeGreen: cpx(530, 163, 12, 45),
  treeLime: cpx(498, 163, 12, 45),
  treeOrange: cpx(514, 163, 12, 45),
  treeTall: cpx(579, 162, 10, 46),
  awningGreen: c(24, 9, 4, 1),
  awningOrange: c(28, 9, 4, 1),
} satisfies Record<string, FrameRef>;

export type PropKey = keyof typeof PROPS;

// ------------------------------------------------------------------ building exteriors (3/4 view)

/** Wall, window, door, awning and roof pieces for building exteriors, from the Modern City sheet. */
export const EXTERIOR = {
  wallBrick: c(2, 5),
  wallStone: c(5, 5),
  wallSand: c(9, 5),
  wallGlass: c(14, 9),
  wallGlass2: c(13, 9),
  wallPlank: c(21, 14),
  winWood: c(25, 15),
  winWood4: c(26, 16),
  winSteel: c(25, 18),
  winSteel4: c(26, 19),
  winArchTop: c(28, 18),
  winArchBottom: c(28, 19),
  doorBrown: c(20, 26),
  doorGreen: c(23, 26),
  doorOrange: c(26, 26),
  doorGlassL: c(23, 23),
  doorGlassR: c(24, 23),
  awningGreen: c(25, 12),
  awningOrange: c(29, 12),
  roofFlat: c(13, 0),
  roofFlat2: c(12, 1),
  acUnit: c(27, 14),
  vent: c(25, 14),
  signCafe: cpx(565, 116, 21, 8),
  signRetail: cpx(563, 131, 26, 9),
} satisfies Record<string, FrameRef>;

// ------------------------------------------------------------------ vehicles

/** Side views are 36x24, top views 22x29. */
export const CARS = {
  green: { side: cpx(503, 264, 36, 24), sideFlip: cpx(549, 264, 36, 24), down: cpx(501, 290, 22, 29), up: cpx(533, 290, 22, 29) },
  gray: { side: cpx(503, 328, 36, 24), sideFlip: cpx(549, 328, 36, 24), down: cpx(501, 354, 22, 29), up: cpx(533, 354, 22, 29) },
  orange: { side: cpx(503, 392, 36, 24), sideFlip: cpx(549, 392, 36, 24), down: cpx(501, 418, 22, 29), up: cpx(533, 418, 22, 29) },
} as const;

export type CarColor = keyof typeof CARS;

// ------------------------------------------------------------------ characters

/**
 * RPG Urban characters: 6 bodies, each 3 rows (stand, step A, step B) x 4 facing columns.
 * Columns 23..26 on the urban sheet.
 */
export const CHARACTER_BASES = 6;
export const CHARACTER_COL0 = 23;
export type Facing = 'left' | 'down' | 'up' | 'right';
export const FACING_COL: Record<Facing, number> = { left: 0, down: 1, up: 2, right: 3 };

export function characterFrame(base: number, facing: Facing, step: 0 | 1 | 2): FrameRef {
  return u(CHARACTER_COL0 + FACING_COL[facing], base * 3 + step);
}
