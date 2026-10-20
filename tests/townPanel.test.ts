import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Saves } from '../src/ui/saves';
import { TownPanel } from '../src/ui/townPanel';

describe('New town button', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('stays armed across re-renders and disarms itself after a few seconds', () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { createElement: () => ({ addEventListener: () => {} }) });
    let click: (e: unknown) => void = () => {};
    const root = { innerHTML: '', after: () => {}, addEventListener: (_: string, fn: (e: unknown) => void) => (click = fn) };
    const reset = vi.fn();
    const saves = { enabled: true, canSave: true, hasBackup: false, status: () => '', notice: () => '', reset } as unknown as Saves;
    const sim = new Sim(7, { agents: false });
    const panel = new TownPanel(root as unknown as HTMLElement, sim, () => {}, () => {}, saves);
    const pressReset = () => click({ target: { closest: () => ({ dataset: { act: 'reset' } }) } });

    panel.update();
    expect(root.innerHTML).toContain('>New town<');
    pressReset();
    expect(root.innerHTML).toContain('Click again to start over');
    // The clock moves on and the panel redraws; the button must still look armed.
    sim.time += 60;
    panel.update();
    expect(root.innerHTML).toContain('Click again to start over');
    expect(reset).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4000);
    expect(root.innerHTML).toContain('>New town<');
    pressReset();
    expect(reset).not.toHaveBeenCalled();
    pressReset();
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe('Treasury prices', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("doesn't quote tools before the town has any or a workshop to make them", () => {
    vi.stubGlobal('document', { createElement: () => ({ addEventListener: () => {} }) });
    const root = { innerHTML: '', after: () => {}, addEventListener: () => {} };
    const saves = { enabled: true, canSave: true, hasBackup: false, status: () => '', notice: () => '', reset: () => {} } as unknown as Saves;
    const sim = new Sim(7, { agents: false });
    const panel = new TownPanel(root as unknown as HTMLElement, sim, () => {}, () => {}, saves);
    const quotes = () => [...root.innerHTML.matchAll(/<span class="price"><span>(\w+)<\/span>/g)].map((m) => m[1]);

    sim.stock.tools = 0;
    panel.update();
    expect(quotes()).toEqual(['Food', 'Firewood']);
    sim.stock.tools = 2;
    panel.update();
    expect(quotes()).toEqual(['Food', 'Firewood', 'Tools']);
    // A workshop can make them, so the price means something even with none in stock.
    sim.stock.tools = 0;
    sim.map.buildings.push({ ...sim.map.buildings[0], kind: 'workshop' });
    panel.update();
    expect(quotes()).toEqual(['Food', 'Firewood', 'Tools']);
  });
});
