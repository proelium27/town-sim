/**
 * Sim performance bench. Times sim steps and fingerprints the final state, so an optimisation can be checked
 * for speed and for leaving the simulation unchanged.
 *
 *   npm run bench -- crowd [people=200] [hours=24] [seed=7] [startDay=1]
 *     A town run for `startDay` whole days, forced up to `people` with newcomers, then timed hour by hour. Days count
 *     from 0 here (startDay=2 times the third day, "Day 3" on screen, which is election day). The newcomers are mostly
 *     homeless, so this is a stress case, not a grown 200-person town.
 *   npm run bench -- long [seed=7] [days=20] [--from save.json] [--save-at day file]
 *     A normal town run day by day, optionally resumed from or saved to a file to replay a slow stretch. Day labels
 *     here are the on-screen ones (from 1); --save-at saves once that day has been run.
 *
 * Fingerprint: a hash of the whole saved state at the end. It changes whenever the sim does, so compare it before and
 * after an optimisation with the same arguments: the two must match.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { newcomers } from '../src/sim/life';
import { loadSim, saveSim, snapshot } from '../src/sim/save';
import { Sim, STEP } from '../src/sim/sim';

const STEPS_PER_HOUR = Math.round(60 / STEP);
const [mode = 'crowd', ...rest] = process.argv.slice(2);
const flags = new Map<string, string[]>();
const pos: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--from') flags.set('from', [rest[++i]]);
  else if (rest[i] === '--save-at') flags.set('save-at', [rest[++i], rest[++i]]);
  else pos.push(rest[i]);
}

/** Runs `hours` game hours, returning CPU µs per step for each hour (CPU time, so other busy processes skew it less). */
function timeHours(sim: Sim, hours: number): number[] {
  const out: number[] = [];
  for (let h = 0; h < hours; h++) {
    const t0 = process.cpuUsage();
    for (let i = 0; i < STEPS_PER_HOUR; i++) sim.step();
    const used = process.cpuUsage(t0);
    out.push((used.user + used.system) / STEPS_PER_HOUR);
  }
  return out;
}

const fingerprint = (sim: Sim) => createHash('sha1').update(snapshot(sim)).digest('hex').slice(0, 12);
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const fmt = (us: number) => `${us.toFixed(0)}µs`;

if (mode === 'crowd') {
  const [people = 200, hours = 24, seed = 7, startDay = 1] = pos.map(Number);
  const sim = new Sim(seed);
  sim.run(startDay * 24 * 60);
  while (sim.agents.length < people) newcomers(sim, Math.min(3, people - sim.agents.length), true);
  const t0 = performance.now();
  const searches0 = sim.nav.searches;
  const per = timeHours(sim, hours);
  // Path searches per step: a work count that machine load can't skew, unlike the timings.
  const searches = (sim.nav.searches - searches0) / (hours * STEPS_PER_HOUR);
  console.log(
    `crowd seed ${seed}: ${sim.agents.length} people now, ${hours}h in ${((performance.now() - t0) / 1000).toFixed(1)}s | ` +
      `per step: median ${fmt(pct(per, 0.5))}, p90 ${fmt(pct(per, 0.9))}, worst hour ${fmt(Math.max(...per))}, ` +
      `${searches.toFixed(2)} path searches | fingerprint ${fingerprint(sim)}`,
  );
} else if (mode === 'long') {
  const [seed = 7, days = 20] = pos.map(Number);
  const from = flags.get('from')?.[0];
  const sim = from ? loadSim(readFileSync(from, 'utf8')) : new Sim(seed);
  const saveAt = flags.get('save-at');
  const t0 = performance.now();
  const end = Math.floor(sim.time / 1440) + days;
  while (sim.time / 1440 < end) {
    const day = Math.floor(sim.time / 1440) + 1;
    const per = timeHours(sim, 24);
    console.log(`day ${String(day).padStart(3)}: ${String(sim.agents.length).padStart(3)} people | per step: median ${fmt(pct(per, 0.5))}, worst hour ${fmt(Math.max(...per))}`);
    if (saveAt && day === Number(saveAt[0])) writeFileSync(saveAt[1], saveSim(sim));
  }
  console.log(`long: ${((performance.now() - t0) / 1000).toFixed(1)}s | fingerprint ${fingerprint(sim)}`);
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
