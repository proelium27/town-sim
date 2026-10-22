import { ageOf } from '../sim/agents';
import { ADULT_AGE, billText, MIN_PER_DAY, SEASON_DAYS, SEASONS, YEAR_DAYS, GOOD_KEYS, GOODS, plural, PRIORITY_KEYS, PRIORITY_LABEL, type PriorityKey } from '../sim/defs';
import { foodBalance } from '../sim/economy';
import { winterReadiness, WINTER_STOCK_DAYS } from '../sim/seasons';
import { BASE_PRICE, price, TRADER_EVERY } from '../sim/market';
import { TIER_AT, TIERS } from '../sim/growth';
import { nextElection } from '../sim/politics';
import { chains, hasWorkshop } from '../sim/workshop';
import { WORLD_EVENTS, type WorldEventKey, triggerWorldEvent } from '../sim/events';
import { describe } from '../sim/character';
import { allocateRoles, buildCap, capacity, stageOf } from '../sim/planner';
import { first } from '../sim/social';
import type { Sim } from '../sim/sim';
import { expectCart, fromName, partyName, readTravelers } from '../sim/travel';
import { NOTABLE } from '../sim/types';
import type { Saves } from './saves';
import { esc, hhmm } from './util';

const STAGE_LABEL = { clearing: 'Clearing the site', supplying: 'Waiting for materials', building: 'Under construction' } as const;
const LEVELS = ['Low', 'Normal', 'High'];
/** Short calendar date for a game minute: "Spr 2, Y1". */
const dateOf = (t: number) => {
  const day = Math.floor(t / MIN_PER_DAY);
  return `${SEASONS[Math.floor(day / SEASON_DAYS) % SEASONS.length].slice(0, 3)} ${(day % SEASON_DAYS) + 1}, Y${Math.floor(day / YEAR_DAYS) + 1}`;
};

/** Autumn and winter: how long the stores would last, and which hearths are cold. */
export function winterLine(sim: Sim): string {
  if (sim.season < 2) return '';
  const r = winterReadiness(sim);
  // Days until winter starts (autumn) or ends (winter); the stores have to last until spring.
  const toGo = (1 - sim.seasonProgress) * SEASON_DAYS;
  const need = sim.season === 2 ? toGo + SEASON_DAYS : toGo;
  const cold = sim.town.households.filter((h) => h.building >= 0 && sim.fuel[h.id] < 1).length;
  // Firewood is split and carried to hearths all winter: the stores only need what the town keeps in
  // through winter (autumn stocks a little more), or the days left if that's less.
  const fuelNeed = Math.min(need, WINTER_STOCK_DAYS);
  // Judged at the precision shown, so stores exactly on target read as enough.
  const ok = (d: number, want = need) => (d >= want - 0.05 ? 'pos' : 'neg');
  return `<p class="winter-line">Winter ${sim.season === 3 ? 'ends' : 'starts'} in ${toGo.toFixed(1)} days. Stores last: <b class="${ok(r.food)}">${r.food.toFixed(1)} days of food</b>, <b class="${ok(r.firewood, fuelNeed)}">${r.firewood.toFixed(1)} of firewood</b>${cold ? ` · <b class="neg">${cold} cold hearth${cold === 1 ? '' : 's'}</b>` : ''}</p>`;
}

/** Left-sidebar Town tab: stores, the player's priorities and world events, live projects, history. */
export class TownPanel {
  private sig = '';
  /** New town takes two clicks: the first arms it for a few seconds. */
  private resetArmed = false;
  /** Typing a new name: hold re-renders so the field keeps focus. */
  private renaming = false;
  /** The last word on a traveler file: who's coming, or why they can't. */
  private travelNote = '';

