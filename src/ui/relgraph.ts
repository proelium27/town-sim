import { FRIEND, RIVAL, first, kinship } from '../sim/social';
import type { Agent } from '../sim/types';
import type { Sim } from '../sim/sim';

interface Node {
  a: Agent;
  x: number;
  y: number;
}

/**
 * Radial relationship graph: the inspected person in the middle, everyone they know on a ring.
 * Family sits at the top in rose, then friends; rivals sink to the bottom. Line weight is strength of feeling.
 */
export class RelationGraph {
  readonly canvas = document.createElement('canvas');
  private nodes: Node[] = [];

  constructor(onPick: (id: number) => void) {
    this.canvas.className = 'graph';
    this.canvas.setAttribute('role', 'img');
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const hit = this.nodes.find((n) => (n.x - x) ** 2 + (n.y - y) ** 2 < 15 * 15);
      if (hit) onPick(hit.a.id);
    });
  }

  draw(sim: Sim, center: Agent): void {
    const cv = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || 300;
    const h = cv.clientHeight || 230;
    if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr);
    if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const others = sim.agents.filter((a) => a.id !== center.id && center.relations.has(a.id));
    const kin = new Set(others.filter((o) => kinship(sim, center, o)).map((o) => o.id));
    const rank = (o: Agent) => center.relations.get(o.id)!.opinion + (kin.has(o.id) ? 1000 : 0);
    others.sort((a, b) => rank(b) - rank(a));
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 28;
    const n = Math.max(1, others.length);
    this.nodes = others.map((a, i) => {
      const ang = -Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2 - Math.PI / n;
      return { a, x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R };
    });
    this.canvas.setAttribute('aria-label', `${center.name}'s relationships`);

    // Strong ties between the others, faintly, to show the wider web.
    for (let i = 0; i < this.nodes.length; i++) for (let j = i + 1; j < this.nodes.length; j++) {
      const A = this.nodes[i];
      const B = this.nodes[j];
      const o = ((A.a.relations.get(B.a.id)?.opinion ?? 0) + (B.a.relations.get(A.a.id)?.opinion ?? 0)) / 2;
      if (Math.abs(o) < FRIEND * 0.8) continue;
      ctx.strokeStyle = o > 0 ? 'rgba(130,200,130,0.16)' : 'rgba(235,110,95,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.quadraticCurveTo(cx, cy, B.x, B.y);
      ctx.stroke();
    }
    for (const nd of this.nodes) {
      const r = center.relations.get(nd.a.id)!;
      const s = Math.min(1, Math.abs(r.opinion) / 70);
      ctx.strokeStyle = kin.has(nd.a.id) && r.opinion > RIVAL
        ? `rgba(234,128,166,${0.45 + s * 0.5})`
        : r.opinion >= 0 ? `rgba(120,200,120,${0.25 + s * 0.7})` : `rgba(235,100,85,${0.3 + s * 0.7})`;
      ctx.lineWidth = 1 + s * 3.5;
      ctx.setLineDash(Math.abs(r.opinion) < 5 ? [2, 4] : []);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(nd.x, nd.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const node = (a: Agent, x: number, y: number, big: boolean, op?: number, family = false) => {
      ctx.fillStyle = '#2a241e';
      ctx.beginPath();
      ctx.arc(x, y, big ? 13 : 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = big ? 2 : 1.5;
      ctx.strokeStyle = big ? '#f2c14e' : op === undefined ? '#8a8072' : family && op > RIVAL ? '#ea80a6' : op >= FRIEND ? '#7cc47c' : op <= RIVAL ? '#eb6455' : '#8a8072';
      ctx.stroke();
      ctx.fillStyle = `hsl(${a.outfit.shirtHue} 45% 55%)`;
      ctx.beginPath();
      ctx.arc(x, y, big ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `${big ? 600 : 500} 11px Rubik, -apple-system, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = big ? '#f6efe0' : '#c9bfae';
      ctx.fillText(first(a), x, y + (big ? 16 : 11));
    };
    for (const nd of this.nodes) node(nd.a, nd.x, nd.y, false, center.relations.get(nd.a.id)!.opinion, kin.has(nd.a.id));
    node(center, cx, cy, true);
  }
}
