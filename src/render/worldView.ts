import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Art } from '../assets/loader';
import { CARS, type CarColor, GROUND, PROPS, type PropKey, SHEETS, TILE } from '../assets/manifest';
import { buildCap, stageOf } from '../sim/planner';
import type { Sim } from '../sim/sim';
import type { DrawnKey, Prop, TownMap } from '../world/map';
import { Cell } from '../world/map';
import { Exteriors, wallTone } from './exteriors';
import { Lighting } from './lighting';
import { Smoke } from './particles';
import { chill } from '../sim/seasons';
import { Puddles } from './puddles';
import { Shading } from './shading';

const WALL_TOP = 0xddd0b8;
const WALL_TOP_HI = 0xf1e8d6;
const WALL_FACE = 0xb9a688;
const WALL_FACE_LO = 0x9b8a6e;
const WALL_EDGE = 0x5b4a3a;

/** Cheap stable hash for picking tile variants. */
const vhash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

/**
 * The town's static-ish layers: ground (one canvas, repainted per changed tile), walls,
 * flat props, construction sites, and a y-sorted layer where tall props, agents and cars interleave.
 * Everything stays in sync with the map as the townsfolk chop, farm and build.
 */
export class WorldView {
  readonly root = new Container();
  private groundCanvas: HTMLCanvasElement;
  private groundCtx: CanvasRenderingContext2D;
  private groundTex: Texture;
  readonly walls = new Graphics();
  readonly flat = new Container();
  readonly sites = new Graphics();
  /** Props, agents and vehicles, sorted by their feet. */
  readonly entities = new Container({ sortableChildren: true });
  readonly overlay = new Container();
  /** Baked lawn detail, cast shadows and ambient occlusion (between ground and walls). */
  readonly shading: Shading;
  /** Time-of-day grade and night lights (above entities). */
  readonly lighting: Lighting;
  /** Roofs and front walls, y-sorted with people; fade to show the rooms inside. */
  readonly exteriors: Exteriors;
  /** Chimney smoke, above roofs. */
  readonly smoke = new Smoke();
  /** Rain puddles on paths and pavement; faded in by how wet the ground is. */
  readonly puddles: Puddles;
  /** Season the ground and trees were last painted for. */
  private season = -1;
  private sprites = new Map<number, Sprite>();
  private keys = new Map<number, string>();
  private propVersion = -1;
  private wallVersion = -1;

  constructor(
    readonly art: Art,
    readonly sim: Sim,
  ) {
    const m = sim.map;
    this.groundCanvas = document.createElement('canvas');
    this.groundCanvas.width = m.w * TILE;
    this.groundCanvas.height = m.h * TILE;
    this.groundCtx = this.groundCanvas.getContext('2d')!;
    this.groundCtx.imageSmoothingEnabled = false;
    for (let i = 0; i < m.w * m.h; i++) this.paintGround(i);
    this.groundTex = Texture.from(this.groundCanvas);
    this.groundTex.source.scaleMode = 'nearest';
    this.shading = new Shading(m);
    this.puddles = new Puddles(m);
    this.lighting = new Lighting(m);
    this.root.addChild(new Sprite(this.groundTex), this.puddles.layer, this.shading.layer, this.walls, this.flat, this.sites, this.entities, this.smoke.layer, this.lighting.layer, this.overlay);
    this.parkCars();
    this.exteriors = new Exteriors(art, m, this.entities);
    this.sync();
  }

  get map(): TownMap {
    return this.sim.map;
  }

  private paintGround(i: number): void {
    const m = this.map;
    const x = m.cx(i);
    const y = m.cy(i);
    const variants = GROUND[m.ground[i]];
    const f = variants[vhash(x, y) % variants.length];
    const step = TILE + SHEETS[f.sheet].spacing;
    const img = this.art.image(f.sheet);
    const g = this.groundCtx;
    g.drawImage(img, f.col * step, f.row * step, TILE, TILE, x * TILE, y * TILE, TILE, TILE);
    const kind = m.ground[i];
    const X = x * TILE;
    const Y = y * TILE;
    const spot = (n: number, salt: number) => vhash(x * 7 + n, y * 13 + salt);
    this.paintWear(g, x, y, kind, spot);
    this.paintSeason(g, kind, X, Y, spot, m.room[i] >= 0);
  }

