import { Assets, Rectangle, Texture, TextureSource } from 'pixi.js';
import type { DrawnKey } from '../world/map';
import { CHARACTER_BASES, type FrameRef, type Facing, SHEETS, type SheetKey, TILE, characterFrame } from './manifest';

TextureSource.defaultOptions.scaleMode = 'nearest';

export interface Outfit {
  base: number;
  /** Hue rotation in degrees applied to clothing pixels. */
  shirtHue: number;
  /** Hue rotation applied to hair pixels. */
  hairHue: number;
  hairLight: number;
}

/** Loads sheets once and hands out cached frame textures. */
export class Art {
  private sheets = {} as Record<SheetKey, Texture>;
  private images = {} as Record<SheetKey, HTMLImageElement | ImageBitmap>;
  private frames = new Map<string, Texture>();
  private outfits = new Map<string, Record<Facing, Texture[]>>();
  private custom = new Map<string, Texture>();

  async load(): Promise<void> {
    const base = import.meta.env.BASE_URL;
    await Promise.all(
      (Object.keys(SHEETS) as SheetKey[]).map(async (k) => {
        const tex = await Assets.load<Texture>(base + SHEETS[k].url);
        tex.source.scaleMode = 'nearest';
        this.sheets[k] = tex;
        this.images[k] = tex.source.resource as HTMLImageElement | ImageBitmap;
      }),
    );
  }

  image(k: SheetKey): CanvasImageSource {
    return this.images[k] as CanvasImageSource;
  }

  rect(f: FrameRef): Rectangle {
    if (f.px) return new Rectangle(f.px.x, f.px.y, f.px.w, f.px.h);
    const step = TILE + SHEETS[f.sheet].spacing;
    const w = f.w ?? 1;
    const h = f.h ?? 1;
    if (SHEETS[f.sheet].spacing === 0 || (w === 1 && h === 1)) return new Rectangle(f.col * step, f.row * step, w * TILE, h * TILE);
    // Multi-tile frames on spaced sheets are stitched (see frame()).
    return new Rectangle(f.col * step, f.row * step, w * TILE, h * TILE);
  }

