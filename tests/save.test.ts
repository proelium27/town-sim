import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { billText, GOOD_KEYS, NEEDS } from '../src/sim/defs';
import { loadSim, SAVE_VERSION, saveSim, snapshot } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { BACKUP_KEY, readSave, Saves } from '../src/ui/saves';

describe('saving and loading', () => {
  it('a reloaded town carries on exactly as if it never stopped', () => {
    const a = new Sim(7);
    a.run(2 * 1440 + 300);
    const b = loadSim(saveSim(a));
    expect(snapshot(b)).toBe(snapshot(a));
    a.run(720);
    b.run(720);
    expect(b.clock()).toBe(a.clock());
    expect(b.activity.map((e) => e.text)).toEqual(a.activity.map((e) => e.text));
    expect(snapshot(b)).toBe(snapshot(a));
  }, 60_000);

  it('keeps maps, sets and infinities intact', () => {
    const a = new Sim(3);
    a.run(600);
    const b = loadSim(saveSim(a));
    const p = b.agents[0];
    expect(p.relations).toBeInstanceOf(Map);
    expect([...p.relations.values()].some((r) => r.lastTalk === -Infinity)).toBe(true);
    expect(b.map.cell).toBeInstanceOf(Uint8Array);
    expect(b.map.propsOn(b.map.props[0].x, b.map.props[0].y)).toContain(b.map.props[0]);
  });

  it('people in a save from before health load in full health', () => {
    const file = JSON.parse(saveSim(new Sim(3)));
    for (const a of file.sim.agents) delete a.needs.health;
    const b = loadSim(JSON.stringify(file));
    expect(b.agents.every((a) => a.needs.health === 100)).toBe(true);
  });

  it('backfills new fields on people who moved away, too', () => {
    const a = new Sim(7, { agents: true });
    const gone = a.agents.pop()!;
    delete (gone as Partial<typeof gone>).tool;
    delete (gone as Partial<typeof gone>).lastBirthday;
    a.departed.push(gone);
    const b = loadSim(saveSim(a));
    expect(b.departed[0].tool).toBe(0);
    expect(b.departed[0].lastBirthday).toBe(0);
  });

  it('people in saves from before winter start warm', () => {
    const a = new Sim(3);
    const file = JSON.parse(saveSim(a));
    for (const p of file.sim.agents) delete p.needs.warmth;
    const b = loadSim(JSON.stringify(file));
    expect(b.agents.every((p) => p.needs.warmth === 100)).toBe(true);
  });

  it('starts a need missing from an old save at its own backfill value, not the generic 80', () => {
    const a = new Sim(3);
    a.run(60);
    const file = JSON.parse(saveSim(a));
    for (const p of file.sim.agents) delete p.needs.fun;
    const prev = NEEDS.fun.backfill;
    NEEDS.fun.backfill = 100;
    try {
      const b = loadSim(JSON.stringify(file));
      expect(b.agents.every((p) => p.needs.fun === 100)).toBe(true);
    } finally {
      NEEDS.fun.backfill = prev;
    }
    expect(loadSim(JSON.stringify(file)).agents[0].needs.fun).toBe(80);
  });

  it('rejects files that are not saves', () => {
    expect(() => loadSim('{"hello":1}')).toThrow(/not a Townsfolk save/);
    expect(() => loadSim('{"v":0,"sim":{}}')).toThrow(/not a Townsfolk save/);
    expect(() => loadSim('{"v":1.5,"sim":{}}')).toThrow(/not a Townsfolk save/);
    expect(() => loadSim(`{"v":${SAVE_VERSION + 1},"sim":{}}`)).toThrow(/newer version/);
  });

  it("ignores __proto__ and constructor keys in a file", () => {
    const a = new Sim(3);
    const text = saveSim(a).replace('"sim":{', '"sim":{"__proto__":{"evil":1},"constructor":{"evil":1},');
    const b = loadSim(text);
    expect(Object.getPrototypeOf(b)).toBe(Sim.prototype);
    expect(Object.hasOwn(b, 'constructor')).toBe(false);
  });
});

describe('calendar', () => {
  it('runs spring, summer, autumn, winter, then a new year', () => {
    const sim = new Sim(7, { agents: false });
    expect(sim.date()).toBe('Spring 1 · Year 1');
    sim.time = 2 * 1440 + 60;
    expect(sim.seasonName).toBe('Summer');
    sim.time = 7 * 1440 + 60;
    expect(sim.date()).toBe('Winter 2 · Year 1');
    sim.time = 8 * 1440 + 60;
    expect(sim.date()).toBe('Spring 1 · Year 2');
  });
});

describe('goods registry', () => {
  it('stores every good and describes project materials', () => {
    const sim = new Sim(7, { agents: false });
    for (const g of GOOD_KEYS) expect(typeof sim.stock[g]).toBe('number');
    expect(billText({ wood: 40, stone: 20 }, { wood: 12 })).toBe('wood 12/40 · stone 0/20');
  });
});

describe('an unreadable autosave', () => {
  const store = new Map<string, string>();
  const storage = (failBackup = false) => ({
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failBackup && k === BACKUP_KEY) throw new Error('QuotaExceededError');
      store.set(k, String(v));
    },
    removeItem: (k: string) => void store.delete(k),
  });
  const tooNew = () => saveSim(new Sim(3, { agents: false })).replace(/^\{"v":\d+/, `{"v":${SAVE_VERSION + 1}`);
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('addEventListener', () => {});
    vi.stubGlobal('document', { addEventListener: () => {} });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('from a newer version is kept as a backup, not overwritten by the fresh town', () => {
    vi.stubGlobal('localStorage', storage());
    const text = tooNew();
    store.set('townsfolk.save', text);
    const got = readSave();
    expect(got.sim).toBeNull();
    expect(got.unreadable?.reason).toMatch(/newer version/);
    expect(store.get(BACKUP_KEY)).toBe(text);
    const saves = new Saves(new Sim(7, { agents: false }), true, got.unreadable);
    saves.save();
    expect(store.get(BACKUP_KEY)).toBe(text);
    expect(store.get('townsfolk.save')).not.toBe(text);
    expect(saves.notice()).toMatch(/kept as a backup/);
    expect(saves.hasBackup).toBe(true);
  });

  it('stays in place with autosave off if there is no room to back it up', () => {
    vi.stubGlobal('localStorage', storage(true));
    const text = tooNew();
    store.set('townsfolk.save', text);
    const saves = new Saves(new Sim(7, { agents: false }), true, readSave().unreadable);
    saves.save();
    expect(store.get('townsfolk.save')).toBe(text);
    expect(saves.canSave).toBe(false);
    expect(saves.notice()).toMatch(/autosave is off/);
  });
});
