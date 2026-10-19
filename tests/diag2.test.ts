import { it } from 'vitest';
import { Sim } from '../src/sim/sim';

it.skipIf(!process.env.DIAG)('scares', () => {
  const sim = new Sim(11);
  let last = 0;
  for (let i = 0; i < (7 * 1440) / 0.05; i++) {
    sim.step();
    const n = sim.activity.filter((e) => e.text.includes('nearly')).length;
    if (n > last) {
      last = n;
      const e = sim.activity[sim.activity.length - 1];
      const a = sim.agent(e.agentId)!;
      const near = sim.cars
        .filter((c) => Math.hypot(c.x - a.x - 0.5, c.y - a.y - 0.5) < 3)
        .map((c) => `${c.lane} ${c.x.toFixed(1)},${c.y.toFixed(1)} v${c.speed.toFixed(1)}`);
      console.log('SCARE', sim.clock(), a.name, 'at', a.x.toFixed(2), a.y.toFixed(2), sim.map.ground[a.at], a.action.kind, a.action.stage, 'edgeT', a.edgeT.toFixed(2), near.join(' | '));
    }
  }
}, 120000);
