import type { BlueprintKey } from '../world/blueprints';
import { LAST } from './agents';
import { Rng } from './rng';

/**
 * What makes one town grow up differently from the next, rolled once from the seed.
 *
 * Real towns differ because of where they sit (water, woods, hills, soil), what they were founded to do
 * (mill towns, quarry towns, farm villages, market towns), the values their founding families brought and
 * passed down (big families, civic pride, how they treat strangers), the shape they settle into
 * (huddled around a green, scattered farmsteads, a ribbon along the road), and plain historical accident:
 * the decision a meeting happened to make one evening, the plot someone happened to pick.
 *
 * Every dial is tuned so that 0.5 (or an empty table) is how the town behaved before characters existed;
 * CLASSIC is that town, and old saves load as it.
 */
export type Setting = 'lakeside' | 'woodland' | 'highland' | 'meadow';
export type Trade = 'farming' | 'timber' | 'quarry' | 'market';
/** Clustered: huddled round the center. Scattered: homesteads with elbow room. Roadside: a ribbon along the main roads. */
export type Layout = 'clustered' | 'scattered' | 'roadside';

export interface Lake {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface Character {
  name: string;
  setting: Setting;
  trade: Trade;
  layout: Layout;
  /** Family-mindedness: birth rate, family size, grown kids settling near their parents. */
  kin: number;
  /** Civic pride: appetite for schools, parks, clinics and diners. */
  civic: number;
  /** Welcome to strangers: how often newcomers come, and whether the town builds homes ahead of them. */
  openness: number;
  /** How much chance sways town meetings and the choice of plot. 0 is the old, fully predictable town. */
  whim: number;
  /** Which way new homes lean from the center (radians), and how far (tiles). */
  heading: number;
  lean: number;
  /** Which side of town the farm belt spreads toward. */
  farmHeading: number;
  /** Crop growth multiplier: the soil. */
  fertility: number;
  /** Wood per tree and stone per rock. */
  timber: number;
  stone: number;
  /** Tries per half hour for the forest to creep back. */
  regrowth: number;
  /** Wilderness density: [noise threshold, chance] for trees and for rocks. */
  forest: [number, number];
  rocks: [number, number];
  lakes: Lake[];
  /** The six founding families. */
  founders: string[];
  /** Planner weight per blueprint, from the trade and the town's values (missing: 1). */
  bias: Partial<Record<BlueprintKey, number>>;
  /** Town size at which a workshop is first proposed, and people per diner and per park. */
  workshopAt: number;
  dinerEvery: number;
  parkEvery: number;
  /** Extra starting stores and coin for what the town was founded on. */
  start: { wood?: number; stone?: number; food?: number; treasury?: number };
  farmNames: string[];
  dinerNames: string[];
  parkNames: string[];
  /** The original Northwind, as it was before towns had characters. */
  classic?: boolean;
}

export const CLASSIC: Character = {
  name: 'Northwind',
  setting: 'lakeside',
  trade: 'farming',
  layout: 'clustered',
  kin: 0.5,
  civic: 0.5,
  openness: 0.5,
  whim: 0,
  heading: 0,
  lean: 0,
  farmHeading: 0,
  fertility: 1,
  timber: 6,
  stone: 8,
  regrowth: 6,
  forest: [0.52, 0.55],
  rocks: [0.66, 0.4],
  lakes: [{ x: 108, y: 72, rx: 10, ry: 5.5 }],
  founders: ['Okafor', 'Lindqvist', 'Reyes', 'Tanaka', 'Haddad', 'Novak'],
  bias: {},
  workshopAt: 22,
  dinerEvery: 24,
  parkEvery: 20,
  start: {},
  farmNames: ['Sunny Farm', 'River Farm', 'Oak Farm', 'Clover Farm', 'Barley Farm', 'Willow Farm'],
  dinerNames: ['Corner Diner', 'Hilltop Diner', 'Lakeside Diner'],
  parkNames: ['Maple Park', 'Sparrow Park', 'Fern Park'],
  classic: true,
};

interface SettingDef {
  prefixes: string[];
  suffixes: string[];
  trades: Partial<Record<Trade, number>>;
  layouts: Record<Layout, number>;
  fertility: [number, number];
  timber: number;
  stone: number;
  regrowth: number;
  forest: [number, number];
  rocks: [number, number];
  /** Chance of a big lake, and of a smaller pond besides. */
  lake: number;
  pond: number;
  farms: string[];
  diners: string[];
  parks: string[];
}

const SETTINGS: Record<Setting, SettingDef> = {
  lakeside: {
    prefixes: ['Ash', 'Wil', 'Fen', 'Heron', 'Still', 'Reed', 'Swan', 'Elm'],
    suffixes: ['mere', 'water', 'haven', 'wick', 'port'],
    trades: { farming: 2, market: 2, timber: 1 },
    layouts: { clustered: 1, scattered: 1, roadside: 2 },
    fertility: [1.0, 1.2],
    timber: 6, stone: 8, regrowth: 6,
    forest: [0.52, 0.55], rocks: [0.68, 0.4],
    lake: 1, pond: 0.5,
    farms: ['Reed', 'Mill Pond', 'Willow', 'Heron', 'Shore', 'Marsh', 'Rush', 'Waterside'],
    diners: ['Lakeside', 'Jetty', 'Harbour', 'Boathouse'],
    parks: ['Shore', 'Kingfisher', 'Reed Bank', 'Willow'],
  },
  woodland: {
    prefixes: ['Oak', 'Bram', 'Thorn', 'Hazel', 'Elder', 'Fox', 'Birch', 'Rowan'],
    suffixes: ['wood', 'holt', 'hurst', 'den', 'grove'],
    trades: { timber: 4, farming: 1 },
    layouts: { clustered: 2, scattered: 1, roadside: 1 },
    fertility: [0.9, 1.05],
    timber: 8, stone: 8, regrowth: 9,
    forest: [0.44, 0.65], rocks: [0.7, 0.4],
    lake: 0, pond: 0.6,
    farms: ['Glade', 'Acorn', 'Clearing', 'Bramble', 'Hazel', 'Stump', 'Coppice', 'Woodside'],
    diners: ['Pinecone', 'Hollow', "Woodcutter's", 'Acorn'],
    parks: ['Fern', 'Bluebell', 'Old Oak', 'Mossy'],
  },
  highland: {
    prefixes: ['High', 'Grey', 'Raven', 'Iron', 'Black', 'Cold', 'Hart', 'Brae'],
    suffixes: ['ridge', 'stone', 'crag', 'moor', 'fell'],
    trades: { quarry: 4, timber: 1, market: 1 },
    layouts: { clustered: 3, scattered: 1, roadside: 1 },
    fertility: [0.78, 0.92],
    timber: 6, stone: 11, regrowth: 5,
    forest: [0.55, 0.5], rocks: [0.56, 0.5],
    lake: 0, pond: 0.5,
    farms: ['Terrace', 'Heather', 'Stony', 'Upland', 'Crag', 'Highfield', 'Bracken', 'Windy'],
    diners: ['Hilltop', 'Summit', 'Cairn', 'Lookout'],
    parks: ['Heather', 'Lookout', 'Cairn', 'Gorse'],
  },
  meadow: {
    prefixes: ['Sun', 'Bar', 'Clover', 'Wheat', 'Lark', 'Green', 'Broad', 'Mill'],
    suffixes: ['field', 'ford', 'ley', 'ton', 'stead'],
    trades: { farming: 4, market: 2 },
    layouts: { clustered: 1, scattered: 3, roadside: 1 },
    fertility: [1.12, 1.3],
    timber: 6, stone: 8, regrowth: 4,
    forest: [0.58, 0.5], rocks: [0.72, 0.35],
    lake: 0.6, pond: 0.2,
    farms: ['Sunny', 'Clover', 'Barley', 'Wheatley', 'Lark', 'Golden', 'Broad Acre', 'Haystack'],
    diners: ['Corner', 'Haystack', 'Crossroads', 'Harvest'],
    parks: ['Maple', 'Sparrow', 'Poppy', 'Meadow'],
  },
};

/** Lake sites outside the original town, clear of the roads and the starter farm. */
const LAKE_SITES: [number, number][] = [[108, 72], [110, 11], [64, 74], [18, 72]];
/** Roughly where the town starts, for pointing growth at a lake. */
const ORIGIN: [number, number] = [56, 28];

function weighted<T extends string>(rng: Rng, table: Partial<Record<T, number>>): T {
  const entries = Object.entries(table) as [T, number][];
  let r = rng.next() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) if ((r -= w) < 0) return k;
  return entries[entries.length - 1][0];
}

