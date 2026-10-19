import type { Art } from '../assets/loader';
import { xpToNext } from '../sim/ai';
import { NEED_KEYS, NEED_LABEL, ROLES, SKILL_KEYS, SKILL_LABEL, TRAITS } from '../sim/defs';
import { moodParts, moodTarget, moodWord, relationLabel } from '../sim/social';
import type { Agent } from '../sim/types';
import type { Sim } from '../sim/sim';
import { RelationGraph } from './relgraph';
import { dayTime, duration, esc, hhmm, hourLabel } from './util';

const NEED_COLOR: Record<string, string> = {
  energy: 'var(--n-energy)', hunger: 'var(--n-hunger)', hygiene: 'var(--n-hygiene)',
  social: 'var(--n-social)', fun: 'var(--n-fun)', work: 'var(--n-work)',
};

type Tab = 'needs' | 'day' | 'people' | 'mind';
const TABS: [Tab, string][] = [['needs', 'Needs'], ['day', 'Day'], ['people', 'People'], ['mind', 'Mind']];

/** Right panel: everything about one person. Skeleton built per selection, values patched in place. */
export class Inspector {
  private agentId: number | null = null;
  private graph: RelationGraph;
  private sigs: Record<string, string> = {};
  /** Remembered across selections, so flipping between people keeps your place. */
  private tab: Tab = 'needs';

