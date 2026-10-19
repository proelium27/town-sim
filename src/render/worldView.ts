import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Art } from '../assets/loader';
import { CARS, type CarColor, GROUND, PROPS, type PropKey, TILE } from '../assets/manifest';
import type { DrawnKey, Prop, TownMap } from '../world/map';
import { Cell } from '../world/map';
import { Lighting } from './lighting';
import { Shading } from './shading';

const WALL_TOP = 0xddd0b8;
const WALL_TOP_HI = 0xf1e8d6;
const WALL_FACE = 0xb9a688;
const WALL_FACE_LO = 0x9b8a6e;
const WALL_EDGE = 0x5b4a3a;

/** Cheap stable hash for picking tile variants. */
const vhash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

/**
 * Static town layers (ground, walls, flat props) baked once, plus a y-sorted layer
 * where tall props, agents and cars interleave correctly.
 */
export class WorldView {
  readonly root = new Container();
  readonly ground = new Container();
  readonly walls = new Graphics();
  readonly flat = new Container();
  /** Props, agents and vehicles, sorted by their feet. */
  readonly entities = new Container({ sortableChildren: true });
  readonly overlay = new Container();
  /** Baked lawn detail, cast shadows and ambient occlusion (between ground and walls). */
  readonly shading: Shading;
  /** Time-of-day grade and night lights (above entities). */
  readonly lighting: Lighting;

  constructor(
    readonly art: Art,
    readonly map: TownMap,
  ) {
    this.shading = new Shading(map);
    this.lighting = new Lighting(map);
    this.root.addChild(this.ground, this.shading.layer, this.walls, this.flat, this.entities, this.lighting.layer, this.overlay);
    this.buildGround();
    this.buildWalls();
    for (const p of map.props) this.addProp(p);
    this.parkCars();
    this.ground.cacheAsTexture(true);
    this.flat.cacheAsTexture(true);
  }

  private buildGround(): void {
    const m = this.map;
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const variants = GROUND[m.ground[m.idx(x, y)]];
        const f = variants[vhash(x, y) % variants.length];
        const s = new Sprite(this.art.frame(f));
        s.position.set(x * TILE, y * TILE);
        this.ground.addChild(s);
      }
    }
  }

  /** Top-down walls with a lit top face and a short front face where they meet floor below. */
  private buildWalls(): void {
    const m = this.map;
    const g = this.walls;
    const wall = (x: number, y: number) => m.isWall(x, y);
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const i = m.idx(x, y);
        const X = x * TILE;
        const Y = y * TILE;
        if (m.cell[i] === Cell.Door) {
          // Door frame posts on whichever sides have wall.
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
        g.rect(X, Y, TILE, topH).fill(WALL_TOP);
        if (!wall(x, y - 1)) g.rect(X, Y, TILE, 2).fill(WALL_TOP_HI);
        if (face) {
          g.rect(X, Y + topH, TILE, 6).fill(WALL_FACE);
          g.rect(X, Y + TILE - 1, TILE, 1).fill(WALL_FACE_LO);
        }
        // Dark outline wherever the wall meets something that isn't wall.
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

  private addProp(p: Prop): void {
    if (p.w === 0) return; // spot-only markers
    const tex = this.propTexture(p);
    const s = new Sprite(tex);
    // Anchor at the bottom of the footprint so tall sprites (trees, lamps) rise above it.
    const footX = p.x * TILE + (p.w * TILE) / 2;
    const footY = (p.y + p.h) * TILE;
    s.anchor.set(0.5, 1);
    s.position.set(footX, footY);
    if (p.flat) {
      this.flat.addChild(s);
      return;
    }
    // Monitors and nets sit on top of furniture; nudge their sort key so they draw above it.
    const onTop = p.drawn && (p.key === 'monitor' || p.key === 'net');
    s.zIndex = onTop ? footY + 1 : footY - (p.blocks ? 0 : 6);
    this.entities.addChild(s);
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
