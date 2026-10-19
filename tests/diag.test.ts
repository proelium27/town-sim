import { it } from 'vitest';
import { ageOf } from '../src/sim/agents';
import { stageOf } from '../src/sim/planner';
import { Sim } from '../src/sim/sim';

it.skipIf(!process.env.DIAG)('diag', () => {
  const sim = new Sim(Number(process.env.SEED ?? 7));
  const t0 = performance.now();
  const days = Number(process.env.DAYS ?? 12);
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      sim.run(60);
      if (h === 11) {
        const roles: Record<string, number> = {};
        for (const a of sim.agents) roles[a.role] = (roles[a.role] ?? 0) + 1;
        const acts: Record<string, number> = {};
        for (const a of sim.agents) acts[a.action.kind] = (acts[a.action.kind] ?? 0) + 1;
        const mood = Math.round(sim.agents.reduce((s, a) => s + a.mood, 0) / sim.agents.length);
        const homeless = sim.agents.filter((a) => sim.town.households[a.household].building < 0).length;
        console.log(`D${d + 1} ${sim.clock()} pop ${sim.agents.length} (kids ${sim.agents.filter((a) => ageOf(sim, a) < 18).length}, homeless ${homeless}) mood ${mood} | wood ${sim.stock.wood.toFixed(0)} stone ${sim.stock.stone.toFixed(0)} food ${sim.stock.food.toFixed(0)} | buildings ${sim.map.buildings.length} | projects ${sim.projects.map((p) => `${p.name}[${stageOf(sim, p)} w${p.delivered.wood}/${p.need.wood} s${p.delivered.stone}/${p.need.stone} ${Math.round((p.progress / p.work) * 100)}%]`).join(', ')}`);
        console.log('   roles', JSON.stringify(roles), 'acts', JSON.stringify(acts));
      }
    }
  }
  console.log('ms', Math.round(performance.now() - t0), 'searches', sim.nav.searches);
  for (const e of sim.activity.filter((e) => e.kind === 'build' || e.kind === 'family' || e.kind === 'event').slice(-70)) console.log(`  [D${Math.floor(e.t / 1440) + 1} ${(e.t % 1440 / 60).toFixed(1)}] ${e.kind} ${e.text}`);
  console.log('history', sim.history.map((h) => h.text).join(' | '));
}, 600000);
