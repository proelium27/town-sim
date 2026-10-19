import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { TILE } from '../assets/manifest';
import { Cell, type RoomKind, type TownMap } from '../world/map';

type RGB = [number, number, number];

/** Multiply grade through the day: [hour, color]. White is untouched daylight. */
const GRADE: [number, RGB][] = [
  [0, [0.36, 0.42, 0.7]],
  [4.5, [0.36, 0.42, 0.7]],
  [6, [0.82, 0.66, 0.7]],
  [7.5, [1, 0.96, 0.9]],
  [9, [1, 1, 1]],
  [16.5, [1, 1, 1]],
  [18, [1, 0.88, 0.7]],
  [19.3, [0.84, 0.6, 0.66]],
  [20.6, [0.46, 0.48, 0.74]],
  [21.5, [0.36, 0.42, 0.7]],
  [24, [0.36, 0.42, 0.7]],
];
const RAIN: RGB = [0.82, 0.86, 0.92];

const WARM = 0xffb25a;
const LAMP = 0xffd38a;
const HEADLIGHT = 0xfff1c8;

/** Rooms that keep their lights on while open, occupied or not. */
const PUBLIC: Partial<Record<RoomKind, [number, number]>> = { cafe: [6.5, 21], shop: [7, 21], library: [8, 20], lobby: [7, 20] };

const toHex = ([r, g, b]: RGB): number => (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);

function gradeAt(hour: number): RGB {
  for (let k = 1; k < GRADE.length; k++) {
    const [h1, c1] = GRADE[k];
    if (hour > h1) continue;
    const [h0, c0] = GRADE[k - 1];
    const t = (hour - h0) / (h1 - h0 || 1);
    return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
  }
  return GRADE[0][1];
}

/** A radial light with hard bands, so it reads as pixel art when scaled with nearest filtering. */
function bandedGlow(): Texture {
  const N = 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);
      const a = d >= 1 ? 0 : d > 0.84 ? 0.1 : d > 0.64 ? 0.24 : d > 0.42 ? 0.45 : d > 0.2 ? 0.72 : 1;
      const o = (y * N + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(cv);
  tex.source.scaleMode = 'nearest';
  return tex;
}

export interface VehicleLight {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/**
 * Time of day for the world: a multiply grade over the whole map, then additive light from
 * street lamps, lit rooms (spilling out of their doors) and car headlights once it gets dark.
 * World-space; add it above the y-sorted entities.
 */
export class Lighting {
  readonly layer = new Container();
  private grade = new Graphics();
  private lights = new Container();
  private statics = new Container();
  private cars = new Container();
  private glow = bandedGlow();
  private sig = '';
  /** 0 in daylight, 1 at full night. */
  darkness = 0;

  constructor(readonly map: TownMap) {
    this.grade.blendMode = 'multiply';
    this.lights.blendMode = 'add';
    this.lights.addChild(this.statics, this.cars);
    this.layer.addChild(this.grade, this.lights);
    this.layer.eventMode = 'none';
  }

  /**
   * @param occupied rooms with someone awake inside, so homes light up when people are home.
   */
  update(
    hour: number,
    raining: boolean,
    occupied: Set<number>,
    vehicles: VehicleLight[],
    roofed: Set<number> = new Set(),
    windows: { x: number; y: number; w: number; h: number; rooms: number[] }[] = [],
  ): void {
    const m = this.map;
    let c = gradeAt(((hour % 24) + 24) % 24);
    if (raining) c = [c[0] * RAIN[0], c[1] * RAIN[1], c[2] * RAIN[2]];
    const lum = 0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2];
    this.darkness = Math.max(0, Math.min(1, (0.97 - lum) / 0.5));
    this.grade.clear();
    if (lum < 0.995) this.grade.rect(0, 0, m.w * TILE, m.h * TILE).fill(toHex(c));
    this.lights.visible = this.darkness > 0.04;
    this.lights.alpha = Math.min(1, this.darkness * 1.3);
    if (!this.lights.visible) return;

    const lit = m.rooms.filter((r) => {
      if (r.kind === 'restroom') return false;
      const hours = PUBLIC[r.kind];
      return occupied.has(r.id) || (hours !== undefined && hour >= hours[0] && hour < hours[1]);
    });
    const sig = `${lit.map((r) => r.id).join(',')}:${m.propVersion}:${m.wallVersion}:${[...roofed].join(',')}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.buildStatics(new Set(lit.map((r) => r.id)), roofed, windows);
    }
    this.placeHeadlights(vehicles);
  }

  private pool(parent: Container, x: number, y: number, rx: number, ry: number, tint: number, alpha: number): Sprite {
    const s = new Sprite(this.glow);
    s.anchor.set(0.5);
    s.position.set(Math.round(x), Math.round(y));
    s.width = rx * 2;
    s.height = ry * 2;
    s.tint = tint;
    s.alpha = alpha;
    parent.addChild(s);
    return s;
  }

  private buildStatics(lit: Set<number>, roofed: Set<number>, windows: { x: number; y: number; w: number; h: number; rooms: number[] }[]): void {
    for (const ch of this.statics.removeChildren()) ch.destroy();
    const m = this.map;
    const warm = new Graphics();
    for (const r of m.rooms) {
      if (!lit.has(r.id) || roofed.has(r.id)) continue;
      warm.rect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE).fill({ color: WARM, alpha: 0.34 });
    }
    // Under a roof, the light shows only through the front windows.
    for (const w of windows) {
      if (!w.rooms.some((id) => lit.has(id))) continue;
      warm.rect(w.x, w.y, w.w, w.h).fill({ color: WARM, alpha: 0.85 });
      this.pool(this.statics, w.x + w.w / 2, w.y + w.h + 6, Math.max(10, w.w * 0.8), 7, WARM, 0.35);
    }
    this.statics.addChild(warm);
    // Light spilling out of the doors of lit rooms.
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        if (m.cell[m.idx(x, y)] !== Cell.Door) continue;
        const inside = [m.roomAt(x, y - 1), m.roomAt(x, y + 1), m.roomAt(x - 1, y), m.roomAt(x + 1, y)].find((r) => r && lit.has(r.id));
        if (!inside) continue;
        const outY = m.roomAt(x, y + 1) ? y - 1 : m.roomAt(x, y - 1) ? y + 1 : y;
        if (m.roomAt(x, outY)) continue;
        this.pool(this.statics, (x + 0.5) * TILE, (outY + 0.5) * TILE, 20, 13, WARM, 0.55);
      }
    }
    for (const p of m.props) {
      if (p.key !== 'lamp') continue;
      const cx = (p.x + p.w / 2) * TILE;
      this.pool(this.statics, cx + 1, (p.y + p.h) * TILE - 6, 38, 22, LAMP, 0.42);
      this.pool(this.statics, cx, p.y * TILE + 4, 7, 7, 0xfff4d6, 0.9);
    }
  }

  private placeHeadlights(vehicles: VehicleLight[]): void {
    while (this.cars.children.length < vehicles.length) this.pool(this.cars, 0, 0, 14, 8, HEADLIGHT, 0.4);
    this.cars.children.forEach((s, i) => {
      const v = vehicles[i];
      s.visible = !!v;
      if (!v) return;
      const horizontal = v.dx !== 0;
      s.position.set(Math.round(v.x + v.dx * 22), Math.round(v.y + v.dy * 22));
      (s as Sprite).width = horizontal ? 30 : 16;
      (s as Sprite).height = horizontal ? 14 : 30;
    });
  }
}
