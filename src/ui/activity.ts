import { first } from '../sim/social';
import type { ActivityKind } from '../sim/types';
import type { Sim } from '../sim/sim';
import { esc, hhmm, linkNames } from './util';

type Filter = 'all' | ActivityKind;
const KIND_LABEL: Record<ActivityKind, string> = { work: 'Work', social: 'Social', life: 'Life', event: 'Town', build: 'Build', family: 'Family' };

/** Bottom feed: latest happenings at a glance; expands into the full, filterable log. */
export class ActivityLog {
  private list: HTMLOListElement;
  private filter: Filter = 'all';
  private onlySelected = false;
  private version = -1;
  private lastSelected: number | null = null;
  private selBtn: HTMLButtonElement;

  constructor(
    private root: HTMLElement,
    private sim: Sim,
    onSelect: (id: number) => void,
  ) {
    root.innerHTML = `
      <div class="act-head">
        <h2>Activity</h2>
        <div class="seg" role="tablist" aria-label="Filter activity">
          <button role="tab" data-f="all" aria-selected="true">All</button>
          <button role="tab" data-f="work" aria-selected="false">Work</button>
          <button role="tab" data-f="social" aria-selected="false">Social</button>
          <button role="tab" data-f="build" aria-selected="false">Build</button>
          <button role="tab" data-f="family" aria-selected="false">Family</button>
          <button role="tab" data-f="life" aria-selected="false">Life</button>
          <button role="tab" data-f="event" aria-selected="false">Town</button>
        </div>
        <button class="chip-btn" data-act="sel" aria-pressed="false" hidden></button>
        <button class="icon-btn act-toggle" data-act="expand" aria-expanded="false" aria-label="Expand activity log" title="Expand (L)"><svg viewBox="0 0 16 16"><path d="M3 10l5-5 5 5"/></svg></button>
      </div>
      <ol class="feed" aria-live="polite"></ol>`;
    this.list = root.querySelector('.feed')!;
    this.selBtn = root.querySelector('[data-act="sel"]')!;
    root.querySelector('.seg')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-f]') as HTMLElement | null;
      if (!b) return;
      this.filter = b.dataset.f as Filter;
      for (const x of root.querySelectorAll('.seg button')) x.setAttribute('aria-selected', String(x === b));
      this.version = -1;
      if (!this.expanded) this.toggle(true);
    });
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-act="expand"]')) return this.toggle();
      if (t.closest('[data-act="sel"]')) {
        this.onlySelected = !this.onlySelected;
        this.selBtn.setAttribute('aria-pressed', String(this.onlySelected));
        this.version = -1;
        return;
      }
      const b = t.closest('[data-id]') as HTMLElement | null;
      if (b) onSelect(Number(b.dataset.id));
    });
  }

  get expanded(): boolean {
    return this.root.classList.contains('expanded');
  }

  toggle(force?: boolean): void {
    const x = force ?? !this.expanded;
    this.root.classList.toggle('expanded', x);
    const btn = this.root.querySelector('[data-act="expand"]') as HTMLElement;
    btn.setAttribute('aria-expanded', String(x));
    btn.setAttribute('aria-label', x ? 'Shrink activity log' : 'Expand activity log');
    btn.title = x ? 'Shrink (L)' : 'Expand (L)';
    this.list.scrollTop = 0;
  }

  update(selected: number | null): void {
    const who = selected === null ? undefined : this.sim.agent(selected);
    this.selBtn.hidden = !who;
    if (who && this.selBtn.dataset.id !== String(who.id)) {
      this.selBtn.dataset.id = String(who.id);
      this.selBtn.textContent = `Only ${first(who)}`;
    }
    if (this.version === this.sim.activityVersion && (!this.onlySelected || selected === this.lastSelected)) return;
    this.version = this.sim.activityVersion;
    this.lastSelected = selected;
    const items = this.sim.activity
      .filter((e) => (this.filter === 'all' || e.kind === this.filter) && (!this.onlySelected || selected === null || e.agentId === selected || e.otherId === selected))
      .slice(-150)
      .reverse();
    this.list.innerHTML = items.length
      ? items.map((e) => `<li class="${e.kind} ${e.tone}"><time class="num">${hhmm(e.t)}</time><span class="tag">${KIND_LABEL[e.kind]}</span><span class="txt">${linkNames(this.sim, e)}</span></li>`).join('')
      : `<li class="empty">${this.emptyText(who)}</li>`;
  }

  /** Says why the list is empty, so a filter never reads as "nothing is happening". */
  private emptyText(who: { name: string } | undefined): string {
    if (this.onlySelected && who) return `Nothing from ${esc(who.name.split(' ')[0])} yet${this.filter === 'all' ? '' : ` in ${KIND_LABEL[this.filter].toLowerCase()}`}.`;
    if (this.filter !== 'all') return `No ${KIND_LABEL[this.filter].toLowerCase()} news yet.`;
    return 'Nothing yet. Give it a minute; the town is just waking up.';
  }
}
