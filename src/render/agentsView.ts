import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { Art } from '../assets/loader';
import { CARS, type Facing, TILE } from '../assets/manifest';
import type { Camera } from '../engine/camera';
import type { Car } from '../sim/traffic';
import type { Agent } from '../sim/types';
import type { Sim } from '../sim/sim';
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

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

/** Moving things (agents, cars) plus screen-space overlays: name tags, need badges, speech bubbles, weather. */
export class AgentsView {
  readonly overlay = new Container();
  readonly sky = new Graphics();
  readonly rain = new Graphics();
  private sprites = new Map<number, AgentSprite>();
  private cars = new Map<number, Sprite>();
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
    const name = new Text({ text: a.name.split(' ')[0], style: { fontFamily: FONT, fontSize: 11, fontWeight: '600', fill: 0x1f2433 } });
    name.anchor.set(0.5, 0);
    const tagBg = new Graphics();
    tag.addChild(tagBg, name);
    const badges = new Container();
    const bubble = new Container();
    const bubbleBg = new Graphics();
    const bubbleText = new Text({ text: '', style: { fontFamily: FONT, fontSize: 11, fontWeight: '600', fill: 0x1f2433 } });
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
        const w = s.name.width + 10;
        bg.clear().roundRect(-w / 2, 0, w, 16, 4).fill({ color: sel ? 0x3b5bd9 : 0xfbf8f1, alpha: sel ? 1 : 0.92 });
        if (!sel) bg.stroke({ color: 0x1f2433, alpha: 0.12, width: 1 });
        s.name.style.fill = sel ? 0xffffff : 0x1f2433;
        s.name.position.set(0, 1);
        s.tag.position.set(Math.round(sx), Math.round(sy + 3));
      }
      // Need badges
      const badges = badgesFor(a);
      const sig = badges.map((b) => b.key + (b.urgent ? '!' : '')).join(',');
      if (sig !== s.badgeSig) {
        s.badgeSig = sig;
        s.badges.removeChildren().forEach((c) => c.destroy());
        badges.forEach((b, i) => {
          const g = new Graphics().roundRect(-8, -8, 16, 16, 5).fill({ color: 0xfbf8f1 }).stroke({ color: b.color, width: b.urgent ? 2 : 1.25 });
          const t = new Text({ text: b.glyph, style: { fontFamily: FONT, fontSize: 10, fontWeight: '700', fill: b.color } });
          t.anchor.set(0.5);
          const c = new Container();
          c.addChild(g, t);
          c.x = (i - (badges.length - 1) / 2) * 19;
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
          s.bubbleText.style.fill = bub.tone === 'bad' ? 0xffffff : 0x1f2433;
          const w = Math.max(18, s.bubbleText.width + 10);
          s.bubbleBg.clear().roundRect(-w / 2, -9, w, 18, 6).fill({ color: bub.tone === 'bad' ? 0xc8473a : bub.tone === 'good' ? 0xe9f6e4 : 0xfbf8f1 }).stroke({ color: 0x1f2433, alpha: 0.15, width: 1 });
          s.bubbleBg.moveTo(-3, 9).lineTo(0, 13).lineTo(3, 9).fill({ color: bub.tone === 'bad' ? 0xc8473a : bub.tone === 'good' ? 0xe9f6e4 : 0xfbf8f1 });
        }
        s.bubble.position.set(Math.round(sx), Math.round(headY - (badges.length ? 32 : 12)));
      }
    }

    // Selection / hover ring under the feet
    this.ring.clear();
    for (const [id, color, w] of [[this.hovered, 0x1f2433, 1], [this.selected, 0x3b5bd9, 1.5]] as const) {
      if (id === null) continue;
      const s = this.sprites.get(id);
      if (!s) continue;
      this.ring.ellipse(s.body.x, s.body.y, 7, 3).stroke({ color, width: w, alpha: id === this.selected ? 1 : 0.5 });
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
        s = new Sprite(this.carTexture(c));
        s.anchor.set(0.5, 0.75);
        this.world.entities.addChild(s);
        this.cars.set(c.id, s);
      }
      const x = (c.px + (c.x - c.px) * alpha) * TILE;
      const y = (c.py + (c.y - c.py) * alpha) * TILE;
      s.position.set(Math.round(x), Math.round(y));
      s.zIndex = Math.round(y + 6);
    }
    for (const [id, s] of this.cars) {
      if (!seen.has(id)) {
        s.destroy();
        this.cars.delete(id);
      }
    }
  }

  private carTexture(c: Car): Texture {
    const set = CARS[c.color];
    const f = c.lane === 'E' ? set.sideFlip : c.lane === 'W' ? set.side : c.lane === 'S' ? set.down : set.up;
    return this.art.frame(f);
  }

  /** Day/night tint and rain, drawn in screen space over the world but under the UI. */
  updateWeather(hour: number, raining: boolean, realMs: number, w: number, h: number): void {
    // Darkness ramps across dusk (18-21) and dawn (5-7).
    const dark = hour < 5 || hour >= 21 ? 1 : hour < 7 ? (7 - hour) / 2 : hour >= 18 ? (hour - 18) / 3 : 0;
    this.sky.clear();
    if (dark > 0.01) this.sky.rect(0, 0, w, h).fill({ color: 0x1a2350, alpha: dark * 0.42 });
    if (raining) this.sky.rect(0, 0, w, h).fill({ color: 0x5a6a80, alpha: 0.12 });
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
