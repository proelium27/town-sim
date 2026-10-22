import { Container, Graphics } from 'pixi.js';

interface Puff {
  g: Graphics;
  x: number;
  y: number;
  age: number;
  life: number;
  drift: number;
}

/** Puffs of chimney smoke that rise, drift with the breeze, swell and fade. */
export class Smoke {
  readonly layer = new Container();
  private puffs: Puff[] = [];
  private pool: Graphics[] = [];
  private acc = new Map<number, number>();

  /** dt in real seconds; sources are chimney tops in world px. */
  update(dt: number, sources: { id: number; x: number; y: number }[]): void {
    const live = new Set<number>();
    for (const s of sources) {
      live.add(s.id);
      let a = (this.acc.get(s.id) ?? Math.random() * 0.5) + dt;
      while (a > 0.5) {
        a -= 0.5;
        this.spawn(s.x + (Math.random() - 0.5) * 3, s.y);
      }
      this.acc.set(s.id, a);
    }
    for (const id of this.acc.keys()) if (!live.has(id)) this.acc.delete(id);
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this.layer.removeChild(p.g);
        this.pool.push(p.g);
        this.puffs.splice(i, 1);
        continue;
      }
      p.y -= dt * 9;
      p.x += dt * p.drift;
      p.g.position.set(Math.round(p.x), Math.round(p.y));
      p.g.scale.set(1 + t * 1.6);
      p.g.alpha = 0.55 * (1 - t) * Math.min(1, t * 6);
    }
  }

  private spawn(x: number, y: number): void {
    const g = this.pool.pop() ?? new Graphics().circle(0, 0, 2.5).fill(0xe9e4da).circle(-1, -1, 1.2).fill(0xf6f2ea);
    this.layer.addChild(g);
    this.puffs.push({ g, x, y, age: 0, life: 2.6 + Math.random(), drift: 2 + Math.random() * 3 });
  }
}

interface Flame {
  g: Graphics;
  x: number;
  y: number;
  age: number;
  life: number;
  smoke: boolean;
}

const FLAME = [0xfff1a8, 0xffc53d, 0xff8a1f, 0xe8431e];

/** A fire on a roof: flickering tongues of flame along it, and dark smoke rolling up, both by how fierce it is. */
export class Flames {
  readonly layer = new Container();
  private bits: Flame[] = [];
  private acc = new Map<number, number>();
  /** A warm glow over each burning building, under its flames. */
  private glows = new Map<number, Graphics>();
  private t = 0;

  /** dt in real seconds; sources are burning roofs (a rectangle in world px) with heat 0..1. */
  update(dt: number, sources: { id: number; x: number; y: number; w: number; h: number; heat: number }[]): void {
    const live = new Set<number>();
    this.t += dt;
    for (const s of sources) {
      live.add(s.id);
      let glow = this.glows.get(s.id);
      if (!glow) {
        glow = new Graphics();
        this.layer.addChildAt(glow, 0);
        this.glows.set(s.id, glow);
      }
      const flicker = 0.85 + Math.sin(this.t * 13 + s.id) * 0.08 + Math.sin(this.t * 31) * 0.07;
      glow
        .clear()
        .ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w * 0.75, s.h * 0.75)
        .fill({ color: 0xff7a1a, alpha: 0.12 * s.heat * flicker })
        .ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w * 0.45, s.h * 0.45)
        .fill({ color: 0xffb347, alpha: 0.16 * s.heat * flicker });
      // More flame for a hotter fire and a bigger roof.
      const rate = (6 + (s.w * s.h) / 600) * (0.4 + s.heat * 1.6);
      let a = (this.acc.get(s.id) ?? 0) + dt * rate;
      while (a > 1) {
        a -= 1;
        const smoke = Math.random() < 0.3;
        this.spawn(s.x + Math.random() * s.w, s.y + Math.random() * s.h, smoke, s.heat);
      }
      this.acc.set(s.id, a);
    }
    for (const id of this.acc.keys()) if (!live.has(id)) this.acc.delete(id);
    for (const [id, g] of this.glows) {
      if (live.has(id)) continue;
      g.destroy();
      this.glows.delete(id);
    }
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const p = this.bits[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this.layer.removeChild(p.g);
        p.g.destroy();
        this.bits.splice(i, 1);
        continue;
      }
      p.y -= dt * (p.smoke ? 12 : 22);
      p.x += dt * (p.smoke ? 4 : Math.sin(p.age * 20) * 6);
      p.g.position.set(Math.round(p.x), Math.round(p.y));
      if (p.smoke) {
        p.g.scale.set(1 + t * 2);
        p.g.alpha = 0.6 * (1 - t);
      } else {
        // Stepped shrink, to match the pixel art.
        p.g.scale.set(Math.max(0.25, Math.round((1 - t) * 4) / 4));
        p.g.alpha = 1 - t * 0.5;
      }
    }
  }

  private spawn(x: number, y: number, smoke: boolean, heat: number): void {
    // Tongues of flame: a hot core in a darker body, taller the fiercer the fire.
    const tall = 5 + Math.round(heat * 5);
    const body = FLAME[1 + Math.floor(Math.random() * 3)];
    const g = smoke
      ? new Graphics().circle(0, 0, 3.5).fill(0x3a3430).circle(-1, -1, 1.8).fill(0x4d4540)
      : new Graphics().rect(-2.5, -tall, 5, tall).fill(body).rect(-1, -tall + 2, 2, tall - 3).fill(FLAME[0]);
    this.layer.addChild(g);
    this.bits.push({ g, x, y, age: 0, life: smoke ? 2.2 + Math.random() : 0.5 + Math.random() * 0.4, smoke });
  }
}
