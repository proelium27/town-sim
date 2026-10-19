import { first } from '../sim/social';
import type { Activity, ActivityKind } from '../sim/types';
import type { Sim } from '../sim/sim';
import { esc, hhmm } from './util';

type Filter = 'all' | ActivityKind;
const KIND_LABEL: Record<ActivityKind, string> = { work: 'Work', social: 'Social', life: 'Life', event: 'Town', build: 'Build', family: 'Family' };

/** Bottom feed: a live stream of what everyone is doing, filterable, with clickable names. */
export class ActivityLog {
  private list: HTMLOListElement;
  private filter: Filter = 'all';
  private onlySelected = false;
  private version = -1;
  private lastSelected: number | null = null;

  constructor(
    root: HTMLElement,
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
          <button role="tab" data-f="build" aria-selected="false">Building</button>
          <button role="tab" data-f="family" aria-selected="false">Family</button>
          <button role="tab" data-f="life" aria-selected="false">Life</button>
          <button role="tab" data-f="event" aria-selected="false">Town</button>
        </div>
        <label class="check"><input type="checkbox" id="act-sel" /> Selected person only</label>
      </div>
      <ol class="feed" aria-live="polite"></ol>`;
    this.list = root.querySelector('.feed')!;
    root.querySelector('.seg')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-f]') as HTMLElement | null;
      if (!b) return;
      this.filter = b.dataset.f as Filter;
      for (const x of root.querySelectorAll('.seg button')) x.setAttribute('aria-selected', String(x === b));
      this.version = -1;
    });
    (root.querySelector('#act-sel') as HTMLInputElement).addEventListener('change', (e) => {
      this.onlySelected = (e.target as HTMLInputElement).checked;
      this.version = -1;
    });
    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
      if (b) onSelect(Number(b.dataset.id));
    });
  }

  private line(e: Activity): string {
    let html = esc(e.text);
    // Turn first names into links to that person.
    for (const id of [e.agentId, e.otherId]) {
      const a = this.sim.agent(id);
      if (!a) continue;
      const n = esc(first(a));
      html = html.replace(new RegExp(`\\b${n}\\b`), `<button class="name" data-id="${a.id}">${n}</button>`);
    }
    return html;
  }

  update(selected: number | null): void {
    if (this.version === this.sim.activityVersion && (!this.onlySelected || selected === this.lastSelected)) return;
    this.version = this.sim.activityVersion;
    this.lastSelected = selected;
    const items = this.sim.activity
      .filter((e) => (this.filter === 'all' || e.kind === this.filter) && (!this.onlySelected || selected === null || e.agentId === selected || e.otherId === selected))
      .slice(-150)
      .reverse();
    this.list.innerHTML = items.length
      ? items.map((e) => `<li class="${e.kind} ${e.tone}"><time class="num">${hhmm(e.t)}</time><span class="tag">${KIND_LABEL[e.kind]}</span><span class="txt">${this.line(e)}</span></li>`).join('')
      : '<li class="empty">Nothing yet. Give it a minute; the town is just waking up.</li>';
  }
}
