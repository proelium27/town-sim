import { Container, Graphics, Sprite } from 'pixi.js';
import type { Art } from '../assets/loader';
import { EXTERIOR, type FrameRef, TILE } from '../assets/manifest';
import type { Building, TownMap } from '../world/map';

type Wall = 'brick' | 'stone' | 'sand' | 'glass' | 'plank';
type Win = 'wood' | 'wood4' | 'steel' | 'steel4' | 'arch' | 'none';
type Icon = 'book' | 'bell' | 'bowl' | 'crate';

/** How one building looks from outside. */
interface Look {
  roof: 'pitched' | 'flat';
  roofColor: number;
  wall: Wall;
  window: Win;
  door: 'wood' | 'green' | 'orange' | 'glass' | 'barn';
  awning?: 'green' | 'orange';
  sign?: FrameRef | Icon;
  chimney?: boolean;
  ac?: number;
  /** Rows of front wall visible below the roof. */
  facade: number;
}

/** Warm, slightly dusty roof colors so the town reads as a patchwork, not a grid. */
const HOUSE_ROOFS = [0xc0644a, 0x6d7d95, 0x7a955c, 0x96678a, 0xc8a066, 0x8c5c45, 0x5f8a8a];
const WALLS: Wall[] = ['brick', 'sand', 'stone', 'brick', 'sand'];
const EDGE = 0x15110d;