  /** Seasonal cast over open ground: fresh spring green, autumn gold, winter snow. */
  private paintSeason(g: CanvasRenderingContext2D, kind: string, X: number, Y: number, spot: (n: number, salt: number) => number, indoors: boolean): void {
    if (indoors) return;
    const season = Math.max(0, this.season);
    const grassy = kind === 'grass' || kind === 'worn';
    if (season === 0 && grassy) {
      g.fillStyle = 'rgba(150, 225, 95, 0.08)';
      g.fillRect(X, Y, TILE, TILE);
    } else if (season === 2 && grassy) {
      g.fillStyle = 'rgba(214, 156, 58, 0.24)';
      g.fillRect(X, Y, TILE, TILE);
      g.fillStyle = 'rgba(190, 96, 40, 0.5)';
      for (let n = 0; n < 2; n++) g.fillRect(X + (spot(n, 21) % 15), Y + (spot(n, 22) % 15), 1, 1);
    } else if (season === 3 && kind === 'water') {
      // Frozen over: pale ice with a few scratches.
      g.fillStyle = 'rgba(222, 236, 246, 0.72)';
      g.fillRect(X, Y, TILE, TILE);
      g.fillStyle = 'rgba(255, 255, 255, 0.8)';
      g.fillRect(X + (spot(1, 41) % 10), Y + (spot(2, 42) % 14), 5, 1);
    } else if (season === 3) {
      const cover = grassy ? 0.9 : kind === 'trail' || kind === 'dirt' || kind === 'field' || kind === 'sand' ? 0.6 : kind === 'sidewalk' || kind === 'plaza' ? 0.22 : 0;
      if (!cover) return;
      g.fillStyle = `rgba(238, 243, 248, ${cover})`;
      g.fillRect(X, Y, TILE, TILE);
      g.fillStyle = 'rgba(200, 212, 226, 0.7)';
      for (let n = 0; n < 4; n++) g.fillRect(X + (spot(n, 31) % 15), Y + (spot(n, 32) % 15), 2, 1);
      if (cover > 0.8) {
        g.fillStyle = '#ffffff';
        for (let n = 0; n < 3; n++) g.fillRect(X + (spot(n, 33) % 15), Y + (spot(n, 34) % 15), 1, 1);
      }
    }
  }

