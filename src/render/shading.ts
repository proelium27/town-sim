import { Container, Graphics } from 'pixi.js';
import { TILE } from '../assets/manifest';
import { Cell, type TownMap } from '../world/map';

const SHADOW = 0x1d2a20;
const AO = 0x2a2016;
const TUFT_LIGHT = 0x8fcc5c;
const TUFT_DARK = 0x3f7f3a;
const PATCH_DARK = 0x2f5f2c;
const PATCH_LIGHT = 0xd8f08a;
const PETALS = [0xfbf6e9, 0xf6d24a, 0xf29ab8, 0xb9a4f0];

/** Stable per-cell hash in [0, 1). */
const hash = (x: number, y: number, salt = 0): number => {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Smooth value noise on a coarse lattice, for lawn patches that span several tiles. */
function noise(x: number, y: number, scale: number): number {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, 7);
  const b = hash(x0 + 1, y0, 7);
  const c = hash(x0, y0 + 1, 7);
  const d = hash(x0 + 1, y0 + 1, 7);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Baked depth for the town: lawn texture and flowers, building shadows cast to the south-east,
 * ambient occlusion where floors meet walls, and contact shadows under props. Sits between the
 * ground and the walls. The town changes as people chop and build, so each part rebuilds only
 * when its own inputs change: the lawn and building shadows when ground or walls do (rare),
 * prop shadows when trees fall or furniture appears (often, and cheap).
 */
export class Shading {
  readonly layer = new Container();
  private lawnG = new Graphics();
  private wallG = new Graphics();
  private propG = new Graphics();
  private keys = { lawn: '', walls: '', props: '' };

  constructor(readonly map: TownMap) {
    this.layer.addChild(this.lawnG, this.wallG, this.propG);
    this.sync();
  }

  sync(): void {
    const m = this.map;
    const lawn = `${m.groundVersion}:${m.wallVersion}`;
    if (lawn !== this.keys.lawn) {
      this.keys.lawn = lawn;
      this.lawn(this.lawnG.clear());
    }
    const walls = `${m.wallVersion}`;
    if (walls !== this.keys.walls) {
      this.keys.walls = walls;
      const g = this.wallG.clear();
      this.buildingShadows(g);
      this.ambientOcclusion(g);
    }
    const props = `${m.propVersion}`;
    if (props !== this.keys.props) {
      this.keys.props = props;
      this.propShadows(this.propG.clear());
    }
  }

  private outdoorGrass(x: number, y: number): boolean {
    const m = this.map;
    if (!m.inBounds(x, y)) return false;
    const i = m.idx(x, y);
    return m.ground[i] === 'grass' && m.cell[i] === Cell.Open && m.room[i] < 0;
  }

  /** Broad light/dark patches, then scattered tufts and the odd flower. */
  private lawn(g: Graphics): void {
    const m = this.map;
    const H = TILE / 2;
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        if (!this.outdoorGrass(x, y)) continue;
        const X = x * TILE;
        const Y = y * TILE;
        for (let q = 0; q < 4; q++) {
          const qx = q & 1;
          const qy = q >> 1;
          const n = noise(x * 2 + qx, y * 2 + qy, 9) * 0.7 + noise(x * 2 + qx, y * 2 + qy, 3.5) * 0.3;
          if (n < 0.42) g.rect(X + qx * H, Y + qy * H, H, H).fill({ color: PATCH_DARK, alpha: (0.42 - n) * 0.32 });
          else if (n > 0.6) g.rect(X + qx * H, Y + qy * H, H, H).fill({ color: PATCH_LIGHT, alpha: (n - 0.6) * 0.22 });
        }
        const r = hash(x, y);
        const tufts = r < 0.35 ? 2 : r < 0.75 ? 1 : 0;
        for (let k = 0; k < tufts; k++) {
          const tx = X + 2 + Math.floor(hash(x, y, 11 + k) * (TILE - 5));
          const ty = Y + 3 + Math.floor(hash(x, y, 23 + k) * (TILE - 6));
          g.rect(tx, ty + 1, 1, 2).fill(TUFT_DARK);
          g.rect(tx + 2, ty + 1, 1, 2).fill(TUFT_DARK);
          g.rect(tx + 1, ty, 1, 3).fill(TUFT_LIGHT);
        }
        if (hash(x, y, 41) < 0.055) {
          const fx = X + 3 + Math.floor(hash(x, y, 43) * (TILE - 7));
          const fy = Y + 3 + Math.floor(hash(x, y, 47) * (TILE - 7));
          const petal = PETALS[Math.floor(hash(x, y, 53) * PETALS.length)];
          g.rect(fx, fy + 2, 1, 1).fill(TUFT_DARK);
          g.rect(fx - 1, fy, 1, 1).fill(petal);
          g.rect(fx + 1, fy, 1, 1).fill(petal);
          g.rect(fx, fy - 1, 1, 1).fill(petal);
          g.rect(fx, fy + 1, 1, 1).fill(petal);
          g.rect(fx, fy, 1, 1).fill(0xf2b33d);
        }
      }
    }
  }

  /** Walls throw a short shadow down and to the right onto whatever is outside them. */
  private buildingShadows(g: Graphics): void {
    const m = this.map;
    const DOWN = 7;
    const RIGHT = 5;
    const fill = { color: SHADOW, alpha: 0.26 };
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const i = m.idx(x, y);
        if (m.cell[i] === Cell.Wall || m.room[i] >= 0) continue;
        const X = x * TILE;
        const Y = y * TILE;
        const up = m.isWall(x, y - 1);
        const left = m.isWall(x - 1, y);
        const diag = m.isWall(x - 1, y - 1);
        // The shadow is the building shifted right and down, so it starts late at the corners.
        if (up) {
          const from = left || diag ? 0 : RIGHT;
          g.rect(X + from, Y, TILE - from, DOWN).fill(fill);
        }
        if (left) {
          const from = up ? DOWN : diag ? 0 : DOWN;
          g.rect(X, Y + from, RIGHT, TILE - from).fill(fill);
        }
        if (!up && !left && diag) g.rect(X, Y, RIGHT, DOWN).fill(fill);
      }
    }
  }

  /** Soft darkening along the inside of walls so rooms read as enclosed. */
  private ambientOcclusion(g: Graphics): void {
    const m = this.map;
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const i = m.idx(x, y);
        if (m.cell[i] === Cell.Wall || m.room[i] < 0) continue;
        const X = x * TILE;
        const Y = y * TILE;
        if (m.isWall(x, y - 1)) {
          g.rect(X, Y, TILE, 2).fill({ color: AO, alpha: 0.3 });
          g.rect(X, Y + 2, TILE, 3).fill({ color: AO, alpha: 0.14 });
        }
        if (m.isWall(x - 1, y)) g.rect(X, Y, 2, TILE).fill({ color: AO, alpha: 0.16 });
        if (m.isWall(x + 1, y)) g.rect(X + TILE - 2, Y, 2, TILE).fill({ color: AO, alpha: 0.12 });
        if (m.isWall(x, y + 1)) g.rect(X, Y + TILE - 1, TILE, 1).fill({ color: AO, alpha: 0.12 });
      }
    }
  }

  /** Grounding shadows: long ones for trees and lamps, a thin contact line under furniture. */
  private propShadows(g: Graphics): void {
    for (const p of this.map.props) {
      if (p.w === 0 || p.flat) continue;
      const key = String(p.key);
      const footX = p.x * TILE + (p.w * TILE) / 2;
      const footY = (p.y + p.h) * TILE;
      if (key.startsWith('tree')) {
        g.ellipse(footX + 4, footY - 2, 8, 3).fill({ color: SHADOW, alpha: 0.28 });
        g.ellipse(footX + 1, footY - 1, 4, 2).fill({ color: SHADOW, alpha: 0.2 });
      } else if (key === 'lamp') {
        g.ellipse(footX + 2, footY - 2, 4, 1.5).fill({ color: SHADOW, alpha: 0.3 });
      } else if (p.room < 0) {
        g.ellipse(footX + 1, footY - 1, (p.w * TILE) / 2, 2).fill({ color: SHADOW, alpha: 0.22 });
      } else if (p.blocks) {
        g.rect(p.x * TILE + 1, footY - 1, p.w * TILE - 1, 2).fill({ color: AO, alpha: 0.22 });
      }
    }
  }
}
