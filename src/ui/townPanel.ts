import { ageOf } from '../sim/agents';
import { ADULT_AGE, PRIORITY_KEYS, PRIORITY_LABEL, type PriorityKey } from '../sim/defs';
import { foodBalance } from '../sim/economy';
import { WORLD_EVENTS, type WorldEventKey, triggerWorldEvent } from '../sim/events';
import { allocateRoles, buildCap, capacity, stageOf } from '../sim/planner';
import { first } from '../sim/social';
import type { Sim } from '../sim/sim';
import { esc, hhmm } from './util';

const STAGE_LABEL = { clearing: 'Clearing the site', supplying: 'Waiting for materials', building: 'Under construction' } as const;
const LEVELS = ['Low', 'Normal', 'High'];

/** Left-sidebar Town tab: stores, the player's priorities and world events, live projects, history. */
export class TownPanel {
  private sig = '';

  constructor(
    private root: HTMLElement,
    private sim: Sim,
    private onFocus: (x: number, y: number) => void,
    private onPerson: (id: number) => void,
  ) {
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!el) return;
      const act = el.dataset.act;
      if (act === 'prio') {
        sim.priorities[el.dataset.key as PriorityKey] = Number(el.dataset.level);
        allocateRoles(sim);
      } else if (act === 'event') {
        triggerWorldEvent(sim, el.dataset.key as WorldEventKey);
      } else if (act === 'site') {
        const pr = sim.projects.find((p) => p.id === Number(el.dataset.id));
        if (pr) this.onFocus(pr.x + pr.w / 2, pr.y + pr.h / 2);
      } else if (act === 'person') {
        this.onPerson(Number(el.dataset.id));
        return;
      }
      this.sig = '';
      this.update();
    });
  }

  update(): void {
    const sim = this.sim;
    const pop = sim.agents;
    const kids = pop.filter((a) => ageOf(sim, a) < ADULT_AGE).length;
    const elders = pop.filter((a) => a.role === 'retired').length;
    const homes = sim.town.households.filter((h) => h.building >= 0);
    const beds = homes.reduce((n, h) => n + capacity(sim, h.id), 0);
    const homeless = pop.filter((a) => sim.town.households[a.household].building < 0).length;
    const fb = foodBalance(sim);
    const net = fb.produce - fb.eat;
    const projects = sim.projects.map((p) => ({ p, stage: stageOf(sim, p) }));
    const sig = JSON.stringify([
      pop.length, kids, elders, beds, homeless, Math.round(sim.stock.food), Math.round(sim.stock.wood), Math.round(sim.stock.stone), Math.round(net),
      sim.priorities, projects.map(({ p, stage }) => [p.id, stage, Math.floor((p.progress / p.work) * 50), p.delivered, p.builders.size]),
      sim.history.length, !!sim.events.drought, !!sim.events.festival,
    ]);
    if (sig === this.sig) return;
    this.sig = sig;
    const bar = (v: number, max: number, c: string) => `<span class="bar" style="--c:${c}"><i style="width:${Math.min(100, (v / Math.max(1, max)) * 100)}%"></i></span>`;
    const ev = sim.events;
    this.root.innerHTML = `
      <section class="tp-sec">
        <dl class="tp-stats">
          <div><dt>People</dt><dd class="num">${pop.length}</dd><span>${kids} kids, ${elders} retired</span></div>
          <div><dt>Homes</dt><dd class="num">${homes.length}</dd><span>${beds} beds${homeless ? `, <b class="neg">${homeless} homeless</b>` : ''}</span></div>
          <div><dt>Buildings</dt><dd class="num">${sim.map.buildings.length}</dd><span>${sim.projects.length} going up</span></div>
        </dl>
      </section>
      <section class="tp-sec">
        <h3>Stores</h3>
        <div class="stores">
          <div class="store"><span class="lbl">Food</span>${bar(sim.stock.food, 300, 'var(--n-hunger)')}<span class="num">${Math.round(sim.stock.food)}</span><span class="rate num ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${Math.round(net)}/day</span></div>
          <div class="store"><span class="lbl">Wood</span>${bar(sim.stock.wood, 200, 'oklch(0.55 0.09 60)')}<span class="num">${Math.round(sim.stock.wood)}</span><span class="rate"></span></div>
          <div class="store"><span class="lbl">Stone</span>${bar(sim.stock.stone, 200, 'oklch(0.6 0.01 80)')}<span class="num">${Math.round(sim.stock.stone)}</span><span class="rate"></span></div>
        </div>
        ${ev.drought ? '<p class="warn-line">Drought: nothing is growing.</p>' : ''}
      </section>
      <section class="tp-sec">
        <h3>Priorities <small>what the town meetings lean toward</small></h3>
        <div class="prios">
          ${PRIORITY_KEYS.map((k) => `<div class="prio"><span>${PRIORITY_LABEL[k]}</span><div class="seg mini-seg" role="radiogroup" aria-label="${PRIORITY_LABEL[k]} priority">${LEVELS.map((l, i) => `<button role="radio" aria-checked="${sim.priorities[k] === i}" data-act="prio" data-key="${k}" data-level="${i}">${l}</button>`).join('')}</div></div>`).join('')}
        </div>
      </section>
      <section class="tp-sec">
        <h3>World events</h3>
        <div class="events">
          ${WORLD_EVENTS.map((w) => `<button class="ev-btn ${w.tone}" data-act="event" data-key="${w.key}" title="${esc(w.hint)}" ${(w.key === 'festival' && ev.festival) || (w.key === 'drought' && ev.drought) ? 'disabled' : ''}><b>${w.label}</b><span>${esc(w.hint)}</span></button>`).join('')}
        </div>
      </section>
      <section class="tp-sec">
        <h3>Being built <small>${projects.length ? '' : 'nothing right now'}</small></h3>
        <ul class="projects">
          ${projects.map(({ p, stage }) => {
            const who = sim.agent(p.proposedBy);
            const pct = Math.floor((p.progress / p.work) * 100);
            const cap = Math.floor((buildCap(p) / p.work) * 100);
            return `<li><button class="proj" data-act="site" data-id="${p.id}">
              <span class="proj-top"><b>${esc(p.name)}</b><span class="num">${pct}%</span></span>
              <span class="proj-bar"><i class="cap" style="width:${cap}%"></i><i style="width:${pct}%"></i></span>
              <span class="proj-meta">${STAGE_LABEL[stage]} · wood ${Math.floor(Math.min(p.delivered.wood, p.need.wood))}/${p.need.wood} · stone ${Math.floor(Math.min(p.delivered.stone, p.need.stone))}/${p.need.stone} · ${p.builders.size} working</span>
              <span class="proj-why">${who ? `${esc(first(who))}: ` : ''}“${esc(p.reason)}”</span>
            </button></li>`;
          }).join('')}
        </ul>
      </section>
      <section class="tp-sec">
        <h3>History</h3>
        <ol class="history">${[...sim.history].reverse().slice(0, 30).map((h) => `<li><time class="num">Day ${Math.floor(h.t / 1440) + 1}<br>${hhmm(h.t)}</time><span>${esc(h.text)}</span></li>`).join('')}</ol>
      </section>`;

  }
}