  private paintWear(g: CanvasRenderingContext2D, x: number, y: number, kind: string, spot: (n: number, salt: number) => number): void {
    const m = this.map;
    if (kind !== 'worn' && kind !== 'trail') return;
    // Bare patches on trampled grass; grass creeping back in at a trail's edges.
    const X = x * TILE;
    const Y = y * TILE;
    if (kind === 'worn') {
      g.fillStyle = 'rgba(150, 112, 70, 0.55)';
      for (let n = 0; n < 9; n++) g.fillRect(X + 2 + (spot(n, 1) % 12), Y + 2 + (spot(n, 2) % 12), 2 + (spot(n, 3) % 2), 1 + (spot(n, 4) % 2));
      return;
    }
    const grassy = (gx: number, gy: number) => m.inBounds(gx, gy) && (m.ground[m.idx(gx, gy)] === 'grass' || m.ground[m.idx(gx, gy)] === 'worn');
    g.fillStyle = '#5e9a3e';
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (!grassy(x + dx, y + dy)) continue;
      for (let n = 0; n < 6; n++) {
        const t = spot(n + dx * 3 + dy * 5, 7) % 14;
        const d = spot(n, 9) % 3;
        const px = dx === 0 ? X + 1 + t : dx < 0 ? X + d : X + TILE - 1 - d;
        const py = dy === 0 ? Y + 1 + t : dy < 0 ? Y + d : Y + TILE - 1 - d;
        g.fillRect(px, py, 1 + (n % 2), 1);
      }
    }
  }

  /** Top-down walls with a lit top face and a short front face where they meet floor below. */
  private drawWalls(): void {
    const m = this.map;
    const g = this.walls.clear();
    const wall = (x: number, y: number) => m.isWall(x, y);
    // Each building's walls take the color of its exterior material, so it's the same house inside and out.
    const tone = new Map<number, [number, number]>();
    for (const b of m.buildings) {
      const t = wallTone(b);
      if (!t) continue;
      for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) tone.set(m.idx(xx, yy), t);
    }
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const i = m.idx(x, y);
        const X = x * TILE;
        const Y = y * TILE;
        if (m.cell[i] === Cell.Door) {
          if (wall(x - 1, y) || wall(x + 1, y)) {
            g.rect(X, Y, 2, TILE).fill(WALL_FACE_LO);
            g.rect(X + TILE - 2, Y, 2, TILE).fill(WALL_FACE_LO);
          } else {
            g.rect(X, Y, TILE, 2).fill(WALL_FACE_LO);
            g.rect(X, Y + TILE - 2, TILE, 2).fill(WALL_FACE_LO);
          }
          continue;
        }
        if (m.cell[i] !== Cell.Wall) continue;
        const face = !wall(x, y + 1) && m.inBounds(x, y + 1);
        const topH = face ? TILE - 6 : TILE;
        const [top, front] = tone.get(i) ?? [WALL_TOP, WALL_FACE];
        g.rect(X, Y, TILE, topH).fill(top);
        if (!wall(x, y - 1)) g.rect(X, Y, TILE, 2).fill(tone.has(i) ? top : WALL_TOP_HI);
        if (face) {
          g.rect(X, Y + topH, TILE, 6).fill(front);
          g.rect(X, Y + TILE - 1, TILE, 1).fill(WALL_FACE_LO);
        }
        if (!wall(x - 1, y)) g.rect(X, Y, 1, TILE).fill(WALL_EDGE);
        if (!wall(x + 1, y)) g.rect(X + TILE - 1, Y, 1, TILE).fill(WALL_EDGE);
        if (!wall(x, y - 1)) g.rect(X, Y, TILE, 1).fill(WALL_EDGE);
        if (!wall(x, y + 1) && !face) g.rect(X, Y + TILE - 1, TILE, 1).fill(WALL_EDGE);
      }
    }
  }

  propTexture(p: Prop): Texture {
    return p.drawn ? this.art.drawn(p.key as DrawnKey) : this.art.frame(PROPS[p.key as PropKey]);
  }

  /** Trees and bushes turn with the seasons: autumn copper, winter frost. */
  private tintFoliage(s: Sprite, key: string): void {
    if (!/^(tree|bush)/.test(key)) return;
    s.tint = this.season === 2 ? 0xffc489 : this.season === 3 ? 0xc6d3df : 0xffffff;
  }

  private addProp(p: Prop): void {
    if (p.w === 0) return; // spot-only markers
    const s = new Sprite(this.propTexture(p));
    this.tintFoliage(s, p.key);
    // Anchor at the bottom of the footprint so tall sprites (trees, lamps) rise above it.
    const footX = p.x * TILE + (p.w * TILE) / 2;
    const footY = (p.y + p.h) * TILE;
    s.anchor.set(0.5, 1);
    s.position.set(footX, footY);
    this.sprites.set(p.id, s);
    this.keys.set(p.id, p.key);
    if (p.flat) {
      this.flat.addChild(s);
      return;
    }
    const onTop = p.drawn && (p.key === 'monitor' || p.key === 'net');
    s.zIndex = onTop ? footY + 1 : footY - (p.blocks ? 0 : 6);
    this.entities.addChild(s);
  }

  /** Per-frame effects: smoke from homes cooking or keeping warm, puddles after rain. dt in real seconds. */
  updateFx(dt: number): void {
    const sim = this.sim;
    const fires = new Set<number>();
    for (const a of sim.agents) {
      if (a.action.kind !== 'cook' || a.action.stage !== 'perform') continue;
      const hh = sim.town.households[a.household];
      if (hh.building >= 0) fires.add(hh.building);
    }
    // In the cold every burning hearth smokes while someone's home.
    if (chill(sim) > 0.3) {
      for (const a of sim.agents) {
        const hh = sim.town.households[a.household];
        if (hh.building >= 0 && sim.fuel[hh.id] > 0 && sim.map.room[a.at] === hh.room) fires.add(hh.building);
      }
    }
    this.smoke.update(dt, this.exteriors.chimneys().filter((c) => fires.has(c.id)));
    const wet = sim.events.wet ?? 0;
    const layer = this.puddles.layer;
    layer.visible = wet > 0.02;
    layer.alpha = Math.min(1, wet * 1.2);
    if (layer.visible) this.puddles.sync();
  }

  /** Bring the scene in line with the map. Cheap when nothing changed. */
  sync(): void {
    const m = this.map;
    if (this.sim.season !== this.season) {
      // A new season repaints the whole ground and recolors the trees.
      this.season = this.sim.season;
      for (let i = 0; i < m.w * m.h; i++) this.paintGround(i);
      // Wear that was waiting to be painted still needs its lawn patch redrawn.
      for (const i of m.groundDirty) {
        this.shading.touch(i);
        this.puddles.touch(i);
      }
      m.groundDirty.length = 0;
      this.groundTex.source.update();
      this.shading.season = this.season;
      this.exteriors.setSnow(this.season === 3);
      for (const [id, s] of this.sprites) this.tintFoliage(s, this.keys.get(id) ?? '');
    }
    if (m.groundDirty.length) {
      for (const i of m.groundDirty) {
        this.paintGround(i);
        this.shading.touch(i);
        this.puddles.touch(i);
      }
      m.groundDirty.length = 0;
      this.groundTex.source.update();
    }
    if (m.wallVersion !== this.wallVersion) {
      this.wallVersion = m.wallVersion;
      this.drawWalls();
    }
    if (m.propVersion !== this.propVersion) {
      this.propVersion = m.propVersion;
      const live = new Set<number>();
      for (const p of m.props) {
        live.add(p.id);
        if (!this.sprites.has(p.id)) this.addProp(p);
      }
      for (const [id, s] of this.sprites) {
        if (live.has(id)) continue;
        s.destroy();
        this.sprites.delete(id);
        this.keys.delete(id);
      }
    }
    // Crops change texture as they grow; that doesn't bump the prop version.
    for (const p of m.props) {
      if (p.use !== 'farm') continue;
      if (this.keys.get(p.id) !== p.key) {
        this.keys.set(p.id, p.key);
        const s = this.sprites.get(p.id);
        if (s) s.texture = this.propTexture(p);
      }
    }
    this.exteriors.sync();
    this.drawSites();
  }

  /** Stakes and string, then a foundation, material piles and rising walls as work progresses. */
  private drawSites(): void {
    const g = this.sites.clear();
    for (const pr of this.sim.projects) {
      const X = pr.x * TILE;
      const Y = pr.y * TILE;
      const W = pr.w * TILE;
      const H = pr.h * TILE;
      const stage = stageOf(this.sim, pr);
      const p = pr.progress / pr.work;
      // Survey string around the plot.
      g.rect(X - 1, Y - 1, W + 2, H + 2).stroke({ color: 0xf0e2b6, width: 1, alpha: 0.9 });
      for (const [cx, cy] of [[X, Y], [X + W, Y], [X, Y + H], [X + W, Y + H]]) g.rect(cx - 2, cy - 5, 3, 6).fill(0xa97a47);
      if (stage !== 'clearing') {
        g.rect(X + 2, Y + 2, W - 4, H - 4).fill({ color: 0x8a6a4a, alpha: 0.25 + p * 0.2 });
        // Walls go up in proportion to progress.
        if (p > 0.05) {
          const t = Math.max(2, Math.round(3 + p * 9));
          g.rect(X, Y + H - t, W, t).fill({ color: WALL_FACE, alpha: 0.9 });
          g.rect(X, Y, 3, H).fill({ color: WALL_TOP, alpha: 0.4 + p * 0.5 });
          g.rect(X + W - 3, Y, 3, H).fill({ color: WALL_TOP, alpha: 0.4 + p * 0.5 });
          if (p > 0.5) g.rect(X, Y, W, 3).fill({ color: WALL_TOP, alpha: (p - 0.5) * 2 });
          // Scaffolding poles.
          for (let x = X + 12; x < X + W - 4; x += 24) g.rect(x, Y + 2, 2, H - 4).fill({ color: 0x7a5531, alpha: 0.7 });
        }
        // Material piles next to the site.
        const pile = (g: 'wood' | 'stone') => Math.min(5, Math.floor(Math.max(0, (pr.delivered[g] ?? 0) - (pr.progress / pr.work) * (pr.need[g] ?? 0)) / 6));
        const logs = pile('wood');
        const stones = pile('stone');
        for (let k = 0; k < logs; k++) g.rect(X + 4 + k * 5, Y + H - 9, 4, 6).fill(0x9b6a3c).rect(X + 4 + k * 5, Y + H - 9, 4, 1).fill(0xd4a56a);
        for (let k = 0; k < stones; k++) g.rect(X + W - 9 - k * 5, Y + H - 8, 4, 4).fill(0x8d877f);
      }
      // Progress bar above the plot.
      const cap = buildCap(pr) / pr.work;
      g.rect(X - 1, Y - 7, W + 2, 5).fill({ color: 0x15110d, alpha: 0.7 });
      g.rect(X, Y - 6, W * cap, 3).fill({ color: 0xf2c14e, alpha: 0.3 });
      g.rect(X, Y - 6, W * p, 3).fill(0xf2c14e);
    }
  }

  private parkCars(): void {
    const colors: CarColor[] = ['green', 'gray', 'orange', 'gray', 'green'];
    colors.forEach((c, k) => {
      const s = new Sprite(this.art.frame(CARS[c].down));
      s.anchor.set(0.5, 1);
      const x = (47.5 + k * 2.8) * TILE;
      const y = 46 * TILE;
      s.position.set(x, y);
      s.zIndex = y;
      this.entities.addChild(s);
    });
    const lines = new Graphics();
    for (let k = 0; k < 6; k++) lines.rect((46.2 + k * 2.8) * TILE, 43.5 * TILE, 1, 3 * TILE).fill(0xe8e8e8);
    this.flat.addChild(lines);
  }
}
