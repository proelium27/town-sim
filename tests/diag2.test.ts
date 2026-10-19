import { it } from 'vitest';
import { Sim } from '../src/sim/sim';

it.skipIf(!process.env.DIAG)('nav components', () => {
  const sim = new Sim(11);
  const m = sim.map;
  let versions = 0;
  let last = '';
  for (let i = 0; i < 2000; i++) {
    sim.step();
    const k = `${m.propVersion}:${m.wallVersion}`;
    if (k !== last) versions++;
    last = k;
  }
  console.log('NAV version changes in 2000 steps:', versions);
  // Can people reach their beds?
  for (const a of sim.agents.slice(0, 5)) {
    const bed = m.props.find((p) => p.use === 'sleep' && p.household === a.household)!;
    const goal = m.idx(bed.spot!.x, bed.spot!.y);
    console.log('NAV', a.name, 'at', m.cx(a.at), m.cy(a.at), 'walkable', m.walkable(m.cx(a.at), m.cy(a.at)), 'bed', bed.spot!.x, bed.spot!.y, 'walkable', m.walkable(bed.spot!.x, bed.spot!.y), 'connected', sim.nav.connected(a.at, goal), 'path', sim.nav.findPath(a.at, goal)?.length);
  }
}, 120000);
