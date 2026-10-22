import type { Facing, GroundKey, PropKey } from '../assets/manifest';

export type DrawnKey =
  | 'monitor' | 'toilet' | 'basin' | 'whiteboard' | 'coffee' | 'shower' | 'net'
  | 'rock' | 'stump' | 'crop0' | 'crop1' | 'crop2' | 'crop3' | 'crate' | 'logs' | 'stones' | 'chalkboard' | 'deskKid'
  | 'cake' | 'grave' | 'bonfire' | 'sawbench' | 'kiln' | 'workbench' | 'bucket' | 'well';

export type RoomKind =
  | 'office' | 'meeting' | 'kitchen' | 'lounge' | 'lobby' | 'restroom'
  | 'home' | 'cafe' | 'shop' | 'library' | 'storehouse' | 'school' | 'workshop' | 'clinic';

export interface Room {
  id: number;
  name: string;
  kind: RoomKind;
  x: number;
  y: number;
  w: number;
  h: number;
  building: string;
}

/** What an agent can do at a prop. */
export type UseKind =
  | 'work' | 'meet' | 'eat' | 'coffee' | 'cook' | 'sleep' | 'toilet' | 'shower'
  | 'sit' | 'play' | 'music' | 'read' | 'shop' | 'snack' | 'farm' | 'learn' | 'teach' | 'deposit' | 'craft' | 'rest' | 'fish';

export type ResourceKind = 'wood' | 'stone';

export interface Prop {
  id: number;
  key: PropKey | DrawnKey;
  drawn: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  blocks: boolean;
  /** Drawn under agents (rugs, mats, crops) rather than y-sorted with them. */
  flat: boolean;
  use?: UseKind;
  /** Where the agent stands/sits to use it, and which way they face. */
  spot?: { x: number; y: number; facing: Facing };
  room: number;
  /** For homes: which household it belongs to. */
  household?: number;
  /** Harvestable nature (trees, rocks): what it yields and how much is left. */
  resource?: ResourceKind;
  amount?: number;
  /** Building this prop belongs to. */
  building?: number;
  /** Farms: growth 0..1 of the crop on this tile. */
  growth?: number;
  cost?: number;
  /** Game minute after which a temporary prop (stumps) disappears. */
  expires?: number;
  /** Headstones: who lies here. */
  about?: number;
  label?: string;
}

export type BuildingKind = 'office' | 'cafe' | 'market' | 'library' | 'house' | 'farm' | 'storehouse' | 'school' | 'park' | 'workshop' | 'cemetery' | 'clinic' | 'dock' | 'well';

export interface Building {
  id: number;
  kind: BuildingKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rooms: number[];
  /** Outside tile in front of the door. */
  door: { x: number; y: number };
  built: number;
  /** Bumped when the building grows (a house extension), so views redraw it. */
  extended?: number;
  /** Built of planks and bricks (the workshop's), so it burns slower. */
  sturdy?: boolean;
  /** Fire damage, 0..1; builders repair it. */
  damage?: number;
}

export const enum Cell {
  Open = 0,
  Wall = 1,
  Door = 2,
}

/** Movement cost added per ground type (base step is 1). Roads are crossable but avoided. */
export const GROUND_COST: Partial<Record<GroundKey, number>> = {
  grass: 0.35,
  // Worn ground is easier going, so a shortcut, once trodden, keeps getting used.
  worn: 0.22,
  trail: 0.12,
  dirt: 0.1,
  asphalt: 8,
  laneH: 8,
  laneV: 8,
  water: 99,
  field: 0.8,
};

/** Footsteps (fading) before grass looks trampled, and before it's a bare trail. */
const WORN_AT = 10;
const TRAIL_AT = 26;
/** Wear kept per half hour: about a day's half-life. */
const WEAR_KEEP = 0.985;

/**
 * The town as a tile grid plus rooms, buildings and props. Pure data: no rendering.
 * Everything here can change at runtime as townsfolk chop, build and farm; versions tell views what to redraw.
 */