/** A town's character, the same every time for the same seed. */
export function rollCharacter(seed: number): Character {
  // Its own stream, so rolling a character doesn't shift the sim's own random numbers.
  const rng = new Rng((seed ^ 0x5bd1e995) * 2654435761 + 1);
  const setting = rng.pick(Object.keys(SETTINGS) as Setting[]);
  const def = SETTINGS[setting];
  const trade = weighted(rng, def.trades);
  const layout = weighted(rng, def.layouts);
  const kin = rng.range(0.1, 0.9);
  const civic = rng.range(0.1, 0.9);
  const openness = rng.range(0.1, 0.9);
  const whim = rng.range(0.15, 0.45);

  const sites = rng.shuffle([...LAKE_SITES]);
  const lakes: Lake[] = [];
  if (rng.chance(def.lake)) lakes.push({ x: sites[0][0], y: sites[0][1], rx: rng.range(9, 13), ry: rng.range(5, 7) });
  if (rng.chance(def.pond)) lakes.push({ x: sites[1][0], y: sites[1][1], rx: rng.range(4, 6.5), ry: rng.range(3, 4) });
  // Lakeside towns grow toward the water; elsewhere, whichever way the founders' road took them.
  const shore = setting === 'lakeside' && lakes[0];
  const heading = shore ? Math.atan2(shore.y - ORIGIN[1], shore.x - ORIGIN[0]) : rng.range(-Math.PI, Math.PI);
  const lean = { clustered: rng.range(3, 7), roadside: rng.range(6, 12), scattered: rng.range(10, 18) }[layout];
  // The fields go out the other way from the houses, more or less.
  const farmHeading = heading + Math.PI + rng.range(-1.2, 1.2);

  const founders = rng.shuffle([...LAST]).slice(0, 6);
  const name = rng.pick(def.prefixes) + rng.pick(def.suffixes);

  // What the town was founded on, and what it values, tilt what its meetings put forward.
  const community = 0.7 + civic * 0.6;
  const bias: Partial<Record<BlueprintKey, number>> = {
    school: community,
    park: community,
    clinic: 0.85 + civic * 0.3,
    diner: community,
    extension: 0.8 + kin * 0.4,
  };
  const mul = (k: BlueprintKey, f: number) => (bias[k] = (bias[k] ?? 1) * f);
  const start: Character['start'] = {};
  let workshopAt = 22;
  let dinerEvery = 24;
  if (trade === 'farming') {
    mul('farm', 1.35);
    mul('storehouse', 1.1);
    start.food = 60;
  } else if (trade === 'timber') {
    mul('workshop', 1.6);
    mul('storehouse', 1.2);
    workshopAt = 18;
    start.wood = 30;
  } else if (trade === 'quarry') {
    mul('workshop', 1.4);
    mul('storehouse', 1.2);
    workshopAt = 20;
    start.stone = 30;
  } else {
    mul('diner', 1.5);
    mul('storehouse', 1.3);
    dinerEvery = 18;
    start.treasury = 150;
  }

  const names = (pool: string[], suffix: string) => rng.shuffle(pool.map((n) => `${n} ${suffix}`));
  // One park is named for a founding family, the way real towns remember theirs.
  const parkNames = names(def.parks, 'Park');
  parkNames.splice(1, 0, `${founders[rng.int(0, 5)]} Park`);

  return {
    name, setting, trade, layout, kin, civic, openness, whim, heading, lean, farmHeading,
    fertility: rng.range(...def.fertility),
    timber: def.timber, stone: def.stone, regrowth: def.regrowth,
    forest: def.forest, rocks: def.rocks, lakes, founders, bias,
    workshopAt, dinerEvery, parkEvery: Math.round(26 - civic * 12),
    start,
    farmNames: names(def.farms, 'Farm'),
    dinerNames: names(def.diners, 'Diner'),
    parkNames,
  };
}

