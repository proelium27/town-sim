import { MIN_PER_DAY, SEASONS } from './defs';
import { allocateRoles } from './planner';
import { addMemory, think } from './social';
import type { Sim } from './sim';
import { HEADLINE, NOTABLE } from './types';

/** Hearth fuel a home burns per game hour at full chill. */
export const BURN_PER_HOUR = 0.25;
/** Firewood a household keeps by the hearth before it stops asking for more. */
export const HEARTH_FULL = 14;
/** Firewood the town keeps in for each home, as a share of a full hearth, spring to winter. */
export const FIREWOOD_STOCK = [0.4, 0.15, 1.2, 1];
/** Splitting turns 4 wood into 6 firewood. */
export const SPLIT = { wood: 4, firewood: 6 };
/** Each season's festival, held on its second evening. */
export const FESTIVALS = ['Spring fair', 'Midsummer night', 'Harvest festival', 'Winter lights'];

/**
 * How cold it is, 0 (warm) to 1 (bitter). Winter is cold all day and coldest at night; the end of
 * autumn and the start of spring are chilly; summer is warm.
 */
export function chill(sim: Sim): number {
  if (sim.events.snowstorm) return 1;
  const s = sim.season;
  const p = sim.seasonProgress;
  const night = sim.hour < 7 || sim.hour >= 19 ? 1 : 0;
  if (s === 3) return 0.8 + 0.2 * night;
  if (s === 2) return p < 0.5 ? 0.1 * night : (0.25 + 0.4 * (p - 0.5)) * (0.7 + 0.3 * night);
  if (s === 0) return p < 0.4 ? (0.45 - p) * (0.7 + 0.3 * night) : 0;
  return 0;
}

/** Whether what's falling is snow: any winter rain, and every blizzard (whatever the season). */
export function snowing(sim: Sim): boolean {
  return !!sim.events.snowstorm || (!!sim.events.rain && sim.season === 3);
}

/** Crop growth multiplier for the season: nothing grows in winter. */
export function cropSeason(sim: Sim): number {
  return [1, 1.2, 0.8, 0][sim.season];
}


/** Days of full burn the firewood the town keeps in through winter lasts: a home's share against its hearth. */
export const WINTER_STOCK_DAYS = (HEARTH_FULL * FIREWOOD_STOCK[3]) / (BURN_PER_HOUR * 24);

/**
 * Days the stores would last through winter: food at today's appetite, firewood at full burn. Logs in
 * the store count as the firewood they'd split into.
 */
export function winterReadiness(sim: Sim): { food: number; firewood: number } {
  const eat = Math.max(1, sim.agents.length * 2.6);
  const homes = sim.town.households.filter((h) => h.building >= 0).length || 1;
  const logs = Math.floor(sim.stock.wood / SPLIT.wood) * SPLIT.firewood;
  const fuel = sim.stock.firewood + logs + sim.fuel.reduce((s, f) => s + f, 0);
  return { food: sim.stock.food / eat, firewood: fuel / (homes * BURN_PER_HOUR * 24) };
}

/** Hearths burn, the first frost kills the crops left in the fields, and each season brings its weather and festival. */
export function tickSeasons(sim: Sim, dt: number): void {
  const c = chill(sim);
  if (c > 0) {
    // A hearth burns while anyone is home (the homeless have no hearth, and outdoors isn't home).
    const home = new Set<number>();
    for (const a of sim.agents) {
      const room = sim.town.households[a.household].room;
      if (room >= 0 && sim.map.room[a.at] === room) home.add(a.household);
    }
    for (const hh of home) if (sim.fuel[hh] > 0) sim.fuel[hh] = Math.max(0, sim.fuel[hh] - (c * BURN_PER_HOUR * dt) / 60);
  }
  const season = sim.season;
  if (sim.seasonSeen === season) return;
  const first = sim.seasonSeen === -1;
  sim.seasonSeen = season;
  if (first) return;
  sim.log(`${SEASONS[season]} has come to Northwind`, 'event', 'neutral').weight = NOTABLE;
  sim.milestone(`${SEASONS[season]}, year ${sim.year}`);
  // The town's needs shift with the season (fishers from autumn), so jobs are looked over now, not at the next six-hourly pass.
  allocateRoles(sim);
  if (season === 3) {
    // Whatever is still in the fields, ripe or not, is lost: the harvest has to be in before the frost.
    let ripe = 0;
    let green = 0;
    for (const p of sim.map.props) {
      if (p.use !== 'farm') continue;
      if ((p.growth ?? 0) >= 1) ripe++;
      else if ((p.growth ?? 0) > 0.05) green++;
      p.growth = 0;
    }
    const lost = [ripe && `${ripe} ripe`, green && `${green} unripe`].filter(Boolean).join(' and ');
    sim.log(lost ? `First frost: ${lost} ${ripe + green === 1 ? 'crop' : 'crops'} froze in the fields` : 'First frost. The fields are bare until spring', 'event', lost ? 'bad' : 'neutral').weight = lost ? HEADLINE : NOTABLE;
    for (const a of sim.agents) {
      if (a.role === 'child') {
        addMemory(sim, a, 'snowDay');
        think(sim, a, 'Snow!! Everything is white!', 'good');
      }
    }
  } else if (season === 0) sim.log('Spring: the fields can be sown again', 'event', 'good');
  // The season's festival, on its second evening.
  const at = (sim.day + 1) * MIN_PER_DAY + 17 * 60;
  sim.events.seasonal = { at, name: FESTIVALS[season] };
}