const hash = (n: number, salt: number): number => {
  let h = (n * 374761393 + salt * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const pick = <T>(arr: readonly T[], n: number, salt: number): T => arr[Math.floor(hash(n, salt) * arr.length)];

/** Multiplies an RGB hex by f (0..2), clamped. */
function shade(c: number, f: number): number {
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((c >> s) & 255) * f)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function lookFor(b: Building): Look | null {
  switch (b.kind) {
    case 'house':
      return {
        roof: 'pitched', roofColor: pick(HOUSE_ROOFS, b.id, 1), wall: pick(WALLS, b.id, 2),
        window: hash(b.id, 3) < 0.5 ? 'wood' : 'wood4', door: pick(['wood', 'green', 'orange'] as const, b.id, 4),
        chimney: true, facade: 3,
      };
    case 'office':
      return { roof: 'flat', roofColor: 0xb4b8bc, wall: 'glass', window: 'none', door: 'glass', ac: 5, facade: 3 };
    case 'cafe':
      return b.name.includes('Diner')
        ? { roof: 'pitched', roofColor: 0xb8574a, wall: 'sand', window: 'steel4', door: 'glass', awning: 'orange', sign: 'bowl', facade: 3 }
        : { roof: 'flat', roofColor: 0xd9c39c, wall: 'sand', window: 'steel4', door: 'glass', awning: 'green', sign: EXTERIOR.signCafe, ac: 1, facade: 3 };
    case 'market':
      return { roof: 'flat', roofColor: 0xc7bfb2, wall: 'sand', window: 'steel', door: 'glass', awning: 'orange', sign: EXTERIOR.signRetail, ac: 3, facade: 3 };
    case 'library':
      return { roof: 'pitched', roofColor: 0x5b6a80, wall: 'stone', window: 'arch', door: 'wood', sign: 'book', facade: 3 };
    case 'school':
      return { roof: 'pitched', roofColor: 0xb5583f, wall: 'brick', window: 'wood4', door: 'green', sign: 'bell', chimney: true, facade: 3 };
    case 'storehouse':
      return { roof: 'pitched', roofColor: 0x7a5a3e, wall: 'plank', window: 'none', door: 'barn', sign: 'crate', facade: 2 };
    default:
      // Farms and parks are open-air.
      return null;
  }
}

/** Cutaway wall colors (top face, front face) matching each exterior material. */
const WALL_TONE: Record<Wall, [number, number]> = {
  brick: [0xc98a72, 0xa0604a],
  stone: [0xc2c0ba, 0x96938c],
  sand: [0xe4d3ad, 0xbfa97f],
  glass: [0xc9d3da, 0x9aa8b2],
  plank: [0xb08a62, 0x84603f],
};

/** Top and front-face colors for this building's cutaway walls, or null to keep the default. */
export function wallTone(b: Building): [number, number] | null {
  const look = lookFor(b);
  return look ? WALL_TONE[look.wall] : null;
}

const WALL_FRAME: Record<Wall, FrameRef[]> = {
  brick: [EXTERIOR.wallBrick],
  stone: [EXTERIOR.wallStone],
  sand: [EXTERIOR.wallSand],
  glass: [EXTERIOR.wallGlass, EXTERIOR.wallGlass2],
  plank: [EXTERIOR.wallPlank],
};

interface Exterior {
  b: Building;
  view: Container;
  alpha: number;
  /** Lit-window rectangles in world px, for night lighting while the roof is on. */
  windows: { x: number; y: number; w: number; h: number }[];
}

/**
 * 3/4-view building exteriors: a roof over the footprint and a front wall with windows, doors,
 * awnings and signs along its south edge. Each is y-sorted by its front edge in the entities
 * layer, so people inside are covered and people on the street walk in front. Roofs fade to
 * reveal the rooms when you zoom in, select someone inside, or turn roofs off.
 */
export class Exteriors {
  private list: Exterior[] = [];
  private count = -1;

  constructor(
    readonly art: Art,
    readonly map: TownMap,
    readonly parent: Container,
  ) {
    this.sync();
  }

  /** Builds exteriors for any buildings that have appeared since last time. */
  sync(): void {
    if (this.count === this.map.buildings.length) return;
    this.count = this.map.buildings.length;
    const have = new Set(this.list.map((e) => e.b.id));
    for (const b of this.map.buildings) {
      if (have.has(b.id)) continue;
      const look = lookFor(b);
      if (!look) continue;
      this.list.push(this.build(b, look));
    }
  }

  /** Roof opacity covering tile (x, y): 0 when open or outdoors. */
  coverAt(x: number, y: number): number {
    for (const e of this.list) {
      const b = e.b;
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return e.alpha;
    }
    return 0;
  }

  buildingAt(x: number, y: number): Building | undefined {
    return this.list.find((e) => x >= e.b.x && x < e.b.x + e.b.w && y >= e.b.y && y < e.b.y + e.b.h)?.b;
  }

  /** Rooms currently hidden under a roof, so lighting glows through windows instead of the floor. */
  roofedRooms(): Set<number> {
    const out = new Set<number>();
    for (const e of this.list) if (e.alpha > 0.5) for (const r of e.b.rooms) out.add(r);
    return out;
  }

  /** Window rectangles of roofed buildings, tagged with the rooms behind them. */
  litWindows(): { x: number; y: number; w: number; h: number; rooms: number[] }[] {
    return this.list.filter((e) => e.alpha > 0.5).flatMap((e) => e.windows.map((w) => ({ ...w, rooms: e.b.rooms })));
  }

  /**
   * @param open buildings whose roof should lift (the selected person is inside).
   * @param seeInside every roof lifts (zoomed in, or roofs toggled off).
   */
  update(dt: number, open: Set<number>, seeInside: boolean): void {
    const k = Math.min(1, dt * 9);
    for (const e of this.list) {
      const target = seeInside || open.has(e.b.id) ? 0 : 1;
      e.alpha += (target - e.alpha) * k;
      if (Math.abs(target - e.alpha) < 0.01) e.alpha = target;
      e.view.alpha = e.alpha;
      e.view.visible = e.alpha > 0.01;
    }
  }

  // ---------------------------------------------------------------- drawing

  private build(b: Building, look: Look): Exterior {
    const T = TILE;
    const F = Math.min(look.facade, b.h - 2);
    const X = b.x * T;
    const Y = b.y * T;
    const W = b.w * T;
    const roofH = (b.h - F) * T;
    const fy = Y + roofH;
    const view = new Container();
    const windows: Exterior['windows'] = [];
    const doorTop = b.door.y < b.y;
    const doorX = b.door.x;
    const doorW = look.door === 'glass' || look.door === 'barn' ? 2 : 1;
    const sprite = (f: FrameRef, x: number, y: number, tint?: number) => {
      const s = new Sprite(this.art.frame(f));
      s.position.set(x, y);
      if (tint !== undefined) s.tint = tint;
      view.addChild(s);
      return s;
    };

    // ---- front wall
    const wallFrames = WALL_FRAME[look.wall];
    for (let r = 0; r < F; r++) for (let c = 0; c < b.w; c++) sprite(wallFrames[(c + r) % wallFrames.length], X + c * T, fy + r * T);
    const g = new Graphics();
    view.addChild(g);
    // Corner posts and a plinth so the wall reads as a solid block.
    g.rect(X, fy, 2, F * T).fill({ color: EDGE, alpha: 0.35 });
    g.rect(X + W - 2, fy, 2, F * T).fill({ color: EDGE, alpha: 0.45 });
    g.rect(X, fy + F * T - 3, W, 3).fill({ color: shade(0x8a8178, 0.8) });
    g.rect(X, fy + F * T - 1, W, 1).fill(EDGE);

    // ---- windows (centered in each storey, skipping the door bay)
    const inDoor = (col: number) => !doorTop && col >= doorX - 1 && col <= doorX + doorW;
    const storeys = F >= 3 ? [fy + T * 0.5, fy + T * 1.5] : [fy + T * 0.5];
    if (look.window !== 'none') {
      for (let col = b.x + 1; col < b.x + b.w - 1; col++) {
        if ((col - b.x) % 2 === 0 || inDoor(col)) continue;
        for (const wy of storeys) {
          if (look.window === 'arch') {
            sprite(EXTERIOR.winArchTop, col * T, wy - 8);
            sprite(EXTERIOR.winArchBottom, col * T, wy + 8);
            windows.push({ x: col * T + 4, y: wy - 4, w: 8, h: 22 });
          } else {
            const f = look.window === 'wood' ? EXTERIOR.winWood : look.window === 'wood4' ? EXTERIOR.winWood4 : look.window === 'steel' ? EXTERIOR.winSteel : EXTERIOR.winSteel4;
            sprite(f, col * T, wy - 8 + (F >= 3 ? 0 : 4));
            windows.push({ x: col * T + 3, y: wy - 4 + (F >= 3 ? 0 : 4), w: 10, h: 10 });
          }
        }
      }
    } else if (look.wall === 'glass') {
      // The curtain wall is all window.
      windows.push({ x: X + 4, y: fy + 4, w: W - 8, h: F * T - 10 });
    }

    // ---- awning and sign over the shopfront
    if (look.awning) {
      const frame = look.awning === 'green' ? EXTERIOR.awningGreen : EXTERIOR.awningOrange;
      const ay = fy + (F - 1) * T - 10;
      for (let c = 1; c < b.w - 1; c++) sprite(frame, X + c * T, ay);
      g.rect(X + T, ay + 15, W - 2 * T, 2).fill({ color: EDGE, alpha: 0.25 });
    }
    if (look.sign) {
      const sx = (doorTop ? b.x + b.w / 2 : doorX + doorW / 2) * T;
      if (typeof look.sign === 'object') {
        const f = look.sign;
        const s = sprite(f, Math.round(sx - (f.px?.w ?? 16) / 2), fy + 3);
        s.zIndex = 1;
      } else {
        this.iconSign(g, look.sign, Math.round(sx + doorW * 8 + 6), fy + (F - 1) * T - 2);
      }
    }

    // ---- door (north-facing doors get a little porch on the roof edge instead)
    if (!doorTop) {
      const dy = fy + (F - 1) * T;
      if (look.door === 'glass') {
        sprite(EXTERIOR.doorGlassL, doorX * T, dy);
        sprite(EXTERIOR.doorGlassR, (doorX + 1) * T, dy);
      } else if (look.door === 'barn') {
        this.barnDoor(g, doorX * T, dy - 4, 2 * T, T + 4);
      } else {
        sprite(look.door === 'green' ? EXTERIOR.doorGreen : look.door === 'orange' ? EXTERIOR.doorOrange : EXTERIOR.doorBrown, doorX * T, dy);
      }
      // Door light.
      g.rect(doorX * T + (doorW * T) / 2 - 1, dy - 3, 2, 2).fill(0xffe2a0);
    }

    // ---- roof
    const roof = new Graphics();
    view.addChild(roof);
    if (look.roof === 'pitched') this.pitched(roof, X, Y, W, roofH, look.roofColor);
    else {
      // Flat roofs are drawn, not tiled: a tinted tile can only get darker than the sheet's gray.
      roof.rect(X, Y, W, roofH).fill(look.roofColor);
      this.parapet(roof, X, Y, W, roofH, look.roofColor);
      this.gravel(roof, X, Y, W, roofH, look.roofColor, b.id);
      if (b.w >= 10) this.skylights(roof, X, Y, W, roofH);
      for (let k = 0; k < (look.ac ?? 0); k++) {
        const ax = X + T + Math.floor(hash(b.id, 10 + k) * Math.max(1, b.w - 3)) * T;
        const ay2 = Y + T * 0.5 + Math.floor(hash(b.id, 20 + k) * Math.max(1, roofH / T - 2)) * T;
        const s = new Sprite(this.art.frame(k % 2 ? EXTERIOR.vent : EXTERIOR.acUnit));
        s.position.set(ax, ay2);
        view.addChild(s);
      }
    }
    // Eave shadow on the top of the wall.
    g.rect(X, fy, W, 3).fill({ color: EDGE, alpha: 0.32 });
    view.setChildIndex(g, view.children.length - 1);
    if (look.chimney) this.chimney(view, X + Math.round(W * (hash(b.id, 30) < 0.5 ? 0.72 : 0.22)), Y + Math.round(roofH * 0.18), look.roofColor);
    if (doorTop) this.porch(view, doorX * T, Y, look);

    view.zIndex = (b.y + b.h) * T + 0.25;
    view.cacheAsTexture(true);
    this.parent.addChild(view);
    return { b, view, alpha: 1, windows };
  }

  /** Shingled gable roof seen from the south: lit upper slope, shaded lower slope, ridge, eave. */
  private pitched(g: Graphics, X: number, Y: number, W: number, H: number, c: number): void {
    const ridge = Y + Math.max(6, Math.round(H * 0.3));
    g.rect(X, Y, W, ridge - Y).fill(shade(c, 0.78));
    g.rect(X, ridge, W, Y + H - ridge).fill(c);
    // A soft sunlit band just under the ridge, fading down the slope.
    g.rect(X, ridge + 2, W, Math.round((Y + H - ridge) * 0.35)).fill({ color: shade(c, 1.25), alpha: 0.35 });
    // Shingle courses with staggered seams; tighter on the foreshortened back slope.
    for (let y = Y + 2, row = 0; y < Y + H - 2; row++) {
      const front = y > ridge;
      g.rect(X + 1, y, W - 2, 1).fill({ color: shade(c, front ? 0.72 : 0.6), alpha: 0.9 });
      for (let x = X + 2 + (row % 2) * 3; x < X + W - 2; x += 6) g.rect(x, y - (front ? 3 : 2), 1, front ? 3 : 2).fill({ color: shade(c, front ? 0.8 : 0.66), alpha: 0.7 });
      y += front ? 4 : 3;
    }
    // Ridge cap catches the light; a dark line where the slopes meet.
    g.rect(X, ridge - 2, W, 3).fill(shade(c, 1.35));
    g.rect(X, ridge + 1, W, 1).fill({ color: shade(c, 0.55), alpha: 0.6 });
    g.rect(X, Y, 3, H).fill({ color: shade(c, 0.78) });
    g.rect(X + W - 3, Y, 3, H).fill({ color: shade(c, 0.7) });
    // Eave overhang lip and outline.
    g.rect(X - 1, Y + H - 3, W + 2, 3).fill(shade(c, 0.62));
    g.rect(X, Y, W, 1).fill(shade(c, 1.35));
    g.rect(X - 1, Y - 1, W + 2, H + 2).stroke({ color: EDGE, width: 1, alignment: 0 });
  }

  /** Flat roof edge: a raised lip, lit on top and shaded at the front. */
  private parapet(g: Graphics, X: number, Y: number, W: number, H: number, c: number): void {
    g.rect(X, Y, W, 3).fill(shade(c, 1.25));
    g.rect(X, Y, 3, H).fill(shade(c, 1.1));
    g.rect(X + W - 3, Y, 3, H).fill(shade(c, 0.85));
    g.rect(X, Y + H - 4, W, 4).fill(shade(c, 0.7));
    g.rect(X + 3, Y + 3, W - 6, 1).fill({ color: EDGE, alpha: 0.25 });
    g.rect(X - 1, Y - 1, W + 2, H + 2).stroke({ color: EDGE, width: 1, alignment: 0 });
  }

  /** Tar-and-gravel speckle so big flat roofs don't read as blank slabs. */
  private gravel(g: Graphics, X: number, Y: number, W: number, H: number, c: number, seed: number): void {
    for (let y = Y + 5; y < Y + H - 5; y += 2) {
      for (let x = X + 4; x < X + W - 4; x += 2) {
        const r = hash(seed * 7919 + x * 31 + y, 5);
        if (r < 0.035) g.rect(x, y, 1, 1).fill({ color: shade(c, 0.8), alpha: 0.7 });
      }
    }
    // Seams between roofing sheets.
    for (let x = X + 32; x < X + W - 8; x += 32) g.rect(x, Y + 4, 1, H - 8).fill({ color: shade(c, 0.82), alpha: 0.6 });
  }

  /** A row of glass skylights down the middle of a big roof. */
  private skylights(g: Graphics, X: number, Y: number, W: number, H: number): void {
    const y = Y + Math.round(H * 0.45) - 5;
    for (let x = X + 24; x + 18 < X + W - 20; x += 40) {
      g.rect(x - 1, y - 1, 20, 12).fill(0x6f757c);
      g.rect(x, y, 18, 10).fill(0x9cc6d8);
      g.rect(x, y, 18, 3).fill(0xd8eef5);
      g.rect(x + 8, y, 2, 10).fill(0x6f757c);
    }
  }

  private chimney(view: Container, x: number, y: number, roof: number): void {
    const g = new Graphics();
    g.rect(x, y, 8, 11).fill(0x9a5a44);
    g.rect(x, y, 8, 2).fill(0x5e5a56);
    g.rect(x + 1, y + 4, 6, 1).fill(0x7a4636);
    g.rect(x + 1, y + 8, 6, 1).fill(0x7a4636);
    g.rect(x - 1, y + 10, 10, 2).fill({ color: shade(roof, 0.55), alpha: 0.6 });
    g.rect(x - 1, y - 1, 10, 12).stroke({ color: EDGE, width: 1, alignment: 0 });
    view.addChild(g);
  }

  /** A north-facing door seen over the roof: a small gabled porch at the roof's top edge. */
  private porch(view: Container, x: number, Y: number, look: Look): void {
    const g = new Graphics();
    const c = shade(look.roofColor, 0.95);
    g.rect(x - 1, Y - 5, 18, 7).fill(c);
    g.rect(x - 1, Y - 5, 18, 2).fill(shade(look.roofColor, 1.25));
    g.rect(x + 5, Y - 2, 6, 3).fill(0x3a2a20);
    g.rect(x - 2, Y - 6, 20, 9).stroke({ color: EDGE, width: 1, alignment: 0 });
    view.addChild(g);
  }

  private barnDoor(g: Graphics, x: number, y: number, w: number, h: number): void {
    g.rect(x + 2, y, w - 4, h).fill(0x6e4a2e);
    for (let k = x + 4; k < x + w - 4; k += 4) g.rect(k, y + 1, 1, h - 2).fill(0x5a3c25);
    g.moveTo(x + 3, y + 1).lineTo(x + w - 3, y + h - 1).moveTo(x + w - 3, y + 1).lineTo(x + 3, y + h - 1).stroke({ color: 0xa97a47, width: 2 });
    g.rect(x + 2, y, w - 4, h).stroke({ color: EDGE, width: 1, alignment: 0 });
  }

  /** Hanging blade sign with a little pixel icon. */
  private iconSign(g: Graphics, icon: Icon, x: number, y: number): void {
    g.rect(x - 1, y - 10, 2, 3).fill(0x3a3430);
    g.rect(x - 7, y - 8, 14, 10).fill(0xf0e2c0);
    g.rect(x - 7, y - 8, 14, 10).stroke({ color: EDGE, width: 1, alignment: 0 });
    const ic = (dx: number, dy: number, w: number, h: number, c: number) => g.rect(x + dx, y + dy, w, h).fill(c);
    switch (icon) {
      case 'book':
        ic(-4, -6, 4, 6, 0x5b6a80);
        ic(0, -6, 4, 6, 0x7a8aa0);
        ic(-1, -6, 1, 6, 0x2a2420);
        break;
      case 'bell':
        ic(-3, -6, 6, 5, 0xd9a52b);
        ic(-4, -2, 8, 1, 0xb58420);
        ic(-1, -1, 2, 1, 0x6a4a1a);
        break;
      case 'bowl':
        ic(-4, -3, 8, 3, 0xc8573a);
        ic(-3, -6, 1, 2, 0x9a9590);
        ic(0, -7, 1, 3, 0x9a9590);
        ic(2, -6, 1, 2, 0x9a9590);
        break;
      case 'crate':
        ic(-4, -6, 8, 6, 0xa97a47);
        ic(-4, -3, 8, 1, 0x7a5531);
        ic(-1, -6, 1, 6, 0x7a5531);
        break;
    }
  }
}
