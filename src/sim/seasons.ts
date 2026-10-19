import { MIN_PER_DAY, SEASONS } from './defs';
import { addMemory, think } from './social';
import type { Sim } from './sim';

/** Hearth fuel a home burns per game hour at full chill. */
export const BURN_PER_HOUR = 0.25;
/** Firewood a household keeps by the hearth before it stops asking for more. */
export const HEARTH_FULL = 14;
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

/** Crop growth multiplier for the season: nothing grows in winter. */
export function cropSeason(sim: Sim): number {
  return [1, 1.2, 0.8, 0][sim.season];
}


/** Days the stores would last through winter: food at today's appetite, firewood at full burn. */
export function winterReadiness(sim: Sim): { food: number; firewood: number } {
  const eat = Math.max(1, sim.agents.length * 2.6);
  const homes = sim.town.households.filter((h) => h.building >= 0).length || 1;
  const fuel = sim.stock.firewood + sim.fuel.reduce((s, f) => s + f, 0);
  return { food: sim.stock.food / eat, firewood: fuel / (homes * BURN_PER_HOUR * 24) };
}

/** Hearths burn, the first frost kills unripe crops, and each season brings its weather and festival. */
export function tickSeasons(sim: Sim, dt: number): void {
  const c = chill(sim);
  if (c > 0) {
    // A hearth burns while anyone is home.
    const home = new Set<number>();
    for (const a of sim.agents) if (sim.map.room[a.at] === sim.town.households[a.household].room) home.add(a.household);
    for (const hh of home) if (sim.fuel[hh] > 0) sim.fuel[hh] = Math.max(0, sim.fuel[hh] - (c * BURN_PER_HOUR * dt) / 60);
  }
  const season = sim.season;
  if (sim.seasonSeen === season) return;
  const first = sim.seasonSeen === -1;
  sim.seasonSeen = season;
  if (first) return;
  sim.log(`${SEASONS[season]} has come to Northwind`, 'event', 'neutral');
  sim.milestone(`${SEASONS[season]}, year ${sim.year}`);
  if (season === 3) {
    let lost = 0;
    for (const p of sim.map.props) {
      if (p.use !== 'farm' || (p.growth ?? 0) >= 1) continue;
      if ((p.growth ?? 0) > 0.05) lost++;
      p.growth = 0;
    }
    sim.log(lost ? `First frost: ${lost} unripe crops froze in the fields` : 'First frost. The fields are bare until spring', 'event', lost ? 'bad' : 'neutral');
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
