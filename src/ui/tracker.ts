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

export const needsAttention = (a: Agent) => a.mood < 35 || badgesFor(a).some((b) => b.urgent);

const STATUS_LABEL = { working: 'Working', asleep: 'Asleep', break: 'Off task' } as const;

/** Left panel: compact searchable roster. Collapses to a strip of portraits. */
export class Tracker {
  private list: HTMLUListElement;
  private search: HTMLInputElement;
  private filter: Filter = 'all';
  private rows = new Map<number, HTMLElement>();
  private countEl: HTMLElement;
  private segEl: HTMLElement;
  private emptyEl: HTMLElement;

  constructor(
    private root: HTMLElement,
    private sim: Sim,
    art: Art,
    onSelect: (id: number) => void,
    private onToggle: () => void = () => {},
  ) {
    root.innerHTML = `
      <div class="tr-head">
        <div class="tr-title">
          <h1 class="wordmark">Townsfolk</h1>
          <span class="count num" id="tr-count"></span>
          <button class="icon-btn tr-toggle" data-act="collapse" aria-expanded="true" aria-label="Collapse people list" title="Collapse (P)"><svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5"/></svg></button>
        </div>
        <label class="search"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
          <input type="search" placeholder="Search people, jobs, tasks" aria-label="Search people" /><kbd>/</kbd></label>
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
          <span class="face"><img class="avatar" src="${art.portrait(a.outfit)}" alt="" width="32" height="32" /><span class="dot" data-f="dot"></span></span>
          <span class="who"><b>${esc(a.name.split(' ')[0])}</b> <span class="role">${ROLES[a.role].title}</span></span>
          <span class="doing" data-f="doing"></span>
          <span class="vitals" aria-hidden="true">
            <span class="vbar" style="--c:var(--n-mood)" title="Mood"><i data-f="mood"></i></span>
            <span class="vbar" style="--c:var(--n-energy)" title="Energy"><i data-f="energy"></i></span>
          </span>
          <span class="tprog" aria-hidden="true"><i data-f="prog"></i></span>
        </button>`;
      this.list.appendChild(li);
      this.rows.set(a.id, li);
    }
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-act="collapse"]')) return this.toggle();
      const b = t.closest('[data-id]') as HTMLElement | null;
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

  get collapsed(): boolean {
    return this.root.classList.contains('collapsed');
  }

  toggle(force?: boolean): void {
    const c = force ?? !this.collapsed;
    this.root.classList.toggle('collapsed', c);
    const btn = this.root.querySelector('[data-act="collapse"]') as HTMLElement;
    btn.setAttribute('aria-expanded', String(!c));
    btn.setAttribute('aria-label', c ? 'Expand people list' : 'Collapse people list');
    btn.title = c ? 'Expand (P)' : 'Collapse (P)';
    this.onToggle();
  }

  update(selected: number | null): void {
    const q = this.search.value.trim().toLowerCase();
    let shown = 0;
    let working = 0;
    for (const a of this.sim.agents) {
      const li = this.rows.get(a.id)!;
      const st = statusOf(a);
      const attn = needsAttention(a);
      if (st === 'working') working++;
      const hay = `${a.name} ${ROLES[a.role].title} ${a.task?.title ?? ''} ${a.action.label}`.toLowerCase();
      const pass =
        (!q || hay.includes(q)) &&
        (this.filter === 'all' || (this.filter === 'attention' ? attn : this.filter === st));
      li.hidden = !pass;
      if (pass) shown++;
      const btn = li.firstElementChild as HTMLElement;
      btn.setAttribute('aria-current', String(a.id === selected));
      const cls = `person ${st}${attn ? ' attn' : ''}`;
      if (btn.className !== cls) btn.className = cls;
      const set = (f: string, v: string) => {
        const el = li.querySelector(`[data-f="${f}"]`) as HTMLElement;
        if (el.textContent !== v) el.textContent = v;
      };
      set('doing', a.action.stage === 'travel' && a.action.kind !== 'wander' && a.action.kind !== 'stroll' ? `→ ${a.action.label}` : a.action.label);
      const t = a.task;
      const pct = t ? Math.min(100, Math.floor((t.progress / t.total) * 100)) : 0;
      (li.querySelector('[data-f="prog"]') as HTMLElement).style.width = `${pct}%`;
      (li.querySelector('[data-f="mood"]') as HTMLElement).style.height = `${a.mood}%`;
      (li.querySelector('[data-f="energy"]') as HTMLElement).style.height = `${a.needs.energy}%`;
      const label = `${a.name}, ${ROLES[a.role].title}. ${attn ? 'Needs help' : STATUS_LABEL[st]}: ${a.action.label}. ${moodWord(a.mood)} mood, energy ${Math.round(a.needs.energy)}.${t ? ` Task: ${t.title}, ${pct}%.` : ''}`;
      if (btn.title !== label) {
        btn.title = label;
        btn.setAttribute('aria-label', label);
      }
    }
    this.countEl.textContent = `${working}/${this.sim.agents.length} at work`;
    this.emptyEl.hidden = shown > 0;
  }

  focusSearch(): void {
    if (this.collapsed) this.toggle(false);
    this.search.focus();
  }
}
