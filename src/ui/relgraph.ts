import { FRIEND, RIVAL, first } from '../sim/social';
import type { Agent } from '../sim/types';
import type { Sim } from '../sim/sim';

interface Node {
  a: Agent;
  x: number;
  y: number;
}

/**
 * Radial relationship graph: the inspected person in the middle, everyone they know on a ring.
 * Friends float to the top, rivals sink to the bottom; line weight is strength of feeling.
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
    others.sort((a, b) => (center.relations.get(b.id)!.opinion) - (center.relations.get(a.id)!.opinion));
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
      ctx.strokeStyle = o > 0 ? 'rgba(60,150,90,0.18)' : 'rgba(200,70,60,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.quadraticCurveTo(cx, cy, B.x, B.y);
      ctx.stroke();
    }
    for (const nd of this.nodes) {
      const r = center.relations.get(nd.a.id)!;
      const s = Math.min(1, Math.abs(r.opinion) / 70);
      ctx.strokeStyle = r.opinion >= 0 ? `rgba(46,140,80,${0.25 + s * 0.7})` : `rgba(200,60,50,${0.3 + s * 0.7})`;
      ctx.lineWidth = 1 + s * 3.5;
      ctx.setLineDash(Math.abs(r.opinion) < 5 ? [2, 4] : []);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(nd.x, nd.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const node = (a: Agent, x: number, y: number, big: boolean, op?: number) => {
      ctx.fillStyle = '#fbf8f1';
      ctx.beginPath();
      ctx.arc(x, y, big ? 13 : 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = big ? 2 : 1.5;
      ctx.strokeStyle = big ? '#3b5bd9' : op === undefined ? '#999' : op >= FRIEND ? '#2e8c50' : op <= RIVAL ? '#c83c32' : '#8a8f9c';
      ctx.stroke();
      ctx.fillStyle = `hsl(${a.outfit.shirtHue} 45% 55%)`;
      ctx.beginPath();
      ctx.arc(x, y, big ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `${big ? 650 : 500} 11px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = big ? '#1f2433' : '#535a6b';
      ctx.fillText(first(a), x, y + (big ? 16 : 11));
    };
    for (const nd of this.nodes) node(nd.a, nd.x, nd.y, false, center.relations.get(nd.a.id)!.opinion);
    node(center, cx, cy, true);
  }
}
