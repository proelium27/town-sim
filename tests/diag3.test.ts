import { it } from 'vitest';
import { loadSim, saveSim, snapshot } from '../src/sim/save';
import { Sim } from '../src/sim/sim';

function diff(a: unknown, b: unknown, path: string, out: string[]): void {
  if (out.length > 25) return;
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return void out.push(`${path}: type ${typeof a} vs ${typeof b}`);
  if (a && typeof a === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.join() !== kb.join()) out.push(`${path}: keys [${ka.filter((k) => !kb.includes(k))}] vs [${kb.filter((k) => !ka.includes(k))}] order ${ka.join() === kb.sort().join()}`);
    for (const k of ka) if (kb.includes(k)) diff((a as never)[k], (b as never)[k], `${path}.${k}`, out);
  } else if (a !== b) out.push(`${path}: ${String(a).slice(0, 60)} vs ${String(b).slice(0, 60)}`);
}

it.skipIf(!process.env.DIAG)('save diff', () => {
  const a = new Sim(7);
  a.run(2 * 1440 + 300);
  const b = loadSim(saveSim(a));
  const out: string[] = [];
  diff(JSON.parse(snapshot(a)), JSON.parse(snapshot(b)), '', out);
  console.log(out.join('\n'));
}, 60_000);
