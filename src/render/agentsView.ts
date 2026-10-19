import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { Art } from '../assets/loader';
import { CARS, type Facing, TILE } from '../assets/manifest';
import type { Camera } from '../engine/camera';
import type { Car } from '../sim/traffic';
import type { Agent } from '../sim/types';
import type { Sim } from '../sim/sim';
import type { VehicleLight } from './lighting';
import type { WorldView } from './worldView';

/** Badge shown over an agent's head when a need is low. */
export interface Badge {
  key: string;
  glyph: string;
  color: number;
  urgent: boolean;
}

export function badgesFor(a: Agent): Badge[] {
  const n = a.needs;
  const out: Badge[] = [];
  if (n.hunger < 22) out.push({ key: 'hunger', glyph: '\u{1F374}', color: 0xd9733a, urgent: n.hunger < 10 });
  if (n.energy < 20 && a.action.kind !== 'sleep') out.push({ key: 'energy', glyph: 'z', color: 0xd9a52b, urgent: n.energy < 8 });
  if (n.hygiene < 22) out.push({ key: 'hygiene', glyph: '~', color: 0x5a9fb8, urgent: n.hygiene < 10 });
  if (n.social < 18) out.push({ key: 'social', glyph: '…', color: 0xc94f7c, urgent: n.social < 8 });
  if (n.fun < 15) out.push({ key: 'fun', glyph: '☹', color: 0x8a5cc2, urgent: n.fun < 6 });
  if (a.mood < 28) out.push({ key: 'mood', glyph: '⚡', color: 0xd04a3a, urgent: a.mood < 15 });
  return out.slice(0, 3);
}

interface AgentSprite {
  body: Sprite;
  shadow: Graphics;
  frames: Record<Facing, Texture[]>;
  tag: Container;
  name: Text;
  badges: Container;
  badgeSig: string;
  bubble: Container;
  bubbleText: Text;
  bubbleBg: Graphics;
  bubbleSig: string;
  anim: number;
}

const FONT = 'Rubik, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
// Overlay palette, matching the UI tokens in styles.css.
const PANEL = 0x2a241e;
const EDGE = 0x15110d;
const CREAM = 0xf6efe0;
const MARIGOLD = 0xf2c14e;
const BAD = 0xc8473a;
const GOOD = 0xdff2d2;
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Moving things (agents, cars) plus screen-space overlays: name tags, need badges, speech bubbles, weather. */
export class AgentsView {
  readonly overlay = new Container();
  readonly sky = new Graphics();
  readonly rain = new Graphics();
  private sprites = new Map<number, AgentSprite>();
  private cars = new Map<number, { body: Sprite; shadow: Graphics }>();
  private lastSync = 0;
  private ring = new Graphics();
  selected: number | null = null;
  hovered: number | null = null;

  constructor(
    readonly art: Art,
    readonly sim: Sim,
    readonly world: WorldView,
  ) {
    world.entities.addChild(this.ring);
    for (const a of sim.agents) this.add(a);
  }

  private add(a: Agent): void {
    const frames = this.art.character(a.outfit);
    const body = new Sprite(frames.down[0]);
    body.anchor.set(0.5, 1);
    const shadow = new Graphics().ellipse(0, 0, 5, 2).fill({ color: 0x1b1a17, alpha: 0.22 });
    this.world.entities.addChild(shadow, body);
    const tag = new Container();
    const name = new Text({ text: a.name.split(' ')[0], style: { fontFamily: FONT, fontSize: 11, fontWeight: '600', fill: CREAM } });
    name.anchor.set(0.5, 0);
    const tagBg = new Graphics();
    tag.addChild(tagBg, name);
    const badges = new Container();
    const bubble = new Container();
    const bubbleBg = new Graphics();
    const bubbleText = new Text({ text: '', style: { fontFamily: FONT, fontSize: 11, fontWeight: '500', fill: EDGE } });
    bubbleText.anchor.set(0.5, 0.5);
    bubble.addChild(bubbleBg, bubbleText);
    this.overlay.addChild(tag, badges, bubble);
    this.sprites.set(a.id, { body, shadow, frames, tag, name, badges, badgeSig: '', bubble, bubbleText, bubbleBg, bubbleSig: '', anim: a.id * 0.37 });
  }

