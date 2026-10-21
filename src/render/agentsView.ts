import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { Art } from '../assets/loader';
import { CARS, type Facing, TILE } from '../assets/manifest';
import type { Camera } from '../engine/camera';
import type { Car } from '../sim/traffic';
import type { Agent } from '../sim/types';
import type { Sim } from '../sim/sim';
import type { VehicleLight } from './lighting';
import type { WorldView } from './worldView';
import { ageOf, hasUmbrella } from '../sim/agents';
import { ADULT_AGE } from '../sim/defs';
import { snowing } from '../sim/seasons';

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
  carry: Graphics;
  carrySig: string;
  umbrella: Graphics;
}

const UMBRELLAS = [0xc8473a, 0x3a7bc8, 0xf2c14e, 0x4a9a5a, 0x8a5ab8, 0x2a241e];

/** A little pixel umbrella held over the head, canopy colour by person. */
function drawUmbrella(id: number): Graphics {
  const c = UMBRELLAS[id % UMBRELLAS.length];
  const g = new Graphics();
  g.rect(0, 0, 1, 8).fill(0x3a3430);
  g.rect(-7, -1, 14, 2).fill(c);
  g.rect(-6, -3, 12, 2).fill(c);
  g.rect(-4, -4, 8, 1).fill(c);
  g.rect(-5, -3, 3, 1).fill({ color: 0xffffff, alpha: 0.35 });
  g.rect(-7, 1, 14, 1).fill({ color: EDGE, alpha: 0.45 });
  g.rect(0, -5, 1, 1).fill(EDGE);
  return g;
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
  private cars = new Map<number, { body: Sprite; shadow: Graphics; load?: Graphics }>();
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
    this.syncPopulation();
  }

  private popVersion = -1;

  /** Adds sprites for the newborn and newly arrived, and clears away the departed. */
  private syncPopulation(): void {
    if (this.popVersion === this.sim.populationVersion) return;
    this.popVersion = this.sim.populationVersion;
    const live = new Set(this.sim.agents.map((a) => a.id));
    for (const a of this.sim.agents) if (!this.sprites.has(a.id)) this.add(a);
    for (const [id, s] of this.sprites) {
      if (live.has(id)) continue;
      for (const d of [s.body, s.shadow, s.tag, s.badges, s.bubble, s.carry, s.umbrella]) d.destroy({ children: true });
      this.sprites.delete(id);
      if (this.selected === id) this.selected = null;
      if (this.hovered === id) this.hovered = null;
    }
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
    const carry = new Graphics();
    const umbrella = drawUmbrella(a.id);
    umbrella.visible = false;
    this.world.entities.addChild(carry, umbrella);
    this.overlay.addChild(tag, badges, bubble);
    this.sprites.set(a.id, { body, shadow, frames, tag, name, badges, badgeSig: '', bubble, bubbleText, bubbleBg, bubbleSig: '', anim: a.id * 0.37, carry, carrySig: '', umbrella });
  }

  /** Agent under a screen point, if any. */
  pick(sx: number, sy: number, cam: Camera): Agent | null {
    let best: Agent | null = null;
    let bd = Infinity;
    for (const a of this.sim.agents) {
      if (this.covered(a) > 0.5) continue;
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

  /** How much a roof covers this person (0 = in plain view). */
  private covered(a: Agent): number {
    return this.world.exteriors.coverAt(Math.round(a.x), Math.round(a.y));
  }

  update(alpha: number, dtSec: number, speed: number, cam: Camera, viewW: number, viewH: number): void {
    const sim = this.sim;
    this.syncPopulation();
    for (const a of sim.agents) {
      const s = this.sprites.get(a.id)!;
      // Kids are drawn smaller and grow into full size by eighteen.
      const age = ageOf(sim, a);
      const scale = age < 4 ? 0.55 : age < ADULT_AGE ? 0.62 + (age / ADULT_AGE) * 0.38 : 1;
      s.body.scale.set(scale);
      s.shadow.scale.set(scale);
      // Walking with someone: side by side rather than in single file.
      let ox = 0;
      let oy = 0;
      const mate = a.walkWith !== undefined ? sim.agent(a.walkWith) : undefined;
      if (mate && a.moving && mate.moving && Math.hypot(mate.x - a.x, mate.y - a.y) < 2) {
        const side = a.id < mate.id ? -1 : 1;
        if (a.facing === 'left' || a.facing === 'right') oy = side * 3;
        else ox = side * 5;
      }
      const x = (a.px + (a.x - a.px) * alpha + 0.5) * TILE + ox;
      const y = (a.py + (a.y - a.py) * alpha + 1) * TILE - 2 + oy;
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
      const csig = a.carry ? a.carry.kind : '';
      if (csig !== s.carrySig) {
        s.carrySig = csig;
        const g = s.carry.clear();
        if (a.carry?.kind === 'wood') g.rect(-5, -2, 10, 3).fill(0x8a5f37).rect(-5, 1, 10, 3).fill(0x9b6a3c).rect(4, -2, 2, 6).fill(0xd4a56a);
        else if (a.carry?.kind === 'stone') g.rect(-4, -1, 5, 4).fill(0x8d877f).rect(0, -3, 5, 5).fill(0xa8a29a);
        else if (a.carry?.kind === 'food') g.rect(-5, 0, 10, 4).fill(0xa97a47).rect(-4, -2, 3, 2).fill(0xe9c74c).rect(0, -3, 3, 3).fill(0x7fbf4f);
        else if (a.carry?.kind === 'firewood') g.rect(-6, -1, 4, 4).fill(0x8a5f37).rect(-2, -2, 4, 5).fill(0xc08a50).rect(2, -1, 4, 4).fill(0xa97a47).rect(-1, -2, 2, 1).fill(0xe0b679);
      }
      s.carry.visible = !!a.carry;
      s.carry.position.set(Math.round(x), Math.round(y - 17 * scale));
      s.carry.zIndex = s.body.zIndex + 0.1;
      const brolly = !!sim.events.rain && !snowing(sim) && !lying && sim.map.room[a.at] < 0 && hasUmbrella(a);
      s.umbrella.visible = brolly;
      if (brolly) {
        s.umbrella.position.set(Math.round(x + (a.facing === 'left' ? -1 : 1)), Math.round(y - 19 * scale));
        s.umbrella.zIndex = s.body.zIndex + 0.2;
      }
      s.shadow.zIndex = Math.round(y) - 8;
      s.shadow.visible = s.body.rotation === 0;

      // Screen-space overlay
      const [sx, sy] = cam.toScreen(x, y);
      // Indoors under a roof: nothing floats over the building except for the selected person.
      const onScreen = sx > -60 && sy > -60 && sx < viewW + 60 && sy < viewH + 60 && (a.id === this.selected || this.covered(a) < 0.5);
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
      // Zoomed far out, per-person badges and bubbles would bury the town; the selection ring still shows.
      const near = z >= 1;
      s.badges.visible = near && onScreen && badges.length > 0;
      s.badges.position.set(Math.round(sx), Math.round(headY - 10));
      // Speech bubble
      const bub = a.bubble;
      s.bubble.visible = near && onScreen && !!bub;
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
        if (c.trader) {
          // Crates and sacks strapped on top, so the trader reads at a glance.
          const load = new Graphics()
            .rect(-11, -5, 8, 6).fill(0xa97a47).rect(-11, -5, 8, 1).fill(0xd4a56a).rect(-8, -5, 1, 6).fill(0x7a5531)
            .rect(-2, -7, 7, 8).fill(0xe0cfa0).rect(-2, -7, 7, 2).fill(0xf0e2c0)
            .rect(6, -4, 6, 5).fill(0x8a5f37).rect(6, -4, 6, 1).fill(0xb98a55);
          this.world.entities.addChild(load);
          s.load = load;
        }
        this.cars.set(c.id, s);
      }
      const x = (c.px + (c.x - c.px) * alpha) * TILE;
      const y = (c.py + (c.y - c.py) * alpha) * TILE;
      s.body.position.set(Math.round(x), Math.round(y));
      s.body.zIndex = Math.round(y + 6);
      s.shadow.position.set(Math.round(x) + 2, Math.round(y) + s.body.height * 0.25);
      s.shadow.zIndex = s.body.zIndex - 1;
      if (s.load) {
        s.load.position.set(Math.round(x), Math.round(y) - 14);
        s.load.zIndex = s.body.zIndex + 0.1;
      }
    }
    for (const [id, s] of this.cars) {
      if (!seen.has(id)) {
        s.body.destroy();
        s.shadow.destroy();
        s.load?.destroy();
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
  updateWeather(hour: number, raining: boolean, realMs: number, w: number, h: number, season = 0, seasonProgress = 0, blizzard = false): void {
    if (realMs - this.lastSync > 1000) {
      this.lastSync = realMs;
      this.world.shading.sync();
    }
    const ext = this.world.exteriors;
    this.world.lighting.update(hour, raining, this.occupiedRooms(), this.vehicleLights(), ext.roofedRooms(), ext.litWindows(), season, seasonProgress);
    this.sky.clear();
    this.rain.clear();
    if (!raining) return;
    const t = realMs / 1000;
    if (season === 3 || blizzard) {
      // Snow: soft flakes drifting down and sideways; a blizzard (in any season) is thicker and faster.
      const n = blizzard ? 320 : 150;
      const fall = blizzard ? 160 : 60;
      for (let i = 0; i < n; i++) {
        const sx = ((i * 97.3 + t * (blizzard ? 120 : 18) + Math.sin(t * 1.3 + i) * 8) % (w + 40)) - 20;
        const sy = ((i * 53.7 + t * fall * (0.7 + (i % 5) * 0.12)) % (h + 40)) - 20;
        this.rain.rect(Math.round(sx), Math.round(sy), i % 3 ? 2 : 3, i % 3 ? 2 : 3);
      }
      this.rain.fill({ color: 0xffffff, alpha: 0.85 });
      return;
    }
    for (let i = 0; i < 160; i++) {
      const rx = ((i * 97.3 + t * 80) % (w + 40)) - 20;
      const ry = ((i * 53.7 + t * 520 + (i % 7) * 40) % (h + 40)) - 20;
      this.rain.moveTo(rx, ry).lineTo(rx - 3, ry + 11);
    }
    this.rain.stroke({ color: 0xbfd4ea, alpha: 0.45, width: 1 });
  }
}
