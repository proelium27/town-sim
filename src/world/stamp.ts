import type { Facing, GroundKey, PropKey } from '../assets/manifest';
import { Cell, type DrawnKey, type Prop, type RoomKind, type TownMap, type UseKind } from './map';

export interface PropOpts {
  use?: UseKind;
  spot?: [number, number, Facing];
  blocks?: boolean;
  flat?: boolean;
  cost?: number;
  household?: number;
  building?: number;
}

const FLIP: Record<Facing, Facing> = { up: 'down', down: 'up', left: 'left', right: 'right' };

/**
 * Drawing helpers for laying out rooms and furniture. With `flipY`, local coordinates are mirrored
 * vertically inside a w x h box, so one template can face its door up or down.
 */
export class Stamper {
  constructor(
    readonly m: TownMap,
    readonly ox = 0,
    readonly oy = 0,
    readonly bh = 0,
    readonly flipY = false,
    public building?: number,
  ) {}

  /** Local box-relative rect to world coordinates. */
  at(dx: number, dy: number, _w = 1, h = 1): [number, number] {
    const y = this.flipY ? this.bh - dy - h : dy;
    return [this.ox + dx, this.oy + y];
  }

  private face(f: Facing): Facing {
    return this.flipY ? FLIP[f] : f;
  }

  fill(dx: number, dy: number, w: number, h: number, g: GroundKey): void {
    const [x, y] = this.at(dx, dy, w, h);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.m.setGround(xx, yy, g);
  }

  wallRect(dx: number, dy: number, w: number, h: number): void {
    const [x, y] = this.at(dx, dy, w, h);
    for (let xx = x; xx < x + w; xx++) {
      this.m.setCell(xx, y, Cell.Wall);
      this.m.setCell(xx, y + h - 1, Cell.Wall);
    }
    for (let yy = y; yy < y + h; yy++) {
      this.m.setCell(x, yy, Cell.Wall);
      this.m.setCell(x + w - 1, yy, Cell.Wall);
    }
  }

  hwall(dx0: number, dx1: number, dy: number): void {
    for (let dx = dx0; dx <= dx1; dx++) {
      const [x, y] = this.at(dx, dy);
      this.m.setCell(x, y, Cell.Wall);
    }
  }

  vwall(dx: number, dy0: number, dy1: number): void {
    for (let dy = dy0; dy <= dy1; dy++) {
      const [x, y] = this.at(dx, dy);
      this.m.setCell(x, y, Cell.Wall);
    }
  }

  door(dx: number, dy: number, floor?: GroundKey): void {
    const [x, y] = this.at(dx, dy);
    this.m.setCell(x, y, Cell.Door);
    if (floor) this.m.setGround(x, y, floor);
  }

  room(name: string, kind: RoomKind, dx: number, dy: number, w: number, h: number, floor: GroundKey, building: string) {
    this.fill(dx, dy, w, h, floor);
    const [x, y] = this.at(dx, dy, w, h);
    return this.m.addRoom({ name, kind, x, y, w, h, building });
  }

  prop(key: PropKey, dx: number, dy: number, w: number, h: number, o: PropOpts = {}): Prop {
    return this.place(key, false, dx, dy, w, h, o);
  }

  drawn(key: DrawnKey, dx: number, dy: number, w: number, h: number, o: PropOpts = {}): Prop {
    return this.place(key, true, dx, dy, w, h, o);
  }

  /** A walkable chair tile that is also the use spot. */
  seat(key: PropKey, dx: number, dy: number, facing: Facing, use: UseKind, household?: number): Prop {
    return this.prop(key, dx, dy, 1, 1, { use, spot: [dx, dy, facing], blocks: false, cost: 2, household });
  }

  /** An invisible use spot (e.g. one end of the ping pong table). */
  spot(use: UseKind, dx: number, dy: number, facing: Facing, household?: number): Prop {
    const [x, y] = this.at(dx, dy);
    return this.m.addProp({ key: 'plant', x: 0, y: 0, w: 0, h: 0, use, spot: { x, y, facing: this.face(facing) }, blocks: false, household, building: this.building });
  }

  private place(key: PropKey | DrawnKey, drawn: boolean, dx: number, dy: number, w: number, h: number, o: PropOpts): Prop {
    const [x, y] = this.at(dx, dy, w, h);
    let spot: Prop['spot'];
    if (o.spot) {
      const [sx, sy] = this.at(o.spot[0], o.spot[1]);
      spot = { x: sx, y: sy, facing: this.face(o.spot[2]) };
    }
    return this.m.addProp({
      key, drawn, x, y, w, h, use: o.use, spot, blocks: o.blocks, flat: o.flat, cost: o.cost,
      household: o.household, building: o.building ?? this.building,
    });
  }
}