  /** Agent under a screen point, if any. */
  pick(sx: number, sy: number, cam: Camera): Agent | null {
    let best: Agent | null = null;
    let bd = Infinity;
    for (const a of this.sim.agents) {
      const s = this.sprites.get(a.id)!;
      const [px, py] = cam.toScreen(s.body.x, s.body.y);
      const z = cam.zoom;
      if (sx < px - 7 * z || sx > px + 7 * z || sy < py - 16 * z || sy > py + 2 * z) continue;
      const d = Math.abs(sx - px) + Math.abs(sy - (py - 8 * z));
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  /** Screen-space feet position of an agent from the last rendered frame. */
  screenPos(id: number, cam: Camera): [number, number] | null {
    const s = this.sprites.get(id);
    return s ? cam.toScreen(s.body.x, s.body.y) : null;
  }

  update(alpha: number, dtSec: number, speed: number, cam: Camera, viewW: number, viewH: number): void {
    const sim = this.sim;
    for (const a of sim.agents) {
      const s = this.sprites.get(a.id)!;
      const x = (a.px + (a.x - a.px) * alpha + 0.5) * TILE;
      const y = (a.py + (a.y - a.py) * alpha + 1) * TILE - 2;
      const moving = a.moving && speed > 0;
      if (moving) s.anim += dtSec * 7 * Math.max(1, speed);
      const facing: Facing = a.action.kind === 'sleep' && a.action.stage === 'perform' ? 'down' : a.facing;
      s.body.texture = s.frames[facing][moving ? Math.floor(s.anim) % 4 : 0];
      const lying = a.action.kind === 'sleep' && a.action.stage === 'perform';
      if (lying) {
        // Tucked into bed: rotate about the middle of the tile and draw above the bed sprite.
        s.body.anchor.set(0.5, 0.5);
        s.body.rotation = -Math.PI / 2;
        s.body.position.set(Math.round(x), Math.round(y - 6));
        s.body.zIndex = Math.round(y) + 24;
      } else {
        s.body.anchor.set(0.5, 1);
        s.body.rotation = 0;
        // Party-goers bob to the music.
        const bob = a.action.kind === 'party' && !moving && Math.floor(sim.time * 4 + a.id) % 2 ? -1 : 0;
        s.body.position.set(Math.round(x), Math.round(y) + bob);
        s.body.zIndex = Math.round(y) + 0.5;
      }
      s.shadow.position.set(Math.round(x), Math.round(y));
      s.shadow.zIndex = Math.round(y) - 8;
      s.shadow.visible = s.body.rotation === 0;

      // Screen-space overlay
      const [sx, sy] = cam.toScreen(x, y);
      const onScreen = sx > -60 && sy > -60 && sx < viewW + 60 && sy < viewH + 60;
      const z = cam.zoom;
      const sel = a.id === this.selected;
      const hov = a.id === this.hovered;
      s.tag.visible = onScreen && (sel || hov || z >= 2.6);
      if (s.tag.visible) {
        const bg = s.tag.children[0] as Graphics;
        const w = Math.ceil(s.name.width) + 12;
        // Pill with a hard pixel drop shadow, like the UI panels.
        bg.clear()
          .roundRect(-w / 2, 2, w, 17, 8).fill({ color: EDGE, alpha: 0.55 })
          .roundRect(-w / 2, 0, w, 17, 8).fill({ color: sel ? MARIGOLD : PANEL, alpha: sel ? 1 : 0.94 })
          .stroke({ color: EDGE, width: 1.5, alignment: 1 });
        const fill = sel ? EDGE : CREAM;
        if (s.name.style.fill !== fill) s.name.style.fill = fill;
        s.name.position.set(0, 1.5);
        s.tag.position.set(Math.round(sx), Math.round(sy + 4));
      }
      // Need badges
      const badges = badgesFor(a);
      const sig = badges.map((b) => b.key + (b.urgent ? '!' : '')).join(',');
      if (sig !== s.badgeSig) {
        s.badgeSig = sig;
        s.badges.removeChildren().forEach((c) => c.destroy());
        badges.forEach((b, i) => {
          const g = new Graphics()
            .roundRect(-9, -7, 18, 18, 6).fill({ color: EDGE, alpha: 0.55 })
            .roundRect(-9, -9, 18, 18, 6).fill({ color: b.urgent ? b.color : PANEL })
            .stroke({ color: b.urgent ? EDGE : b.color, width: 1.5, alignment: 1 });
          const t = new Text({ text: b.glyph, style: { fontFamily: FONT, fontSize: 11, fontWeight: '700', fill: b.urgent ? CREAM : b.color } });
          t.anchor.set(0.5);
          const c = new Container();
          c.addChild(g, t);
          c.x = (i - (badges.length - 1) / 2) * 21;
          s.badges.addChild(c);
        });
      }
      const headY = sy - 17 * z;
      s.badges.visible = onScreen && badges.length > 0;
      s.badges.position.set(Math.round(sx), Math.round(headY - 10));
      // Speech bubble
      const bub = a.bubble;
      s.bubble.visible = onScreen && !!bub;
      if (bub) {
        const bsig = bub.text + bub.tone;
        if (bsig !== s.bubbleSig) {
          s.bubbleSig = bsig;
          s.bubbleText.text = bub.text;
          s.bubbleText.style.fill = bub.tone === 'bad' ? CREAM : EDGE;
          const w = Math.max(20, Math.ceil(s.bubbleText.width) + 14);
          const fill = bub.tone === 'bad' ? BAD : bub.tone === 'good' ? GOOD : CREAM;
          // Comic-style bubble: outlined body and tail, hard shadow underneath.
          s.bubbleBg.clear()
            .roundRect(-w / 2, -8, w, 19, 7).fill({ color: EDGE, alpha: 0.45 })
            .poly([-4, 9, 0, 15, 4, 9]).fill(EDGE)
            .roundRect(-w / 2, -10, w, 19, 7).fill(fill).stroke({ color: EDGE, width: 1.5, alignment: 1 })
            .poly([-3, 8, 0, 12.5, 3, 8]).fill(fill);
        }
        s.bubble.position.set(Math.round(sx), Math.round(headY - (badges.length ? 34 : 14)));
      }
    }

    // Selection / hover ring under the feet
    this.ring.clear();
    const pulse = reducedMotion ? 0 : (Math.sin(performance.now() / 260) + 1) / 2;
    for (const [id, color] of [[this.hovered, CREAM], [this.selected, MARIGOLD]] as const) {
      if (id === null) continue;
      const s = this.sprites.get(id);
      if (!s) continue;
      const sel = id === this.selected;
      const r = sel ? 8 + pulse : 7;
      this.ring.ellipse(s.body.x, s.body.y, r + 1, r / 2 + 1).stroke({ color: EDGE, width: 1, alpha: 0.5 });
      this.ring.ellipse(s.body.x, s.body.y, r, r / 2).stroke({ color, width: sel ? 1.5 : 1, alpha: sel ? 1 : 0.8 });
      this.ring.zIndex = s.body.zIndex - 1;
    }

    this.updateCars(alpha);
  }

  private updateCars(alpha: number): void {
    const seen = new Set<number>();
    for (const c of this.sim.cars) {
      seen.add(c.id);
      let s = this.cars.get(c.id);
      if (!s) {
        const body = new Sprite(this.carTexture(c));
        body.anchor.set(0.5, 0.75);
        const horizontal = c.lane === 'E' || c.lane === 'W';
        const shadow = new Graphics().roundRect(-body.width / 2 + 1, -3, body.width, horizontal ? 7 : 6, 3).fill({ color: 0x15110d, alpha: 0.28 });
        this.world.entities.addChild(shadow, body);
        s = { body, shadow };
        this.cars.set(c.id, s);
      }
      const x = (c.px + (c.x - c.px) * alpha) * TILE;
      const y = (c.py + (c.y - c.py) * alpha) * TILE;
      s.body.position.set(Math.round(x), Math.round(y));
      s.body.zIndex = Math.round(y + 6);
      s.shadow.position.set(Math.round(x) + 2, Math.round(y) + s.body.height * 0.25);
      s.shadow.zIndex = s.body.zIndex - 1;
    }
    for (const [id, s] of this.cars) {
      if (!seen.has(id)) {
        s.body.destroy();
        s.shadow.destroy();
        this.cars.delete(id);
      }
    }
  }

  private carTexture(c: Car): Texture {
    const set = CARS[c.color];
    const f = c.lane === 'E' ? set.sideFlip : c.lane === 'W' ? set.side : c.lane === 'S' ? set.down : set.up;
    return this.art.frame(f);
  }

  /** Headlight anchors for every car on the road, in world pixels. */
  vehicleLights(): VehicleLight[] {
    const out: VehicleLight[] = [];
    for (const c of this.sim.cars) {
      const s = this.cars.get(c.id);
      if (!s) continue;
      const [dx, dy] = c.lane === 'E' ? [1, 0] : c.lane === 'W' ? [-1, 0] : c.lane === 'S' ? [0, 1] : [0, -1];
      out.push({ x: s.body.x, y: s.body.y - s.body.height * 0.25, dx, dy });
    }
    return out;
  }

  /** Rooms with someone awake in them, so their lights come on after dark. */
  private occupiedRooms(): Set<number> {
    const out = new Set<number>();
    for (const a of this.sim.agents) {
      if (a.action.kind === 'sleep' && a.action.stage === 'perform') continue;
      const r = this.sim.map.roomAt(Math.round(a.x), Math.round(a.y));
      if (r) out.add(r.id);
    }
    return out;
  }

  /** World lighting (grade, lamps, windows, headlights) plus screen-space rain streaks over everything. */
  updateWeather(hour: number, raining: boolean, realMs: number, w: number, h: number): void {
    if (realMs - this.lastSync > 1000) {
      this.lastSync = realMs;
      this.world.shading.sync();
    }
    this.world.lighting.update(hour, raining, this.occupiedRooms(), this.vehicleLights());
    this.sky.clear();
    this.rain.clear();
    if (!raining) return;
    const t = realMs / 1000;
    for (let i = 0; i < 160; i++) {
      const rx = ((i * 97.3 + t * 80) % (w + 40)) - 20;
      const ry = ((i * 53.7 + t * 520 + (i % 7) * 40) % (h + 40)) - 20;
      this.rain.moveTo(rx, ry).lineTo(rx - 3, ry + 11);
    }
    this.rain.stroke({ color: 0xbfd4ea, alpha: 0.45, width: 1 });
  }
}
