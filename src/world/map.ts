import type { Facing, GroundKey, PropKey } from '../assets/manifest';

export type DrawnKey = 'monitor' | 'toilet' | 'basin' | 'whiteboard' | 'coffee' | 'shower' | 'net';

export type RoomKind =
  | 'office' | 'meeting' | 'kitchen' | 'lounge' | 'lobby' | 'restroom'
  | 'home' | 'cafe' | 'shop' | 'library';

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
  | 'sit' | 'play' | 'music' | 'read' | 'shop' | 'snack';

export interface Prop {
  id: number;
  key: PropKey | DrawnKey;
  drawn: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  blocks: boolean;
  /** Drawn under agents (rugs, mats) rather than y-sorted with them. */
  flat: boolean;
  use?: UseKind;
  /** Where the agent stands/sits to use it, and which way they face. */
  spot?: { x: number; y: number; facing: Facing };
  room: number;
  /** Agent id that owns this (their desk, their bed). */
  owner?: number;
  /** For homes: which household it belongs to. */
  household?: number;
}

export const enum Cell {
  Open = 0,
  Wall = 1,
  Door = 2,
}

/** The town as a tile grid plus rooms and props. Pure data: no rendering, no Pixi. */
export class TownMap {
  readonly ground: GroundKey[];
  readonly cell: Uint8Array;
  /** 1 where a prop blocks movement. */
  readonly blocked: Uint8Array;
  /** Extra traversal cost (roads, beds, couches) on top of the base step. */
  readonly cost: Float32Array;
  readonly room: Int16Array;
  rooms: Room[] = [];
  props: Prop[] = [];
  private nextProp = 1;

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
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
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

  addRoom(r: Omit<Room, 'id'>): Room {
    const room = { ...r, id: this.rooms.length };
    this.rooms.push(room);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (this.inBounds(x, y)) this.room[this.idx(x, y)] = room.id;
    return room;
  }

  addProp(p: Omit<Prop, 'id' | 'room' | 'drawn' | 'flat' | 'blocks'> & { blocks?: boolean; flat?: boolean; drawn?: boolean; cost?: number }): Prop {
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
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
      if (!this.inBounds(x, y)) continue;
      const i = this.idx(x, y);
      if (prop.blocks) this.blocked[i] = 1;
      if (p.cost) this.cost[i] = Math.max(this.cost[i], p.cost);
    }
    return prop;
  }

  propsWithUse(use: UseKind): Prop[] {
    return this.props.filter((p) => p.use === use);
  }
}