  frame(f: FrameRef): Texture {
    const key = `${f.sheet}:${f.col}:${f.row}:${f.w ?? 1}:${f.h ?? 1}:${f.px ? `${f.px.x},${f.px.y},${f.px.w},${f.px.h}` : ''}`;
    let t = this.frames.get(key);
    if (t) return t;
    const spacing = SHEETS[f.sheet].spacing;
    const w = f.w ?? 1;
    const h = f.h ?? 1;
    if (spacing > 0 && (w > 1 || h > 1) && !f.px) {
      // Stitch tiles together, dropping the 1px gutters between them.
      const cv = document.createElement('canvas');
      cv.width = w * TILE;
      cv.height = h * TILE;
      const ctx = cv.getContext('2d')!;
      const step = TILE + spacing;
      for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
        ctx.drawImage(this.images[f.sheet] as CanvasImageSource, (f.col + tx) * step, (f.row + ty) * step, TILE, TILE, tx * TILE, ty * TILE, TILE, TILE);
      }
      t = Texture.from(cv);
      t.source.scaleMode = 'nearest';
    } else {
      t = new Texture({ source: this.sheets[f.sheet].source, frame: this.rect(f) });
    }
    this.frames.set(key, t);
    return t;
  }

  /** Walk-cycle textures for an outfit: [stand, stepA, stand, stepB] per facing. */
  character(o: Outfit): Record<Facing, Texture[]> {
    const key = `${o.base}:${o.shirtHue}:${o.hairHue}:${o.hairLight}`;
    const cached = this.outfits.get(key);
    if (cached) return cached;
    const out = {} as Record<Facing, Texture[]>;
    for (const facing of ['down', 'up', 'left', 'right'] as Facing[]) {
      const steps = ([0, 1, 2] as const).map((s) => this.recolor(characterFrame(o.base % CHARACTER_BASES, facing, s), o));
      out[facing] = [steps[0], steps[1], steps[0], steps[2]];
    }
    this.outfits.set(key, out);
    return out;
  }

  private portraits = new Map<string, string>();

  /** Front-facing sprite as a data URL, for avatars in the DOM UI. */
  portrait(o: Outfit): string {
    const key = `${o.base}:${o.shirtHue}:${o.hairHue}:${o.hairLight}`;
    let url = this.portraits.get(key);
    if (!url) {
      const cv = this.character(o).down[0].source.resource as HTMLCanvasElement;
      url = cv.toDataURL();
      this.portraits.set(key, url);
    }
    return url;
  }

  private recolor(f: FrameRef, o: Outfit): Texture {
    const cv = document.createElement('canvas');
    cv.width = TILE;
    cv.height = TILE;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    const r = this.rect(f);
    ctx.drawImage(this.images[f.sheet] as CanvasImageSource, r.x, r.y, r.width, r.height, 0, 0, TILE, TILE);
    const img = ctx.getImageData(0, 0, TILE, TILE);
    const d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      if (d[p + 3] < 10) continue;
      const [h, s, l] = rgbToHsl(d[p], d[p + 1], d[p + 2]);
      const y = (p / 4 / TILE) | 0;
      // Skin sits in a narrow warm band; leave it alone so faces stay natural.
      const skin = h > 10 && h < 40 && s > 0.25 && s < 0.75 && l > 0.55 && y >= 3 && y <= 9;
      if (skin || s < 0.18 || l < 0.12) continue;
      const hairZone = y < 6;
      const nh = (h + (hairZone ? o.hairHue : o.shirtHue) + 360) % 360;
      const nl = hairZone ? Math.min(0.9, Math.max(0.08, l * o.hairLight)) : l;
      const [rr, gg, bb] = hslToRgb(nh, s, nl);
      d[p] = rr;
      d[p + 1] = gg;
      d[p + 2] = bb;
    }
    ctx.putImageData(img, 0, 0);
    const t = Texture.from(cv);
    t.source.scaleMode = 'nearest';
    return t;
  }

  /** Small procedural props the Kenney packs don't include, drawn in the same palette. */
  drawn(key: DrawnKey | 'doorMat' | 'counterTop'): Texture {
    const cached = this.custom.get(key);
    if (cached) return cached;
    const cv = document.createElement('canvas');
    const W = key === 'whiteboard' || key === 'chalkboard' ? TILE * 3 : key === 'logs' || key === 'stones' || key === 'sawbench' || key === 'workbench' ? TILE * 2 : TILE;
    cv.width = W;
    cv.height = TILE;
    const g = cv.getContext('2d')!;
    const r = (x: number, y: number, w: number, h: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(x, y, w, h);
    };
    switch (key) {
      case 'monitor':
        r(4, 3, 9, 6, '#2b2f3a');
        r(5, 4, 7, 4, '#5fb3d9');
        r(6, 5, 3, 1, '#d8f1fb');
        r(8, 9, 1, 2, '#2b2f3a');
        r(6, 11, 5, 1, '#2b2f3a');
        r(10, 12, 4, 1, '#3d4250');
        break;
      case 'toilet':
        r(4, 1, 8, 4, '#d9dde3');
        r(4, 1, 8, 1, '#ffffff');
        r(5, 5, 6, 8, '#eef1f4');
        r(6, 6, 4, 5, '#9fb3c2');
        r(5, 13, 6, 1, '#8c96a3');
        break;
      case 'basin':
        r(2, 4, 12, 7, '#eef1f4');
        r(4, 6, 8, 3, '#9fc7dd');
        r(7, 2, 2, 3, '#a7adb5');
        r(2, 11, 12, 1, '#8c96a3');
        break;
      case 'shower':
        r(1, 1, 14, 14, '#cfe3ea');
        r(1, 1, 14, 1, '#ffffff');
        for (let x = 3; x < 14; x += 3) r(x, 4, 1, 9, '#b4cfd9');
        r(7, 7, 2, 2, '#7d8b95');
        break;
      case 'rock':
        // Boulder: lit top-left, shaded bottom-right, dark outline.
        r(3, 5, 10, 9, '#4f4a45');
        r(4, 4, 8, 10, '#4f4a45');
        r(4, 5, 8, 8, '#8d877f');
        r(5, 5, 4, 3, '#b3ada4');
        r(9, 9, 3, 4, '#6f6962');
        r(5, 11, 3, 2, '#6f6962');
        r(3, 14, 10, 1, 'rgba(0,0,0,0.25)');
        break;
      case 'cake':
        // A little layer cake sitting on the tabletop, candles lit.
        r(5, 2, 7, 5, '#f6efe0');
        r(5, 4, 7, 1, '#ea80a6');
        r(5, 6, 7, 1, '#d9c6a8');
        r(6, 0, 1, 2, '#f2c14e');
        r(8, 0, 1, 2, '#f2c14e');
        r(10, 0, 1, 2, '#f2c14e');
        r(4, 7, 9, 1, '#c9bfae');
        break;
      case 'sawbench':
        // Trestle with a log on it and a round saw blade.
        r(2, 8, 28, 3, '#8a5f37');
        r(3, 11, 2, 4, '#5e3d24');
        r(27, 11, 2, 4, '#5e3d24');
        r(4, 5, 16, 3, '#a97a47');
        r(19, 5, 2, 3, '#d4a56a');
        r(22, 2, 7, 7, '#9aa3ad');
        r(23, 3, 5, 5, '#c9d1d8');
        r(25, 5, 1, 1, '#4f4a45');
        break;
      case 'workbench':
        // Bench with a vice, a hammer and a few planks.
        r(1, 7, 30, 3, '#a97a47');
        r(1, 7, 30, 1, '#c08a50');
        r(2, 10, 2, 5, '#6e4a2e');
        r(28, 10, 2, 5, '#6e4a2e');
        r(4, 4, 10, 2, '#d4a56a');
        r(5, 3, 8, 1, '#e0b679');
        r(18, 5, 6, 2, '#5f6870');
        r(20, 3, 2, 2, '#5f6870');
        r(26, 3, 1, 4, '#8a5f37');
        r(25, 2, 3, 2, '#7a7f86');
        break;
      case 'kiln':
        // Brick kiln, fire glowing in its mouth.
        r(2, 3, 12, 12, '#9a5a44');
        r(3, 2, 10, 1, '#9a5a44');
        r(3, 5, 10, 1, '#7a4636');
        r(3, 9, 10, 1, '#7a4636');
        r(5, 9, 6, 5, '#3a2a20');
        r(6, 10, 4, 4, '#e8642a');
        r(7, 11, 2, 3, '#f7d26a');
        r(6, 0, 4, 2, '#6f6962');
        break;
      case 'bonfire':
        // Crossed logs, flames, a few embers.
        r(3, 12, 10, 2, '#5e3d24');
        r(4, 11, 8, 1, '#7a5531');
        r(5, 6, 6, 5, '#e8642a');
        r(6, 4, 4, 3, '#f2a33a');
        r(7, 2, 2, 3, '#f7d26a');
        r(6, 8, 4, 3, '#f7d26a');
        r(4, 9, 1, 2, '#e8642a');
        r(11, 9, 1, 2, '#e8642a');
        r(2, 14, 12, 1, 'rgba(0,0,0,0.25)');
        break;
      case 'grave':
        // Rounded headstone on a low grassy mound.
        r(3, 12, 10, 3, '#4f7d3a');
        r(4, 11, 8, 1, '#5f9a3c');
        r(5, 4, 6, 8, '#8d877f');
        r(6, 3, 4, 1, '#8d877f');
        r(6, 4, 4, 2, '#b3ada4');
        r(6, 7, 4, 1, '#6f6962');
        r(6, 9, 3, 1, '#6f6962');
        r(10, 5, 1, 7, '#6f6962');
        r(4, 4, 1, 8, '#4f4a45');
        r(11, 4, 1, 8, '#4f4a45');
        r(5, 2, 6, 1, '#4f4a45');
        break;
      case 'well':
        // A stone well with a little roof and a winch.
        r(3, 9, 10, 5, '#8d877f');
        r(3, 9, 10, 1, '#b3ada4');
        r(5, 10, 6, 2, '#3f6f8f');
        r(3, 13, 10, 1, '#5f5a54');
        r(4, 3, 1, 7, '#6b4a2e');
        r(11, 3, 1, 7, '#6b4a2e');
        r(2, 2, 12, 2, '#a8574a');
        r(3, 1, 10, 1, '#c76a5a');
        r(6, 6, 4, 1, '#8a5f37');
        r(7, 7, 2, 2, '#7a5230');
        r(2, 14, 12, 1, 'rgba(0,0,0,0.25)');
        break;
      case 'bucket':
        // A wooden pail with a fishing rod leaning on it.
        r(4, 9, 6, 5, '#7a5230');
        r(4, 9, 6, 1, '#a8774a');
        r(5, 11, 4, 1, '#5e3d24');
        r(11, 2, 1, 12, '#8a5f37');
        r(12, 2, 1, 1, '#dcd6c8');
        r(12, 3, 1, 6, 'rgba(220, 214, 200, 0.6)');
        r(3, 14, 8, 1, 'rgba(0,0,0,0.25)');
        break;
      case 'stump':
        r(5, 9, 6, 5, '#5e3d24');
        r(5, 8, 6, 2, '#b98a55');
        r(7, 8, 2, 1, '#8a5f37');
        break;
      case 'crop0':
      case 'crop1':
      case 'crop2':
      case 'crop3': {
        const stage = Number(key[4]);
        // Furrows, then sprouts growing into a ripe golden crop.
        r(0, 5, 16, 1, '#6b4a2f');
        r(0, 11, 16, 1, '#6b4a2f');
        const leaf = stage === 3 ? '#d6b13c' : stage === 2 ? '#5f9a3c' : '#7fbf4f';
        for (const [cx, cy] of [[3, 4], [11, 4], [7, 10], [14, 10], [1, 10]]) {
          if (stage === 0) r(cx, cy, 1, 1, '#7fbf4f');
          else {
            const hgt = stage === 1 ? 2 : 4;
            r(cx, cy - hgt + 1, 1, hgt, stage === 3 ? '#9b8a2a' : '#4a7d2f');
            r(cx - 1, cy - hgt + 1, 3, 1, leaf);
            if (stage === 3) r(cx, cy - hgt - 1, 1, 2, '#e9c74c');
          }
        }
        break;
      }
      case 'crate':
        r(2, 4, 12, 10, '#7a5531');
        r(3, 5, 10, 8, '#a97a47');
        r(3, 8, 10, 1, '#7a5531');
        r(7, 5, 1, 8, '#7a5531');
        break;
      case 'logs':
        for (const [y, x0] of [[9, 1], [9, 11], [5, 6]]) {
          r(x0, y, 14, 5, '#7a5531');
          r(x0, y, 14, 1, '#a97a47');
          r(x0 + 13, y, 2, 5, '#d4a56a');
          r(x0 + 13, y + 2, 1, 1, '#8a5f37');
        }
        break;
      case 'stones':
        for (const [x, y, s] of [[2, 8, 6], [9, 9, 5], [15, 7, 7], [22, 9, 6], [6, 4, 5], [18, 3, 5]]) {
          r(x, y, s, s - 1, '#6f6962');
          r(x + 1, y, s - 2, 2, '#a8a29a');
        }
        break;
      case 'chalkboard':
        r(1, 2, W - 2, 11, '#6b4a2f');
        r(2, 3, W - 4, 9, '#2f4a3a');
        r(5, 5, 12, 1, '#e8e4d8');
        r(5, 8, 18, 1, '#e8e4d8');
        r(28, 5, 8, 4, '#e8e4d8');
        break;
      case 'deskKid':
        r(2, 4, 12, 7, '#b9895a');
        r(2, 4, 12, 2, '#d0a273');
        r(3, 11, 1, 3, '#7a5531');
        r(12, 11, 1, 3, '#7a5531');
        r(5, 6, 5, 3, '#f4f1e8');
        break;
      case 'whiteboard':
        r(1, 2, W - 2, 10, '#8f9aa6');
        r(2, 3, W - 4, 8, '#f4f6f8');
        r(5, 5, 14, 1, '#d1495b');
        r(5, 7, 20, 1, '#3d6fb4');
        r(30, 5, 10, 4, '#3a9a6a');
        r(6, 12, 3, 2, '#5b6470');
        r(W - 9, 12, 3, 2, '#5b6470');
        break;
      case 'coffee':
        r(3, 2, 10, 11, '#3a3633');
        r(4, 3, 8, 3, '#5a524c');
        r(5, 7, 6, 4, '#211e1c');
        r(7, 9, 2, 2, '#f0e8da');
        r(11, 4, 1, 1, '#e05a3a');
        break;
      case 'doorMat':
        r(1, 4, 14, 8, '#7d5b3c');
        r(2, 5, 12, 6, '#946b46');
        break;
      case 'counterTop':
        r(0, 0, 16, 16, '#b78a5c');
        r(0, 0, 16, 3, '#cfd3d8');
        break;
      case 'net':
        r(7, 0, 2, 16, '#f4f6f8');
        break;
    }
    const t = Texture.from(cv);
    t.source.scaleMode = 'nearest';
    this.custom.set(key, t);
    return t;
  }
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
