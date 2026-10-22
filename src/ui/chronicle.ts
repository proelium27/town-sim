import { familyTree, obituary, type TreeNode, yearPage, years } from '../sim/chronicle';
import type { Sim } from '../sim/sim';
import { esc } from './util';

type View = 'years' | 'family';

/** The town's chronicle: year pages written from the town's records, obituaries, and family trees. */
export class ChronicleBook {
  private el: HTMLElement;
  private view: View = 'years';
  /** Whose family tree is showing; null for the In memoriam page. */
  private focus: number | null = null;
  private sig = '';

  constructor(
    private sim: Sim,
    private onOpen: (id: number) => void,
  ) {
    this.el = Object.assign(document.createElement('section'), { className: 'book panel', hidden: true });
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'The town chronicle');
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act], [data-tree]') as HTMLElement | null;
      if (!t) return;
      if (t.dataset.tree) return this.show('family', Number(t.dataset.tree));
      const act = t.dataset.act;
      if (act === 'close') this.close();
      else if (act === 'view') this.show(t.dataset.view as View, this.focus);
      else if (act === 'memoriam') this.show('family', null);
      else if (act === 'open') {
        this.close();
        this.onOpen(Number(t.dataset.id));
      }
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show(this.view, this.focus);
  }

  show(view: View, person: number | null = null): void {
    this.view = view;
    this.focus = person;
    this.el.hidden = false;
    this.sig = '';
    this.update();
    this.el.querySelector('.bk-body')?.scrollTo(0, 0);
  }

  close(): void {
    this.el.hidden = true;
  }

  update(): void {
    if (!this.open) return;
    const s = this.sim;
    const sig = JSON.stringify([this.view, this.focus, s.chronicle.length, s.history.length, s.year, s.agents.length, s.deceased.length, this.view === 'years' ? 0 : s.day]);
    if (sig === this.sig) return;
    this.sig = sig;
    const scroll = this.el.querySelector('.bk-body')?.scrollTop ?? 0;
    this.el.innerHTML = `
      <header class="bk-head">
        <h2>The ${esc(s.name)} Chronicle</h2>
        <div class="seg" role="tablist" aria-label="Chronicle">
          <button role="tab" data-act="view" data-view="years" aria-selected="${this.view === 'years'}">Years</button>
          <button role="tab" data-act="view" data-view="family" aria-selected="${this.view === 'family'}">Families</button>
        </div>
        <button class="icon-btn" data-act="close" aria-label="Close chronicle" title="Close (H or Esc)"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
      </header>
      <div class="bk-body">${this.view === 'years' ? this.yearsHtml() : this.familyHtml()}</div>`;
    this.el.querySelector('.bk-body')!.scrollTop = scroll;
  }

  /** A person's name as a link to their family tree. */
  private who(id: number | undefined, label?: string): string {
    const p = id === undefined ? undefined : this.sim.person(id) ?? this.sim.departed.find((d) => d.id === id);
    return p ? `<button class="name" data-tree="${p.id}">${esc(label ?? p.name)}</button>` : esc(label ?? '');
  }

  /** Feed text with the people in it linked to their trees, by full name or first name. */
  private linked(text: string, ids: (number | undefined)[]): string {
    let html = esc(text);
    for (const id of ids) {
      const p = id === undefined ? undefined : this.sim.person(id);
      if (!p) continue;
      for (const n of [p.name, p.name.split(' ')[0]]) {
        const re = new RegExp(`\\b${esc(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?![^<]*</button>)`);
        if (re.test(html)) {
          html = html.replace(re, this.who(p.id, n));
          break;
        }
      }
    }
    return html;
  }

  private yearsHtml(): string {
    return years(this.sim)
      .map((y) => {
        const p = yearPage(this.sim, y);
        const lines = p.lines.length
          ? `<ol class="bk-lines">${p.lines.map((l) => `<li><span class="bk-season">${l.season}</span><span>${this.linked(l.text, [l.agentId, l.otherId])}</span></li>`).join('')}</ol>`
          : '';
        return `<article class="bk-year">
          <h3>Year ${p.year}${p.current ? ' <small>so far</small>' : ''}</h3>
          <p class="bk-sum">${esc(p.summary)}</p>
          ${lines}
          ${p.closing ? `<p class="bk-close">${esc(p.closing)}</p>` : ''}
          <p class="bk-by">${esc(p.byline)}</p>
        </article>`;
      })
      .join('');
  }

  private chips(label: string, nodes: TreeNode[]): string {
    if (!nodes.length) return '';
    return `<div class="bk-gen"><span class="k">${label}</span><div class="bk-chips">${nodes.map((n) => `<button class="bk-chip${n.alive ? '' : ' gone'}" data-tree="${n.id}">${esc(n.name)} <span class="num">${esc(n.note)}</span></button>`).join('')}</div></div>`;
  }

  private familyHtml(): string {
    const s = this.sim;
    if (this.focus === null) {
      const dead = [...s.deceased].reverse();
      const living = [...s.agents].sort((a, b) => a.name.localeCompare(b.name));
      return `
        <h3>In memoriam</h3>
        ${dead.length ? `<ul class="bk-obits">${dead.map((d) => `<li>${this.linked(obituary(s, d), [d.id])}</li>`).join('')}</ul>` : `<p class="bk-sum">Nobody has died in ${esc(s.name)} yet.</p>`}
        <h3>Start from anyone</h3>
        <div class="bk-chips">${living.map((a) => `<button class="bk-chip" data-tree="${a.id}">${esc(a.name)}</button>`).join('')}</div>`;
    }
    const t = familyTree(s, this.focus);
    if (!t) return '<p class="bk-sum">Nobody by that name.</p>';
    const dead = s.deceased.find((d) => d.id === this.focus);
    return `
      <button class="chip-btn" data-act="memoriam">← In memoriam and everyone</button>
      <div class="bk-person">
        <h3>${esc(t.person.name)} <small class="num">${esc(t.person.note)}</small></h3>
        ${t.person.alive ? `<button class="btn" data-act="open" data-id="${t.person.id}">Open in inspector</button>` : ''}
      </div>
      ${dead ? `<p class="bk-obit">${this.linked(obituary(s, dead), [dead.id])}</p>` : ''}
      ${this.chips('Grandparents', t.grandparents)}
      ${this.chips('Parents', t.parents)}
      ${this.chips('Partner', t.partner ? [t.partner] : [])}
      ${this.chips('Siblings', t.siblings)}
      ${this.chips('Children', t.children)}
      ${this.chips('Grandchildren', t.grandchildren)}
      ${!t.parents.length && !t.children.length && !t.partner && !t.siblings.length ? `<p class="bk-sum">No family recorded in ${esc(this.sim.name)}.</p>` : ''}`;
  }
}
