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