  constructor(
    private root: HTMLElement,
    private sim: Sim,
    private art: Art,
    private hooks: { select: (id: number | null) => void; follow: () => void; isFollowing: () => boolean },
  ) {
    this.graph = new RelationGraph((id) => hooks.select(id));
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!el) return;
      if (el.dataset.act === 'close') hooks.select(null);
      if (el.dataset.act === 'follow') hooks.follow();
      if (el.dataset.act === 'person') hooks.select(Number(el.dataset.id));
      if (el.dataset.act === 'tab') this.setTab(el.dataset.tab as Tab);
      this.sigs.head = '';
    });
  }

  show(id: number | null): void {
    if (id === this.agentId) return;
    this.agentId = id;
    this.sigs = {};
    this.root.hidden = id === null;
    document.body.classList.toggle('inspecting', id !== null);
    if (id === null) return;
    const a = this.sim.agent(id)!;
    const role = ROLES[a.role];
    const wp = this.sim.town.workplaces.find((w) => w.id === role.workplace)!;
    this.root.innerHTML = `
      <header class="ins-head">
        <img class="avatar big" src="${this.art.portrait(a.outfit)}" alt="" width="48" height="48" />
        <div class="ins-id">
          <h2>${esc(a.name)} <span class="age num" title="Age">${a.age}</span></h2>
          <p>${role.title} · ${esc(wp.name)}</p>
        </div>
        <button class="icon-btn" data-act="close" aria-label="Close inspector" title="Close (Esc)"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
      </header>
      <div class="ins-meta">
        <div class="chips">${a.traits.map((t) => `<span class="chip" title="${esc(TRAITS[t].description)}">${TRAITS[t].name}</span>`).join('')}</div>
        <button class="btn" data-act="follow" data-f="follow" title="Follow (F)">Follow</button>
      </div>
      <p class="money num" data-f="money"></p>

      <section class="now" aria-label="Right now">
        <p class="doing" data-f="doing"></p>
        <p class="why"><span class="k">Because</span> <span data-f="why"></span></p>
        <p class="thought" data-f="thought"></p>
        <div class="taskcard">
          <div class="task-row"><span class="k">Task</span><b data-f="task"></b><span class="num" data-f="taskpct"></span></div>
          <span class="prog"><i data-f="taskbar"></i></span>
          <div class="task-meta" data-f="taskmeta"></div>
        </div>
      </section>

      <div class="tabs" role="tablist" aria-label="Details">
        ${TABS.map(([k, label]) => `<button role="tab" id="tab-${k}" data-act="tab" data-tab="${k}" aria-controls="pane-${k}" aria-selected="${k === this.tab}">${label}</button>`).join('')}
      </div>

      <section class="pane" role="tabpanel" id="pane-needs" aria-labelledby="tab-needs" data-pane="needs">
        <div class="meter mood" data-m="mood"><span class="lbl">Mood</span><span class="bar" style="--c:var(--n-mood)"><i></i><b></b></span><span class="val num">0</span></div>
        <p class="moodword" data-f="moodword"></p>
        <div class="meters">
          ${NEED_KEYS.map((k) => `<div class="meter" data-m="${k}"><span class="lbl">${NEED_LABEL[k]}</span><span class="bar" style="--c:${NEED_COLOR[k]}"><i></i></span><span class="val num">0</span></div>`).join('')}
        </div>
        <h3>What's moving their mood</h3>
        <ul class="list" data-slot="mood"></ul>
      </section>

      <section class="pane" role="tabpanel" id="pane-day" aria-labelledby="tab-day" data-pane="day">
        <h3>Today's schedule</h3>
        <div class="sched" data-slot="sched"></div>
        <h3>Skills</h3>
        <div class="skills">${SKILL_KEYS.map((k) => `<div class="skill" data-s="${k}"><span class="nm">${k === 'craft' ? role.craft : SKILL_LABEL[k]}</span><span class="lv num">0</span><span class="bar thin"><i></i></span></div>`).join('')}</div>
      </section>

      <section class="pane" role="tabpanel" id="pane-people" aria-labelledby="tab-people" data-pane="people">
        <div data-slot="graph"></div>
        <ul class="list" data-slot="rels"></ul>
      </section>

      <section class="pane" role="tabpanel" id="pane-mind" aria-labelledby="tab-mind" data-pane="mind">
        <h3>Thoughts</h3>
        <ol class="thoughts" data-slot="thoughts"></ol>
        <h3>Memories</h3>
        <ul class="list" data-slot="memories"></ul>
      </section>`;
    this.setTab(this.tab);
    this.root.querySelector('[data-slot="graph"]')!.appendChild(this.graph.canvas);
    this.root.scrollTop = 0;
  }

  update(): void {
    if (this.agentId === null) return;
    const a = this.sim.agent(this.agentId);
    if (!a) return;
    const r = this.root;
    const set = (f: string, v: string, html = false) => {
      const el = r.querySelector(`[data-f="${f}"]`) as HTMLElement | null;
      if (!el) return;
      if (html ? el.innerHTML !== v : el.textContent !== v) html ? (el.innerHTML = v) : (el.textContent = v);
    };
    const following = this.hooks.isFollowing();
    const fb = r.querySelector('[data-f="follow"]') as HTMLElement;
    fb.setAttribute('aria-pressed', String(following));
    fb.textContent = following ? 'Following' : 'Follow';
    set('money', `$${Math.round(a.money)} · ${a.tasksDone} tasks done · ${duration(a.workedToday)} worked today`);
    set('doing', a.action.stage === 'travel' && a.action.kind !== 'wander' && a.action.kind !== 'stroll' ? `On the way: ${a.action.label}` : a.action.label);
    set('why', a.action.reason || 'Just going with the flow');
    const th = a.thoughts[a.thoughts.length - 1];
    set('thought', th ? th.text : '');

    const t = a.task;
    set('task', t?.title ?? 'Nothing assigned');
    const pct = t ? Math.min(100, (t.progress / t.total) * 100) : 0;
    set('taskpct', t ? `${Math.floor(pct)}%` : '');
    (r.querySelector('[data-f="taskbar"]') as HTMLElement).style.width = `${pct}%`;
    if (t) {
      const left = t.due !== undefined ? t.due - this.sim.time : undefined;
      set('taskmeta', left === undefined ? `Started ${dayTime(t.started)}` : left > 0 ? `Due ${dayTime(t.due!)} (in ${duration(left)})` : 'Overdue', false);
      (r.querySelector('[data-f="taskmeta"]') as HTMLElement).classList.toggle('late', left !== undefined && left < 4 * 60);
    }

    this.schedule(a);

    for (const m of r.querySelectorAll<HTMLElement>('[data-m]')) {
      const k = m.dataset.m!;
      const v = k === 'mood' ? a.mood : a.needs[k as keyof typeof a.needs];
      (m.querySelector('i') as HTMLElement).style.width = `${v}%`;
      (m.querySelector('.val') as HTMLElement).textContent = String(Math.round(v));
      m.classList.toggle('low', v < 25);
      if (k === 'mood') (m.querySelector('b') as HTMLElement).style.left = `${moodTarget(a)}%`;
    }
    set('moodword', `${moodWord(a.mood)}, heading toward ${Math.round(moodTarget(a))}`);
    const parts = moodParts(a).filter((p) => p.value !== 0 && p.label !== 'Baseline');
    this.slot('mood', JSON.stringify(parts), parts.map((p) => `<li><span>${esc(p.label)}</span><span class="${p.value > 0 ? 'pos' : 'neg'} num">${p.value > 0 ? '+' : ''}${p.value}</span></li>`).join('') || '<li class="meta">Nothing in particular.</li>');

    for (const el of r.querySelectorAll<HTMLElement>('[data-s]')) {
      const s = a.skills[el.dataset.s as keyof typeof a.skills];
      (el.querySelector('.lv') as HTMLElement).textContent = String(s.level);
      (el.querySelector('i') as HTMLElement).style.width = `${s.level >= 10 ? 100 : (s.xp / xpToNext(s.level)) * 100}%`;
    }

    if (this.tab === 'people') this.graph.draw(this.sim, a);
    const rels = [...a.relations.entries()]
      .map(([id, rel]) => ({ o: this.sim.agent(id)!, rel }))
      .filter((x) => x.o)
      .sort((x, y) => y.rel.opinion - x.rel.opinion);
    this.slot('rels', JSON.stringify(rels.map((x) => [x.o.id, Math.round(x.rel.opinion)])), rels
      .map((x) => `<li><button class="row" data-act="person" data-id="${x.o.id}"><span>${esc(x.o.name)} <span class="meta">${relationLabel(x.rel.opinion)}</span></span><span class="${x.rel.opinion >= 0 ? 'pos' : 'neg'} num">${x.rel.opinion > 0 ? '+' : ''}${Math.round(x.rel.opinion)}</span></button></li>`)
      .join('') || '<li class="meta">Doesn’t know anyone yet.</li>');

    const th2 = [...a.thoughts].reverse().slice(0, 14);
    this.slot('thoughts', `${a.thoughts.length}:${a.thoughts[a.thoughts.length - 1]?.t}`, th2.map((x) => `<li class="${x.tone}"><time class="num">${hhmm(x.t)}</time><span>${esc(x.text)}</span></li>`).join(''));
    const mem = [...a.memories].reverse();
    this.slot('memories', JSON.stringify(mem.map((m) => [m.label, m.created])), mem
      .map((m) => `<li><span class="${m.major ? 'major' : ''}">${esc(m.label)} <span class="meta">${duration(m.expires - this.sim.time)} left</span></span><span class="${m.mood >= 0 ? 'pos' : 'neg'} num">${m.mood > 0 ? '+' : ''}${m.mood}</span></li>`)
      .join('') || '<li class="meta">Nothing memorable yet.</li>');
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-act="tab"]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const p of this.root.querySelectorAll<HTMLElement>('[data-pane]')) p.hidden = p.dataset.pane !== tab;
    if (tab === 'people' && this.agentId !== null) {
      const a = this.sim.agent(this.agentId);
      if (a) this.graph.draw(this.sim, a);
    }
  }

  private slot(name: string, sig: string, html: string): void {
    if (this.sigs[name] === sig) return;
    this.sigs[name] = sig;
    const el = this.root.querySelector(`[data-slot="${name}"]`);
    if (el) el.innerHTML = html;
  }

  /** A 24h strip with sleep, work and lunch blocks and a marker for now. */
  private schedule(a: Agent): void {
    const s = a.schedule;
    const workday = !this.sim.weekend;
    const sig = `${workday}:${Math.floor(this.sim.hour * 4)}`;
    if (this.sigs.sched === sig) return;
    this.sigs.sched = sig;
    const pct = (h: number) => `${(((h % 24) + 24) % 24) / 24 * 100}%`;
    const block = (from: number, to: number, cls: string, label: string) => {
      const f = ((from % 24) + 24) % 24;
      const t = ((to % 24) + 24) % 24;
      const parts = f <= t ? [[f, t]] : [[f, 24], [0, t]];
      return parts.map(([x, y]) => `<span class="blk ${cls}" style="left:${pct(x)};width:${((y - x) / 24) * 100}%" title="${label} ${hourLabel(from)} to ${hourLabel(to)}"></span>`).join('');
    };
    const now = this.sim.hour;
    const items = [
      block(s.sleep, s.wake, 'sleep', 'Sleep'),
      workday ? block(s.workStart, s.workEnd, 'work', 'Work') : '',
      workday ? block(s.lunch, s.lunch + 0.75, 'lunch', 'Lunch') : '',
      `<span class="now-mark" style="left:${pct(now)}"></span>`,
    ].join('');
    const legend = `<div class="sched-legend"><span class="lg sleep">Sleep ${hourLabel(s.sleep)} to ${hourLabel(s.wake)}</span>${workday ? `<span class="lg work">Work ${hourLabel(s.workStart)} to ${hourLabel(s.workEnd)}</span><span class="lg lunch">Lunch ${hourLabel(s.lunch)}</span>` : '<span class="lg">Weekend: no work</span>'}</div>`;
    (this.root.querySelector('[data-slot="sched"]') as HTMLElement).innerHTML = `<div class="sched-bar">${items}</div><div class="sched-ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>${legend}`;
  }
}
