import { it } from 'vitest';
import { Sim } from '../src/sim/sim';
it.skipIf(!process.env.DIAG)('diag', () => {
  const sim = new Sim(Number(process.env.SEED ?? 7));
  const t0 = performance.now();
  for (let h = 0; h < 72; h++) {
    sim.run(60);
    if (h % 2 === 1 || h > 40) continue;
    const counts: Record<string, number> = {};
    for (const a of sim.agents) counts[a.action.kind] = (counts[a.action.kind] ?? 0) + 1;
    const avg = (k: string) => Math.round(sim.agents.reduce((s, a) => s + (a.needs as any)[k], 0) / sim.agents.length);
    console.log(sim.clock(), JSON.stringify(counts), `E${avg('energy')} H${avg('hunger')} Hy${avg('hygiene')} S${avg('social')} F${avg('fun')} W${avg('work')} mood ${Math.round(sim.agents.reduce((s,a)=>s+a.mood,0)/12)} pantry ${sim.pantry.join(',')}`);
  }
  console.log('ms', Math.round(performance.now() - t0), 'tasks', sim.tasksCompleted, 'searches', sim.nav.searches, 'cars', sim.cars.length);
  for (const e of sim.activity.slice(-60)) console.log(`  [${(e.t/60).toFixed(1)}] ${e.kind} ${e.text}`);
  for (const a of sim.agents) console.log(a.name, a.role, a.traits.join('/'), 'mood', Math.round(a.mood), 'tasks', a.tasksDone, 'craft', a.skills.craft.level, '$', Math.round(a.money), '|', a.thoughts.slice(-3).map(t=>t.text).join(' / '));
}, 120000);