export class TownMap {
  readonly ground: GroundKey[];
  readonly cell: Uint8Array;
  /** 1 where a prop blocks movement. */
  readonly blocked: Uint8Array;
  /** Total traversal cost on top of the base step: ground plus props. */
  readonly cost: Float32Array;
  readonly room: Int16Array;
  /** Footsteps on open ground, fading over time; enough wear tramples grass into a trail. */
  wear: Float32Array;
  rooms: Room[] = [];
  props: Prop[] = [];
  buildings: Building[] = [];
  private propsAt: (Prop[] | undefined)[];
  private byId = new Map<number, Prop>();
  private nextProp = 1;
  /** Bumped on prop add/remove. */
  propVersion = 0;
  /** Bumped on wall/door changes. */
  wallVersion = 0;
  /** Cells whose ground changed since the renderer last looked. */
  groundDirty: number[] = [];
  /** Winter ice: open water can be walked on (and skated). */
  ice = false;
  /** Bumped on any ground change (paths, fields), for baked layers. */
  groundVersion = 0;
  /**
   * Bumps when the lawn needs a full repaint. Per-tile ground changes (paving, paths, wear) never
   * bump it: they reach the renderer through groundDirty and redraw only their own chunks.
   */
  lawnVersion = 0;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    const n = w * h;
    this.ground = new Array(n).fill('grass');
    this.cell = new Uint8Array(n);
    this.blocked = new Uint8Array(n);
    this.cost = new Float32Array(n);
    this.room = new Int16Array(n).fill(-1);
    this.wear = new Float32Array(n);
    this.propsAt = new Array(n);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  cx(i: number): number {
    return i % this.w;
  }

  cy(i: number): number {
    return (i / this.w) | 0;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  walkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    return this.cell[i] !== Cell.Wall && !this.blocked[i];
  }

  isWall(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.cell[this.idx(x, y)] === Cell.Wall;
  }

  roomAt(x: number, y: number): Room | undefined {
    if (!this.inBounds(x, y)) return undefined;
    const r = this.room[this.idx(x, y)];
    return r >= 0 ? this.rooms[r] : undefined;
  }

  prop(id: number | undefined): Prop | undefined {
    return id === undefined ? undefined : this.byId.get(id);
  }

  propsOn(x: number, y: number): Prop[] {
    return (this.inBounds(x, y) && this.propsAt[this.idx(x, y)]) || [];
  }

  setGround(x: number, y: number, g: GroundKey): void {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    if (this.ground[i] === g) return;
    this.ground[i] = g;
    this.groundDirty.push(i);
    // Neighbours too: a trail's grassy edges depend on what's next to it.
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (this.inBounds(x + dx, y + dy)) this.groundDirty.push(this.idx(x + dx, y + dy));
    this.groundVersion++;
    const was = this.blocked[i];
    this.refreshCell(i);
    // Boards over water (a pier) change where people can walk; pathfinding's regions key on wallVersion.
    if (this.blocked[i] !== was) this.wallVersion++;
  }

  setCell(x: number, y: number, c: Cell): void {
    const i = this.idx(x, y);
    this.cell[i] = c;
    this.wallVersion++;
  }

  /** Recomputes blocking and cost for a cell from its ground and props. */
  refreshCell(i: number): void {
    let cost = GROUND_COST[this.ground[i]] ?? 0;
    let blocked = this.ground[i] === 'water' && !this.ice ? 1 : 0;
    for (const p of this.propsAt[i] ?? []) {
      if (p.blocks) blocked = 1;
      if (p.cost) cost = Math.max(cost, p.cost + (GROUND_COST[this.ground[i]] ?? 0));
    }
    this.cost[i] = cost;
    this.blocked[i] = blocked;
  }

  addRoom(r: Omit<Room, 'id'>): Room {
    const room = { ...r, id: this.rooms.length };
    this.rooms.push(room);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (this.inBounds(x, y)) this.room[this.idx(x, y)] = room.id;
    return room;
  }

