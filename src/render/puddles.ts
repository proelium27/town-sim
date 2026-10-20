import { Container, Graphics } from 'pixi.js';
import { TILE } from '../assets/manifest';
import type { TownMap } from '../world/map';

/** Puddles are baked in square chunks of this many tiles, so a paved tile redraws only its own. */
const CHUNK = 16;
const WET = new Set(['dirt', 'trail', 'worn', 'sidewalk', 'plaza', 'asphalt']);
const vhash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

/** Whether cell i holds a puddle after rain: a stable few of the outdoor paths and paving. */
export function puddleAt(m: TownMap, i: number): boolean {
  if (!WET.has(m.ground[i]) || m.room[i] >= 0) return false;
  return vhash(m.cx(i) * 3 + 1, m.cy(i) * 5 + 2) % 100 < (m.ground[i] === 'asphalt' ? 3 : 9);
}

/**
 * Rain puddles on paths and pavement. Ground changes (paving, trails wearing in) redraw only the
 * chunks where a puddle actually appeared or vanished; wall changes, which move rooms, redraw all.
 */
export class Puddles {
  readonly layer = new Container();
  private chunks: Graphics[] = [];
  private chunksW: number;
  /** 1 where a puddle is currently drawn. */
  private drawn: Uint8Array;
  /** Chunks waiting to be redrawn, kept while the puddles are hidden. */
  readonly dirty = new Set<number>();
  private wallVersion = -1;

  constructor(readonly map: TownMap) {
    this.chunksW = Math.ceil(map.w / CHUNK);
    const n = this.chunksW * Math.ceil(map.h / CHUNK);
    for (let c = 0; c < n; c++) this.chunks.push(this.layer.addChild(new Graphics()));
    this.drawn = new Uint8Array(map.w * map.h);
  }

  /** The ground under cell i changed: queue its chunk if that adds or removes a puddle. */
  touch(i: number): void {
    const m = this.map;
    if (puddleAt(m, i) === !!this.drawn[i]) return;
    this.dirty.add(Math.floor(m.cy(i) / CHUNK) * this.chunksW + Math.floor(m.cx(i) / CHUNK));
  }

  /** Redraw what changed. Only call while the puddles are showing; until then changes wait. */
  sync(): void {
    const m = this.map;
    if (m.wallVersion !== this.wallVersion) {
      this.wallVersion = m.wallVersion;
      for (let c = 0; c < this.chunks.length; c++) this.dirty.add(c);
    }
    for (const c of this.dirty) this.draw(c);
    this.dirty.clear();
  }

  private draw(c: number): void {
    const m = this.map;
    const g = this.chunks[c].clear();
    const x0 = (c % this.chunksW) * CHUNK;
    const y0 = Math.floor(c / this.chunksW) * CHUNK;
    for (let y = y0; y < Math.min(m.h, y0 + CHUNK); y++) {
      for (let x = x0; x < Math.min(m.w, x0 + CHUNK); x++) {
        const i = m.idx(x, y);
        this.drawn[i] = puddleAt(m, i) ? 1 : 0;
        if (!this.drawn[i]) continue;
        const h = vhash(x * 3 + 1, y * 5 + 2);
        const X = x * TILE + 3 + (h % 5);
        const Y = y * TILE + 5 + ((h >> 3) % 6);
        const w = 6 + ((h >> 6) % 5);
        g.ellipse(X + w / 2, Y + 2, w / 2, 2).fill({ color: 0x6f8fa8, alpha: 0.55 });
        g.rect(X + 2, Y + 1, Math.max(2, w - 5), 1).fill({ color: 0xc9dbe8, alpha: 0.6 });
      }
    }
  }
}
