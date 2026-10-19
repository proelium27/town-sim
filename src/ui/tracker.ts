import type { Art } from '../assets/loader';
import { ROLES } from '../sim/defs';
import { moodWord } from '../sim/social';
import type { Agent } from '../sim/types';
import type { Sim } from '../sim/sim';
import { badgesFor } from '../render/agentsView';
import { esc } from './util';

type Filter = 'all' | 'working' | 'break' | 'attention';

export function statusOf(a: Agent): Exclude<Filter, 'all' | 'attention'> | 'asleep' {
  if (a.action.kind === 'sleep' && a.action.stage === 'perform') return 'asleep';
  if (a.action.kind === 'work' || a.action.kind === 'meet') return 'working';
  return 'break';
}

const needsAttention = (a: Agent) => a.mood < 35 || badgesFor(a).some((b) => b.urgent);

/** Left sidebar: searchable roster with each person's status, active task and progress. */
export class Tracker {
  private list: HTMLUListElement;
  private search: HTMLInputElement;
  private filter: Filter = 'all';
  private rows = new Map<number, HTMLElement>();
  private countEl: HTMLElement;
  private segEl: HTMLElement;
  private emptyEl: HTMLElement;

  constructor(
    root: HTMLElement,
    private sim: Sim,
    art: Art,
    onSelect: (id: number) => void,
  ) {
    root.innerHTML = `
      <div class="tr-head">
        <div class="tr-title"><h2>People</h2><span class="count num" id="tr-count"></span></div>
        <label class="search"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
          <input type="search" placeholder="Search names, roles, tasks" aria-label="Search people" /></label>
        <div class="seg" role="tablist" aria-label="Filter people">
          <button role="tab" data-f="all" aria-selected="true">All</button>
          <button role="tab" data-f="working" aria-selected="false">Working</button>
          <button role="tab" data-f="break" aria-selected="false">Off task</button>
          <button role="tab" data-f="attention" aria-selected="false">Needs help</button>
        </div>
      </div>
      <ul class="people"></ul>
      <p class="tr-empty" hidden>No one matches.</p>`;
    this.list = root.querySelector('.people')!;
    this.search = root.querySelector('input')!;
    this.countEl = root.querySelector('#tr-count')!;
    this.segEl = root.querySelector('.seg')!;
    this.emptyEl = root.querySelector('.tr-empty')!;
    for (const a of sim.agents) {
      const li = document.createElement('li');
      li.innerHTML = `
        <button class="person" data-id="${a.id}">
          <img class="avatar" src="${art.portrait(a.outfit)}" alt="" width="32" height="32" />
          <span class="who"><b>${esc(a.name)}</b><span class="role">${ROLES[a.role].title}</span></span>
          <span class="st" data-f="st"></span>
          <span class="doing" data-f="doing"></span>
          <span class="task"><span class="t" data-f="task"></span><span class="pct num" data-f="pct"></span></span>
          <span class="prog"><i data-f="prog"></i></span>
          <span class="minis">
            <span class="mini" title="Mood"><span class="lbl">Mood</span><span class="bar" style="--c:var(--n-mood)"><i data-f="mood"></i></span></span>
            <span class="mini" title="Energy"><span class="lbl">Energy</span><span class="bar" style="--c:var(--n-energy)"><i data-f="energy"></i></span></span>
          </span>
        </button>`;
      this.list.appendChild(li);
      this.rows.set(a.id, li);
    }
    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
      if (b) onSelect(Number(b.dataset.id));
    });
    this.search.addEventListener('input', () => this.update(null));
    this.segEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-f]') as HTMLElement | null;
      if (!b) return;
      this.filter = b.dataset.f as Filter;
      for (const x of this.segEl.querySelectorAll('button')) x.setAttribute('aria-selected', String(x === b));
      this.update(null);
    });
  }

  update(selected: number | null): void {
    const q = this.search.value.trim().toLowerCase();
    let shown = 0;
    let working = 0;
    for (const a of this.sim.agents) {
      const li = this.rows.get(a.id)!;
      const st = statusOf(a);
      if (st === 'working') working++;
      const hay = `${a.name} ${ROLES[a.role].title} ${a.task?.title ?? ''} ${a.action.label}`.toLowerCase();
      const pass =
        (!q || hay.includes(q)) &&
        (this.filter === 'all' || (this.filter === 'attention' ? needsAttention(a) : this.filter === st));
      li.hidden = !pass;
      if (pass) shown++;
      const btn = li.firstElementChild as HTMLElement;
      btn.setAttribute('aria-current', String(a.id === selected));
      const set = (f: string, v: string) => {
        const el = li.querySelector(`[data-f="${f}"]`) as HTMLElement;
        if (el.textContent !== v) el.textContent = v;
      };
      const stEl = li.querySelector('[data-f="st"]') as HTMLElement;
      const stLabel = st === 'working' ? 'Working' : st === 'asleep' ? 'Asleep' : needsAttention(a) ? 'Needs help' : 'Off task';
      if (stEl.textContent !== stLabel) {
        stEl.textContent = stLabel;
        stEl.className = `st ${st} ${needsAttention(a) ? 'attn' : ''}`;
      }
      set('doing', a.action.stage === 'travel' && a.action.kind !== 'wander' && a.action.kind !== 'stroll' ? `Heading out: ${a.action.label}` : a.action.label);
      const t = a.task;
      set('task', t ? t.title : 'No task');
      const pct = t ? Math.min(100, Math.floor((t.progress / t.total) * 100)) : 0;
      set('pct', t ? `${pct}%` : '');
      (li.querySelector('[data-f="prog"]') as HTMLElement).style.width = `${pct}%`;
      (li.querySelector('[data-f="mood"]') as HTMLElement).style.width = `${a.mood}%`;
      (li.querySelector('[data-f="energy"]') as HTMLElement).style.width = `${a.needs.energy}%`;
      btn.title = `${a.name}: ${moodWord(a.mood)} mood`;
    }
    this.countEl.textContent = `${working}/${this.sim.agents.length} working`;
    this.emptyEl.hidden = shown > 0;
  }

  focusSearch(): void {
    this.search.focus();
  }
}