  addBuilding(b: Omit<Building, 'id'>): Building {
    const building = { ...b, id: this.buildings.length + 1 };
    this.buildings.push(building);
    return building;
  }

  addProp(p: Omit<Prop, 'id' | 'room' | 'drawn' | 'flat' | 'blocks'> & { blocks?: boolean; flat?: boolean; drawn?: boolean }): Prop {
    const prop: Prop = {
      ...p,
      id: this.nextProp++,
      blocks: p.blocks ?? true,
      flat: p.flat ?? false,
      drawn: p.drawn ?? false,
      // Spot-only props (no footprint) belong to the room their spot is in.
      room: p.spot ? this.room[this.idx(p.spot.x, p.spot.y)] : this.inBounds(p.x, p.y) ? this.room[this.idx(p.x, p.y)] : -1,
    };
    this.props.push(prop);
    this.byId.set(prop.id, prop);
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
      if (!this.inBounds(x, y)) continue;
      const i = this.idx(x, y);
      (this.propsAt[i] ??= []).push(prop);
      this.refreshCell(i);
    }
    this.propVersion++;
    return prop;
  }

  removeProp(prop: Prop): void {
    if (!this.byId.delete(prop.id)) return;
    this.props = this.props.filter((p) => p.id !== prop.id);
    for (let y = prop.y; y < prop.y + prop.h; y++) for (let x = prop.x; x < prop.x + prop.w; x++) {
      if (!this.inBounds(x, y)) continue;
      const i = this.idx(x, y);
      this.propsAt[i] = this.propsAt[i]?.filter((p) => p.id !== prop.id);
      this.refreshCell(i);
    }
    this.propVersion++;
  }

  propsWithUse(use: UseKind): Prop[] {
    return this.props.filter((p) => p.use === use);
  }

  /** Someone walked onto this cell. */
  step(i: number): void {
    const g = this.ground[i];
    if ((g !== 'grass' && g !== 'worn' && g !== 'trail') || this.room[i] >= 0) return;
    const w = (this.wear[i] += 1);
    if (g === 'grass' && w >= WORN_AT) this.setGround(this.cx(i), this.cy(i), 'worn');
    else if (g === 'worn' && w >= TRAIL_AT) this.setGround(this.cx(i), this.cy(i), 'trail');
  }

  /** Wear fades; unused trails grass over again. Call every half hour of game time. */
  fadeWear(): void {
    for (let i = 0; i < this.wear.length; i++) {
      const w = this.wear[i];
      if (w === 0) continue;
      const nw = w < 0.05 ? 0 : w * WEAR_KEEP;
      this.wear[i] = nw;
      const g = this.ground[i];
      if (g === 'trail' && nw < TRAIL_AT * 0.4) this.setGround(this.cx(i), this.cy(i), 'worn');
      else if (g === 'worn' && nw < WORN_AT * 0.4) this.setGround(this.cx(i), this.cy(i), 'grass');
    }
  }

  /** Rebuilds the prop lookups and per-cell costs from `props` (after loading a save). */
  reindex(): void {
    if (!this.wear || this.wear.length !== this.w * this.h) this.wear = new Float32Array(this.w * this.h);
    this.byId = new Map(this.props.map((p) => [p.id, p]));
    this.propsAt = new Array(this.w * this.h);
    for (const p of this.props) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
      if (this.inBounds(x, y)) (this.propsAt[this.idx(x, y)] ??= []).push(p);
    }
    this.refreshAll();
    this.groundDirty = [];
  }

  /** Recompute every cell's cost and blocking (after bulk edits). */
  refreshAll(): void {
    for (let i = 0; i < this.cell.length; i++) this.refreshCell(i);
  }

  /** Freezes or thaws open water; pathfinding notices through wallVersion. */
  setIce(on: boolean): void {
    if (this.ice === on) return;
    this.ice = on;
    for (let i = 0; i < this.cell.length; i++) if (this.ground[i] === 'water') this.refreshCell(i);
    this.wallVersion++;
  }
}