/** The nth name from a pool, numbering repeats once the pool runs out ("Reed Farm 2"). */
export function nthName(pool: string[], n: number): string {
  const base = pool[n % pool.length];
  const round = Math.floor(n / pool.length);
  return round ? `${base} ${round + 1}` : base;
}

const SETTING_TEXT: Record<Setting, string> = {
  lakeside: 'on the shore of a lake',
  woodland: 'deep in the woods',
  highland: 'up in rocky hills',
  meadow: 'on open meadowland',
};

const TRADE_TEXT: Record<Trade, string> = {
  farming: 'farming settlement',
  timber: 'timber town',
  quarry: 'quarry town',
  market: 'market town',
};

const LAYOUT_TEXT: Record<Layout, string> = {
  clustered: 'homes huddle close around the center',
  scattered: 'homesteads spread out with room to breathe',
  roadside: 'homes string out along the main roads',
};

/** "A timber town deep in the woods, on thin soil." and what its people are like, for the Town view. */
export function describe(c: Character): { summary: string; traits: string[] } {
  if (c.classic) return { summary: 'The original town, as it was first laid out.', traits: [] };
  const soil = c.fertility >= 1.15 ? ', on rich soil' : c.fertility <= 0.9 ? ', on thin soil' : '';
  const traits: string[] = [];
  if (c.kin >= 0.65) traits.push('big families who settle near their parents');
  else if (c.kin <= 0.35) traits.push('small families; grown kids go their own way');
  if (c.civic >= 0.65) traits.push('proud of its schools and parks');
  else if (c.civic <= 0.35) traits.push('not one for public works');
  if (c.openness >= 0.65) traits.push('quick to welcome newcomers');
  else if (c.openness <= 0.35) traits.push('wary of strangers');
  traits.push(LAYOUT_TEXT[c.layout]);
  if (c.whim >= 0.38) traits.push('town meetings are hard to predict');
  const article = /^[aeiou]/.test(TRADE_TEXT[c.trade]) ? 'An' : 'A';
  return { summary: `${article} ${TRADE_TEXT[c.trade]} ${SETTING_TEXT[c.setting]}${soil}.`, traits };
}
