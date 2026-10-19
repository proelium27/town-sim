import { describe, expect, it } from 'vitest';
import { Nav } from '../src/sim/nav';
import { TownMap } from '../src/world/map';
import { buildTown } from '../src/world/town';

describe('nav', () => {
  it('walks around walls and refuses to cut corners', () => {
    const m = new TownMap(6, 5);
    for (let y = 0; y < 4; y++) m.cell[m.idx(2, y)] = 1; // wall with a gap at the bottom
    const nav = new Nav(m);
    const path = nav.findPath(m.idx(0, 0), m.idx(4, 0))!;
    expect(path).not.toBeNull();
    expect(path.some((i) => i === m.idx(2, 4))).toBe(true);
    // Diagonal past the wall end (1,3)->(2,4)? That would clip (2,3), which is wall.
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1];
      const b = path[k];
      const ax = a % 6, ay = (a / 6) | 0, bx = b % 6, by = (b / 6) | 0;
      if (ax !== bx && ay !== by) {
        expect(m.isWall(bx, ay) || m.isWall(ax, by)).toBe(false);
      }
    }
  });

  it('returns null when sealed off', () => {
    const m = new TownMap(5, 5);
    for (let y = 0; y < 5; y++) m.cell[m.idx(2, y)] = 1;
    expect(new Nav(m).findPath(m.idx(0, 0), m.idx(4, 4))).toBeNull();
  });

  it('prefers crosswalks to jaywalking', () => {
    const { map } = buildTown();
    const nav = new Nav(map);
    // From the office front door to a home across the road.
    const path = nav.findPath(map.idx(19, 23), map.idx(19, 30))!;
    expect(path).not.toBeNull();
    const roadCells = path.filter((i) => map.ground[i] === 'asphalt' || map.ground[i] === 'laneH');
    expect(roadCells.length).toBe(0);
  });
});

describe('town', () => {
  it('every use spot is reachable from every front door', () => {
    const { map, households } = buildTown();
    const nav = new Nav(map);
    const spots = map.props.filter((p) => p.use && p.spot);
    expect(spots.length).toBeGreaterThan(80);
    for (const h of households) {
      const from = map.idx(h.door.x, h.door.y);
      for (const p of spots) {
        const path = nav.findPath(from, map.idx(p.spot!.x, p.spot!.y), 60000);
        if (!path) throw new Error(`${p.key} (${p.use}) at ${p.spot!.x},${p.spot!.y} unreachable from ${h.name}`);
      }
    }
  });

  it('nothing blocks a doorway', () => {
    const { map } = buildTown();
    for (let i = 0; i < map.cell.length; i++) if (map.cell[i] === 2) expect(map.blocked[i]).toBe(0);
  });
});