  constructor(
    private root: HTMLElement,
    private sim: Sim,
    private onFocus: (x: number, y: number) => void,
    private onPerson: (id: number) => void,
    private saves: Saves,
    private onChronicle: () => void = () => {},
  ) {
    const picker = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json', hidden: true });
    picker.addEventListener('change', async () => {
      const f = picker.files?.[0];
      picker.value = '';
      if (f) this.saves.importFile(f).catch(() => {});
    });
    root.after(picker);
    const travelers = Object.assign(document.createElement('input'), { type: 'file', name: 'travelers', accept: '.json,application/json', hidden: true });
    travelers.addEventListener('change', async () => {
      const f = travelers.files?.[0];
      travelers.value = '';
      if (!f) return;
      try {
        const file = readTravelers(await f.text());
        const e = expectCart(sim, file);
        this.travelNote = `${partyName(file)} set off from ${fromName(sim, file)}. Expect them ${dateOf(e.at)} around ${hhmm(e.at)}.`;
      } catch (err) {
        this.travelNote = (err as Error).message;
      }
      this.sig = '';
      this.update();
    });
    root.after(travelers);
    root.addEventListener('keydown', (e) => {
      const input = (e.target as HTMLElement).closest('input[data-f="rename"]') as HTMLInputElement | null;
      if (!input) return;
      if (e.key === 'Enter') this.rename(input.value);
      if (e.key === 'Escape') this.rename(null);
      e.stopPropagation();
    });
    root.addEventListener('focusout', (e) => {
      const input = (e.target as HTMLElement).closest('input[data-f="rename"]') as HTMLInputElement | null;
      if (input && this.renaming) this.rename(input.value);
    });
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
      } else if (act === 'chronicle') {
        this.onChronicle();
        return;
      } else if (act === 'save') {
        this.saves.save();
      } else if (act === 'export') {
        this.saves.exportFile();
      } else if (act === 'export-backup') {
        this.saves.exportBackup();
      } else if (act === 'import') {
        picker.click();
        return;
      } else if (act === 'welcome') {
        travelers.click();
        return;
      } else if (act === 'rename') {
        this.renaming = true;
        const line = this.root.querySelector('.tier-line b');
        if (line) {
          line.innerHTML = `<input data-f="rename" class="town-name" maxlength="24" value="${esc(sim.name)}" aria-label="Town name" />`;
          const input = line.querySelector('input')!;
          input.focus();
          input.select();
        }
        return;
      } else if (act === 'reset') {
        // Two clicks: the first arms it, so a stray click can't wipe a town.
        // The armed look is rendered from this field, so a re-render can't show an armed button as safe.
        if (!this.resetArmed) {
          this.resetArmed = true;
          setTimeout(() => {
            this.resetArmed = false;
            this.update();
          }, 4000);
        } else {
          this.saves.reset();
          return;
        }
      }
      this.sig = '';
      this.update();
    });
  }

  /** Who's mayor, what they want, the race if one is on, and how last year's vote went. */
  private mayorSection(): string {
    const sim = this.sim;
    const mayor = sim.agent(sim.mayor ?? undefined);
    const race = sim.election && sim.election.year === sim.year && sim.election.stage !== 'done' ? sim.election : null;
    const next = nextElection(sim);
    const who = (id: number) => {
      const a = sim.agent(id);
      return a ? `<button class="linkish" data-act="person" data-id="${a.id}">${esc(a.name)}</button>` : 'someone who has since left';
    };
    let body = mayor
      ? `<p class="mayor-line">Mayor ${who(mayor.id)}, elected on <b>${PRIORITY_LABEL[sim.agenda!].toLowerCase()}</b>.${sim.agenda && sim.priorities[sim.agenda] === 0 ? ` <span class="neg">You have ${PRIORITY_LABEL[sim.agenda].toLowerCase()} set to Low; the mayor disagrees.</span>` : ''}</p>`
      : sim.lastElection
        ? `<p class="mayor-line">The mayor's office is empty until the next election.</p>`
        : `<p class="mayor-line">No mayor yet.</p>`;
    if (race) {
      body += `<p class="mayor-line">Standing today: ${race.candidates.map((c) => `${who(c.id)} (${PRIORITY_LABEL[c.platform].toLowerCase()})`).join(', ')}. ${race.stage === 'rally' ? 'The rally is on; votes are counted at 19:00.' : 'Rally in the park at 17:00.'}</p>`;
    } else if (sim.lastElection) {
      const L = sim.lastElection;
      body += `<p class="mayor-line meta">Year ${L.year} vote: ${L.votes.map(([id, n]) => `${esc(sim.person(id)?.name.split(' ')[0] ?? '?')} ${n}`).join(' · ')}. Next election: Summer 1, Year ${next.year}.</p>`;
    } else {
      body += `<p class="mayor-line meta">First election: Summer 1, Year ${next.year}.</p>`;
    }
    return `<section class="tp-sec"><h3>Mayor <small>leans town meetings toward their agenda</small></h3>${body}</section>`;
  }

  /** The town's purse: balance, yesterday's money in and out, today's prices, the next trader. */
  private treasurySection(): string {
    const sim = this.sim;
    const L = sim.lastLedger;
    const income = L.sales + L.taxes + Math.max(0, L.trade);
    const spent = L.wages + L.pensions + L.bonuses + L.projects + Math.max(0, -L.trade);
    // Traders come on day 1, 4, 7... at 10:00.
    let d = (1 - (sim.day % TRADER_EVERY) + TRADER_EVERY) % TRADER_EVERY;
    if (d === 0 && sim.hour >= 10) d = TRADER_EVERY;
    const when = sim.cars.some((c) => c.trader) ? 'in town now' : d === 0 ? 'due at 10:00' : `in ${d} day${d === 1 ? '' : 's'}`;
    // Tools only get a quote once the town has some or a workshop to make them; before that it's a price for nothing.
    const quoted = (['food', 'firewood', 'tools'] as const).filter((g) => g !== 'tools' || sim.stock.tools > 0 || hasWorkshop(sim));
    const priced = quoted.map((g) => {
      const p = price(sim, g);
      const cls = p > BASE_PRICE[g] * 1.4 ? 'neg' : p < BASE_PRICE[g] * 0.8 ? 'pos' : '';
      return `<span class="price"><span>${GOODS[g].label}</span><b class="num ${cls}">$${p.toFixed(p < 10 ? 2 : 0)}</b></span>`;
    }).join('');
    return `<section class="tp-sec">
        <h3>Treasury <small>trader ${when}</small></h3>
        <div class="purse"><b class="num">$${Math.round(sim.treasury)}</b><span>yesterday <span class="pos num">+$${Math.round(income)}</span> in, <span class="neg num">−$${Math.round(spent)}</span> out</span></div>
        <div class="prices">${priced}</div>
      </section>`;
  }

  /** Production chains: what the workshop makes, how stocked each is, and what's holding it up. */
  private workshopSection(): string {
    const sim = this.sim;
    const shop = hasWorkshop(sim);
    if (!shop && !sim.projects.some((p) => p.blueprint === 'workshop')) return '';
    const label = (g: string) => GOODS[g as keyof typeof GOODS].label.toLowerCase();
    return `<section class="tp-sec">
        <h3>Workshop <small>${shop ? 'what the trades are making' : 'being built'}</small></h3>
        <ul class="chains">${chains(sim).map((c) => {
          const from = Object.keys(c.recipe.inputs).map(label).join(' + ');
          // While the workshop is still going up, nothing is stuck yet; it's just early.
          const stuck = shop ? c.stuck : null;
          const state = stuck ? `<span class="why neg">Stuck: ${esc(stuck)}</span>` : `<span class="why">${c.have >= c.target ? 'stocked' : !shop ? 'waiting for the workshop' : 'in production'}</span>`;
          return `<li class="${stuck ? 'stuck' : ''}"><span class="lbl">${from} → <b>${label(c.recipe.good)}</b></span><span class="num">${c.have}/${c.target}</span>${state}</li>`;
        }).join('')}</ul>
      </section>`;
  }

  /** Commits a new town name (letters, spaces, apostrophes and hyphens), or cancels with null. */
  private rename(value: string | null): void {
    this.renaming = false;
    const name = (value ?? '').replace(/[^\p{L} '\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (value !== null && name.length >= 2 && name !== this.sim.name) {
      this.sim.log(`${this.sim.name} is now called ${name}`, 'event', 'good').weight = NOTABLE;
      this.sim.name = name;
    }
    this.sig = '';
    this.update();
  }

  update(): void {
    if (this.renaming) return;
    const sim = this.sim;
    const pop = sim.agents;
    const kids = pop.filter((a) => ageOf(sim, a) < ADULT_AGE).length;
    const elders = pop.filter((a) => a.role === 'retired').length;
    const homes = sim.town.households.filter((h) => h.building >= 0);
    const beds = homes.reduce((n, h) => n + capacity(sim, h.id), 0);
    const homeless = pop.filter((a) => sim.town.households[a.household].building < 0).length;
    const sick = pop.filter((a) => a.illness).length;
    const fb = foodBalance(sim);
    const net = fb.produce - fb.eat;
    const projects = sim.projects.map((p) => ({ p, stage: stageOf(sim, p) }));
    const sig = JSON.stringify([
      pop.length, kids, elders, beds, homeless, sick, sim.tier, sim.mayor, sim.agenda, sim.election?.stage, sim.lastElection?.year, GOOD_KEYS.map((g) => Math.round(sim.stock[g])), Math.round(net), sim.date(),
      sim.name, sim.expected.length, this.travelNote, sim.priorities, projects.map(({ p, stage }) => [p.id, stage, Math.floor((p.progress / p.work) * 50), p.delivered, p.builders.size]),
      sim.history.length, !!sim.events.drought, !!sim.events.festival, this.saves.status(), this.resetArmed, Math.round(sim.treasury / 5), sim.lastLedger, (['food', 'firewood', 'tools'] as const).map((g) => price(sim, g)), hasWorkshop(sim), chains(sim).map((c) => [c.have, c.target, c.stuck]), sim.season, Math.round(winterReadiness(sim).firewood * 4), Math.round(winterReadiness(sim).food * 4),
      sim.season >= 2 && Math.round((1 - sim.seasonProgress) * SEASON_DAYS * 10),
    ]);
    if (sig === this.sig) return;
    this.sig = sig;
    const bar = (v: number, max: number, c: string) => `<span class="bar" style="--c:${c}"><i style="width:${Math.min(100, (v / Math.max(1, max)) * 100)}%"></i></span>`;
    const ev = sim.events;
    const about = describe(sim.character);
    this.root.innerHTML = `
      <section class="tp-sec">
        <p class="tier-line"><b>${esc(sim.name)}</b> ${TIERS[sim.tier].toLowerCase()}${sim.tier + 1 < TIERS.length ? ` · becomes a ${TIERS[sim.tier + 1].toLowerCase()} at ${TIER_AT[sim.tier + 1][0]} people and ${TIER_AT[sim.tier + 1][1]} buildings` : ''} <button class="chip-btn" data-act="rename" title="Rename the town">Rename</button></p>
        <p class="town-char">${esc(about.summary)}${about.traits.length ? `<span>${about.traits.map(esc).join(' · ')}</span>` : ''}</p>
        <dl class="tp-stats">
          <div><dt>People</dt><dd class="num">${pop.length}</dd><span>${plural(kids, 'kid')}, ${elders} retired${sick ? `, <b class="neg">${sick} sick</b>` : ''}</span></div>
          <div><dt>Homes</dt><dd class="num">${homes.length}</dd><span>${plural(beds, 'bed')}${homeless ? `, <b class="neg">${homeless} homeless</b>` : ''}</span></div>
          <div><dt>Buildings</dt><dd class="num">${sim.map.buildings.length}</dd><span>${sim.projects.length} going up</span></div>
        </dl>
      </section>
      <section class="tp-sec">
        <h3>Stores</h3>
        <div class="stores">
          ${GOOD_KEYS.filter((g) => GOODS[g].hud || sim.stock[g] > 0).map((g) => {
            const rate = g === 'food' ? `<span class="rate num ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : ''}${Math.round(net)}/day</span>` : '<span class="rate"></span>';
            return `<div class="store"><span class="lbl">${GOODS[g].label}</span>${bar(sim.stock[g], GOODS[g].cap, GOODS[g].color)}<span class="num">${Math.round(sim.stock[g])}</span>${rate}</div>`;
          }).join('')}
        </div>
        ${ev.drought ? '<p class="warn-line">Drought: nothing is growing.</p>' : ''}
        ${winterLine(sim)}
      </section>
      ${this.mayorSection()}
      ${this.treasurySection()}
      ${this.workshopSection()}
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
              <span class="proj-meta">${STAGE_LABEL[stage]} · ${billText(p.need, p.delivered)} · ${p.builders.size} working</span>
              <span class="proj-why">${who ? `${esc(first(who))}: ` : ''}“${esc(p.reason)}”</span>
            </button></li>`;
          }).join('')}
        </ul>
      </section>
      <section class="tp-sec">
        <h3>Saving <small>${esc(this.saves.status())}</small></h3>
        <div class="save-row">
          <button class="btn" data-act="save" ${this.saves.canSave ? '' : 'disabled'}>Save now</button>
          <button class="btn" data-act="export">Export</button>
          ${this.saves.hasBackup ? `<button class="btn" data-act="export-backup" title="Download the saved town that couldn't be read">Export backup</button>` : ''}
          <button class="btn" data-act="import" ${this.saves.enabled ? '' : 'disabled title="Scratch towns from a ?seed= link never touch your saved town. Open the game without ?seed= to import."'}>Import</button>
          <button class="btn danger${this.resetArmed ? ' armed' : ''}" data-act="reset" ${this.saves.enabled ? '' : 'title="Starts this scratch town over. Your saved town is untouched."'}>${this.resetArmed ? 'Click again to start over' : 'New town'}</button>
        </div>
        ${this.saves.notice() ? `<p class="warn-line">${esc(this.saves.notice())}</p>` : ''}
        <p class="seed-line">Seed <span class="num">${sim.seed}</span> · <a href="?seed=${sim.seed}${sim.character.classic ? '&amp;classic' : ''}" target="_blank" rel="noopener" title="Opens a fresh copy of this town from its first day; it is never saved">replay from day one</a></p>
      </section>
      <section class="tp-sec">
        <h3>Travelers</h3>
        <p class="tp-note">Send someone to another town from their card (Journey). Welcome travelers with a file someone sent you; their cart arrives a day and a half later.</p>
        <div class="save-row"><button class="btn" data-act="welcome">Welcome travelers…</button></div>
        ${this.travelNote ? `<p class="tp-note">${esc(this.travelNote)}</p>` : ''}
        ${sim.expected.length ? `<ul class="tp-road">${sim.expected.map((e) => `<li>On the road: <b>${esc(partyName(e.file))}</b> from ${esc(fromName(sim, e.file))}, due ${dateOf(e.at)} ${hhmm(e.at)}</li>`).join('')}</ul>` : ''}
      </section>
      <section class="tp-sec">
        <h3>History <button class="chip-btn" data-act="chronicle" title="Year by year, obituaries and family trees (H)">Read the chronicle</button></h3>
        <ol class="history">${[...sim.history].reverse().slice(0, 30).map((h) => `<li><time class="num">${dateOf(h.t)}<br>${hhmm(h.t)}</time><span>${esc(h.text)}</span></li>`).join('')}</ol>
      </section>`;

  }
}
