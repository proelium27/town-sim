import type { Facing, GroundKey, PropKey } from '../assets/manifest';

export type DrawnKey =
  | 'monitor' | 'toilet' | 'basin' | 'whiteboard' | 'coffee' | 'shower' | 'net'
  | 'rock' | 'stump' | 'crop0' | 'crop1' | 'crop2' | 'crop3' | 'crate' | 'logs' | 'stones' | 'chalkboard' | 'deskKid';

export type RoomKind =
  | 'office' | 'meeting' | 'kitchen' | 'lounge' | 'lobby' | 'restroom'
  | 'home' | 'cafe' | 'shop' | 'library' | 'storehouse' | 'school' | 'workshop';

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
  | 'sit' | 'play' | 'music' | 'read' | 'shop' | 'snack' | 'farm' | 'learn' | 'teach' | 'deposit';

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
}

export type BuildingKind = 'office' | 'cafe' | 'market' | 'library' | 'house' | 'farm' | 'storehouse' | 'school' | 'park' | 'workshop';

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
}

export const enum Cell {
  Open = 0,
  Wall = 1,
  Door = 2,
}

/** Movement cost added per ground type (base step is 1). Roads are crossable but avoided. */
export const GROUND_COST: Partial<Record<GroundKey, number>> = {
  grass: 0.35,
  dirt: 0.1,
  asphalt: 8,
  laneH: 8,
  laneV: 8,
  water: 99,
  field: 0.8,
};

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
  /** Bumped on any ground change (paths, fields), for baked layers. */
  groundVersion = 0;

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
    this.groundVersion++;
    this.refreshCell(i);
  }

  setCell(x: number, y: number, c: Cell): void {
    const i = this.idx(x, y);
    this.cell[i] = c;
    this.wallVersion++;
  }

  /** Recomputes blocking and cost for a cell from its ground and props. */
  refreshCell(i: number): void {
    let cost = GROUND_COST[this.ground[i]] ?? 0;
    let blocked = this.ground[i] === 'water' ? 1 : 0;
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

  /** Rebuilds the prop lookups and per-cell costs from `props` (after loading a save). */
  reindex(): void {
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
}
