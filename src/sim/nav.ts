import type { TownMap } from '../world/map';

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** Binary min-heap keyed by float priorities, storing int payloads. */
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.vals.length;
  }

  clear(): void {
    this.keys.length = 0;
    this.vals.length = 0;
  }

  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = v.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }

  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    const n = v.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

/**
 * 8-way grid A* over the town. Diagonal steps may not cut wall or furniture corners,
 * and each cell's ground cost (roads, grass, beds) is added to the step.
 */
export class Nav {
  private g: Float32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private prev: Int32Array;
  private gen = 1;
  private heap = new Heap();
  /** Searches run, for profiling. */
  searches = 0;

  constructor(readonly map: TownMap) {
    const n = map.w * map.h;
    this.g = new Float32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.prev = new Int32Array(n);
  }

  private passable(x: number, y: number, goal: number): boolean {
    const m = this.map;
    if (!m.inBounds(x, y)) return false;
    // The goal may be a seat on a "blocked" prop footprint edge case; walls never are.
    return m.walkable(x, y) || (m.idx(x, y) === goal && !m.isWall(x, y));
  }

  private heuristic(a: number, b: number): number {
    const w = this.map.w;
    const dx = Math.abs((a % w) - (b % w));
    const dy = Math.abs(((a / w) | 0) - ((b / w) | 0));
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  }

  /** Path of cell indices from start (exclusive) to goal (inclusive), or null if unreachable. */
  findPath(start: number, goal: number, maxExpand = 20000): number[] | null {
    const m = this.map;
    const w = m.w;
    if (start === goal) return [];
    if (!this.passable(goal % w, (goal / w) | 0, goal)) return null;
    this.searches++;
    const gen = this.nextGen();
    const { g, stamp, closed, prev, heap } = this;
    heap.clear();
    g[start] = 0;
    stamp[start] = gen;
    prev[start] = -1;
    heap.push(this.heuristic(start, goal), start);
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goal) return this.unwind(goal, start);
      if (++expanded > maxExpand) return null;
      const cx = cur % w;
      const cy = (cur / w) | 0;
      for (const [dx, dy, base] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        const n = ny * w + nx;
        if (!this.passable(nx, ny, goal) || closed[n] === gen) continue;
        if (dx && dy && (!this.passable(cx + dx, cy, -1) || !this.passable(cx, cy + dy, -1))) continue;
        const ng = g[cur] + base * (1 + m.cost[n]);
        if (stamp[n] !== gen || ng < g[n]) {
          stamp[n] = gen;
          g[n] = ng;
          prev[n] = cur;
          heap.push(ng + this.heuristic(n, goal), n);
        }
      }
    }
    return null;
  }

  private unwind(goal: number, start: number): number[] {
    const out: number[] = [];
    let c = goal;
    while (c !== start && c !== -1) {
      out.push(c);
      c = this.prev[c];
    }
    return out.reverse();
  }

  private nextGen(): number {
    this.gen++;
    if (this.gen >= 0xfffffff0) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    return this.gen;
  }
}
