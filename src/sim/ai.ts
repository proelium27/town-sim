import type { Facing } from '../assets/manifest';
import type { Prop, UseKind } from '../world/map';
import { newTask } from './agents';
import { MIN_PER_DAY, ROLES, SKILL_LABEL, type SkillKey } from './defs';
import { clamp } from './rng';
import {
  addMemory, bondNearby, converse, expireMemories, first, moodTarget, rel, RIVAL, say, shiftOpinion, socialGain, think,
} from './social';
import type { Action, ActionKind, Agent } from './types';
import type { Sim } from './sim';
import { laneThreat } from './traffic';

/** Tiles per game minute on flat ground. */
export const WALK_SPEED = 3.2;
const INERTIA = 0.15;

// ------------------------------------------------------------------ time helpers

/** Is hour h inside [from, to), allowing windows that wrap past midnight. */
export function inWindow(h: number, from: number, to: number): boolean {
  const f = ((from % 24) + 24) % 24;
  const t = ((to % 24) + 24) % 24;
  return f <= t ? h >= f && h < t : h >= f || h < t;
}

export function isWorkTime(sim: Sim, a: Agent): boolean {
  return !sim.weekend && inWindow(sim.hour, a.schedule.workStart, a.schedule.workEnd);
}

export function isSleepTime(sim: Sim, a: Agent): boolean {
  return inWindow(sim.hour, a.schedule.sleep, a.schedule.wake);
}

function where(sim: Sim, a: Agent): 'home' | 'work' | 'out' {
  const r = sim.roomOf(a);
  if (!r) return 'out';
  if (r.kind === 'home' && sim.town.households[a.household].room === r.id) return 'home';
  const wp = sim.town.workplaces.find((w) => w.id === ROLES[a.role].workplace);
  return wp?.rooms.includes(r.id) ? 'work' : 'out';
}

// ------------------------------------------------------------------ spots

/** Can this agent use this prop's spot right now? Encodes ownership, opening hours and reservations. */
function canUse(sim: Sim, a: Agent, p: Prop): boolean {
  const holder = sim.reserved.get(p.id);
  if (holder !== undefined && holder !== a.id) return false;
  if (!p.spot) return false;
  if (p.use === 'work') return p.id === a.deskId;
  const room = p.room >= 0 ? sim.map.rooms[p.room] : undefined;
  if (p.household !== undefined) return p.household === a.household;
  if (room?.kind === 'home') return sim.town.households[a.household].room === room.id;
  if (room?.building === 'Northwind Studio') return ROLES[a.role].workplace === 'office';
  if (room) {
    const wp = sim.town.workplaces.find((w) => w.rooms.includes(room.id));
    if (wp && ROLES[a.role].workplace !== wp.id && !inWindow(sim.hour, wp.open, wp.close)) return false;
  }
  return true;
}

interface Target {
  prop?: Prop;
  cell: number;
  facing?: Facing;
  path: number[];
  cost: number;
}

/** Nearest usable spot among the given uses, verified with A*. */
function findSpot(sim: Sim, a: Agent, uses: UseKind[], filter?: (p: Prop) => boolean): Target | null {
  const m = sim.map;
  const ax = m.cx(a.at);
  const ay = m.cy(a.at);
  const cands = m.props
    .filter((p) => p.use && uses.includes(p.use) && canUse(sim, a, p) && (!filter || filter(p)))
    .map((p) => ({ p, d: Math.hypot(p.spot!.x - ax, p.spot!.y - ay) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, 4);
  let best: Target | null = null;
  for (const { p } of cands) {
    const cell = m.idx(p.spot!.x, p.spot!.y);
    const path = cell === a.at ? [] : sim.nav.findPath(a.at, cell);
    if (!path) continue;
    if (!best || path.length < best.cost) best = { prop: p, cell, facing: p.spot!.facing, path, cost: path.length };
    if (best.cost < 6) break;
  }
  return best;
}

function randomCellIn(sim: Sim, x: number, y: number, w: number, h: number): number {
  const m = sim.map;
  for (let k = 0; k < 30; k++) {
    const cx = sim.rng.int(x, x + w - 1);
    const cy = sim.rng.int(y, y + h - 1);
    if (m.walkable(cx, cy) && m.cost[m.idx(cx, cy)] < 1) return m.idx(cx, cy);
  }
  return -1;
}

// ------------------------------------------------------------------ needs

function updateNeeds(sim: Sim, a: Agent, dt: number): void {
  const n = a.needs;
  const k = a.action.kind;
  const performing = a.action.stage === 'perform';
  const asleep = k === 'sleep' && performing;
  const working = k === 'work' && performing;
  if (!asleep) n.energy -= (working ? 0.075 : 0.06) * dt * (a.traits.includes('earlyBird') && sim.hour > 19 ? 1.4 : 1);
  n.hunger -= (a.traits.includes('foodie') ? 0.13 : 0.105) * dt * (asleep ? 0.4 : 1);
  n.hygiene -= (k === 'play' || k === 'stroll' ? 0.12 : 0.05) * dt * (asleep ? 0.5 : 1);
  const soc = a.traits.includes('extrovert') ? 0.1 : a.traits.includes('introvert') ? 0.04 : 0.065;
  n.social -= soc * dt * (asleep ? 0.2 : 1);
  n.fun -= (working ? 0.08 : 0.045) * dt * (asleep ? 0.2 : 1);
  if (isWorkTime(sim, a)) {
    if (!working && k !== 'meet') n.work -= (a.traits.includes('workaholic') ? 0.16 : a.traits.includes('slacker') ? 0.05 : 0.1) * dt;
  } else n.work += (60 - n.work) * 0.002 * dt;
  a.bladder -= 0.32 * dt * (asleep ? 0.3 : 1);
  if (k === 'coffee' && performing) a.bladder -= 0.4 * dt;
  for (const key of ['energy', 'hunger', 'hygiene', 'social', 'fun', 'work'] as const) n[key] = clamp(n[key], 0, 100);
  a.bladder = clamp(a.bladder, 0, 100);

  if (n.hunger < 8) addMemory(sim, a, 'starving');
  if (n.hygiene < 20) addMemory(sim, a, 'stinky');
  if (a.workedToday > 10 * 60) addMemory(sim, a, 'longDay');
  expireMemories(sim, a);
  a.mood = clamp(a.mood + (moodTarget(a) - a.mood) * Math.min(1, 0.02 * dt), 0, 100);
  if (a.bubble && a.bubble.until < sim.time) a.bubble = null;
}

function gainXp(sim: Sim, a: Agent, skill: SkillKey, amount: number): void {
  const s = a.skills[skill];
  if (s.level >= 10) return;
  s.xp += amount * (a.traits.includes('workaholic') && skill === 'craft' ? 1.25 : 1);
  const need = 120 + s.level * 90;
  if (s.xp >= need) {
    s.xp -= need;
    s.level++;
    addMemory(sim, a, 'skillUp');
    const label = skill === 'craft' ? ROLES[a.role].craft : SKILL_LABEL[skill];
    think(sim, a, `I'm getting better at ${label.toLowerCase()}.`, 'good');
    sim.log(`${first(a)} reached ${label} ${s.level}`, 'life', 'good', a);
  }
}

export const xpToNext = (level: number): number => 120 + level * 90;

// ------------------------------------------------------------------ options

interface Option {
  kind: ActionKind;
  score: number;
  reason: string;
  /** Resolves a target and starts the action; false if nothing suitable was found. */
  begin: () => boolean;
}

function start(sim: Sim, a: Agent, kind: ActionKind, label: string, reason: string, t: Target, timer: number, score: number, extra: Partial<Action> = {}): boolean {
  endAction(sim, a);
  a.action = { kind, label, reason, stage: t.path.length ? 'travel' : 'perform', dest: t.cell, facing: t.facing, propId: t.prop?.id, timer, started: sim.time, score, ...extra };
  a.path = t.path;
  a.pathPos = 0;
  a.edgeT = 0;
  if (t.prop) sim.reserved.set(t.prop.id, a.id);
  if (a.action.stage === 'perform') arrive(sim, a);
  return true;
}

function endAction(sim: Sim, a: Agent): void {
  const act = a.action;
  if (act.propId !== undefined && sim.reserved.get(act.propId) === a.id) sim.reserved.delete(act.propId);
  if (act.kind === 'socialize' && act.partnerId !== undefined) {
    const p = sim.agent(act.partnerId);
    if (p && p.action.kind === 'socialize' && p.action.partnerId === a.id) {
      p.action = idle(sim, p);
      p.thinkIn = 0;
    }
  }
}

export function idle(sim: Sim, a: Agent): Action {
  return { kind: 'idle', label: 'Idle', reason: '', stage: 'perform', dest: a.at, timer: 0, started: sim.time, score: 0 };
}

function finish(sim: Sim, a: Agent): void {
  endAction(sim, a);
  a.action = idle(sim, a);
  a.path = [];
  a.thinkIn = 0;
}

/** Spot-based option: score now, find the nearest spot only if chosen. */
function spotOption(sim: Sim, a: Agent, kind: ActionKind, score: number, reason: string, uses: UseKind[], label: (p: Prop) => string, timer: number, filter?: (p: Prop) => boolean, onStart?: (p: Prop) => void): Option {
  return {
    kind, score, reason,
    begin: () => {
      const t = findSpot(sim, a, uses, filter);
      if (!t?.prop) return false;
      onStart?.(t.prop);
      return start(sim, a, kind, label(t.prop), reason, t, timer, score);
    },
  };
}

function roomName(sim: Sim, p: Prop): string {
  return p.room >= 0 ? sim.map.rooms[p.room].name : 'outside';
}

function buildOptions(sim: Sim, a: Agent): Option[] {
  const n = a.needs;
  const o: Option[] = [];
  const workTime = isWorkTime(sim, a);
  const sleepTime = isSleepTime(sim, a);
  const loc = where(sim, a);
  const h = sim.hour;
  const office = ROLES[a.role].workplace === 'office';
  // During work hours, leisure has to beat the pull of the desk.
  const breakMult = workTime ? (a.traits.includes('slacker') ? 0.85 : a.traits.includes('workaholic') ? 0.45 : 0.6) : 1;
  const evening = h >= 20.5 || h < 5;

  // ---- sleep
  {
    const x = 1 - n.energy / 100;
    let s = Math.pow(x, 2) * 1.1 + (sleepTime ? 0.9 : 0);
    if (n.energy < 10) s += 0.6;
    if (!sleepTime && n.energy > 35) s *= 0.3;
    if (s > 0.15) o.push(spotOption(sim, a, 'sleep', s, sleepTime ? 'Bedtime' : `Exhausted (${Math.round(n.energy)})`, ['sleep'], () => 'Sleeping', 0));
  }

  // ---- restroom / hygiene
  if (a.bladder < 45) {
    const s = Math.pow(1 - a.bladder / 100, 2) * 1.6;
    o.push(spotOption(sim, a, 'toilet', s, 'Needs the restroom', ['toilet'], () => 'In the restroom', 4));
  }
  if (n.hygiene < 70) {
    const morning = inWindow(h, a.schedule.wake, a.schedule.wake + 1.5);
    const s = (1 - n.hygiene / 100) * (a.traits.includes('neatFreak') ? 1.3 : 0.9) + (morning ? 0.35 : 0) - (loc === 'home' ? 0 : 0.2);
    o.push(spotOption(sim, a, 'shower', s * breakMult, morning ? 'Morning shower' : `Feeling grimy (${Math.round(n.hygiene)})`, ['shower'], () => 'Showering', 12));
  }

  // ---- food
  const lunchy = inWindow(h, a.schedule.lunch - 0.4, a.schedule.lunch + 1);
  const breakfast = inWindow(h, a.schedule.wake, a.schedule.wake + 1.2);
  const dinner = inWindow(h, 18, 20.5);
  if (a.mealReady) {
    o.push(spotOption(sim, a, 'eat', 1.4, 'Dinner is ready', ['eat'], () => 'Eating at home', 22, (p) => p.household === a.household));
  } else if (n.hunger < 75) {
    const x = 1 - n.hunger / 100;
    let s = Math.pow(x, 1.5) * 1.3 + (lunchy || breakfast || dinner ? 0.35 : 0) + (a.traits.includes('foodie') ? 0.1 : 0);
    if (n.hunger < 15) s += 0.5;
    const reason = lunchy ? 'Lunchtime' : breakfast ? 'Breakfast' : dinner ? 'Dinnertime' : `Hungry (${Math.round(n.hunger)})`;
    if (loc === 'home' || (!workTime && evening) || (!workTime && dinner && loc !== 'work')) {
      if (sim.pantry[a.household] > 0) o.push(spotOption(sim, a, 'cook', s, reason, ['cook'], () => 'Cooking at home', 18, (p) => p.household === a.household));
    }
    if (office && !sim.weekend && loc !== 'home') {
      o.push(spotOption(sim, a, 'eat', s * (workTime ? 1 : 0.6) + (sim.events.pizza ? 0.4 : 0), sim.events.pizza ? 'Free pizza!' : reason, ['eat'], () => (sim.events.pizza ? 'Eating pizza in the kitchen' : 'Lunch in the kitchen'), 24, (p) => sim.map.rooms[p.room]?.kind === 'kitchen'));
    }
    if (a.money >= 9 && !evening) {
      o.push(spotOption(sim, a, 'eat', s * (a.traits.includes('foodie') ? 1.15 : 0.9), reason, ['eat'], () => 'Eating at the café', 26, (p) => sim.map.rooms[p.room]?.kind === 'cafe', () => {
        a.money -= 9;
      }));
    }
    if (n.hunger < 55 && workTime) o.push(spotOption(sim, a, 'snack', s * 0.7, 'Quick snack', ['snack'], () => 'Grabbing a snack', 5));
  }

  // ---- coffee
  {
    const morningHabit = a.coffeeDay !== sim.day && inWindow(h, a.schedule.wake + 0.3, a.schedule.wake + 3.5);
    const tired = n.energy < 55 && !sleepTime;
    if (morningHabit || tired) {
      const s = (morningHabit ? 0.75 : 0) + (tired ? (1 - n.energy / 100) * 0.6 : 0);
      o.push(spotOption(sim, a, 'coffee', s, morningHabit ? 'Morning coffee' : `Tired (${Math.round(n.energy)})`, ['coffee'], (p) => `Getting coffee at the ${roomName(sim, p).toLowerCase()}`, 6, (p) => !(sim.events.coffeeBroken && sim.map.rooms[p.room]?.kind === 'kitchen')));
    }
  }

  // ---- work
  if (a.deskId !== null && (workTime || (a.traits.includes('workaholic') && !sim.weekend && h > 7 && h < 21))) {
    const task = a.task;
    const due = task?.due !== undefined && task.due - sim.time < 4 * 60;
    let s = workTime ? 0.72 + (100 - n.work) / 300 + (due ? 0.25 : 0) : 0.3;
    s *= a.traits.includes('workaholic') ? 1.2 : a.traits.includes('slacker') ? 0.8 : 1;
    const label = ROLES[a.role].station === 'desk' ? `Working: ${task?.title ?? 'busywork'}` : ROLES[a.role].station === 'reception' ? `At reception: ${task?.title ?? ''}` : `On shift: ${task?.title ?? ''}`;
    o.push({
      kind: 'work', score: s, reason: due ? 'Deadline coming up' : workTime ? 'Work hours' : 'Staying late',
      begin: () => {
        const desk = sim.prop(a.deskId!);
        if (!desk?.spot) return false;
        const t = findSpot(sim, a, ['work'], (p) => p.id === desk.id);
        if (!t) return false;
        return start(sim, a, 'work', label, due ? 'Deadline coming up' : workTime ? 'Work hours' : 'Staying late', t, sim.rng.range(50, 95), s);
      },
    });
  }

  // ---- meetings
  if (sim.events.standup && office && workTime) {
    o.push(spotOption(sim, a, 'meet', 1.3, 'Daily standup', ['meet'], () => 'In the standup meeting', 9999));
  }

  // ---- party
  if (sim.events.party && office && !sleepTime) {
    o.push(spotOption(sim, a, 'party', 1.0 + (a.traits.includes('extrovert') ? 0.2 : 0) - (a.traits.includes('introvert') ? 0.35 : 0), 'Office party', ['sit', 'play', 'music'], () => 'At the office party', 9999, (p) => sim.map.rooms[p.room]?.kind === 'lounge' || sim.map.rooms[p.room]?.kind === 'kitchen'));
  }

  // ---- repair
  if (sim.events.coffeeBroken && office && workTime && (a.role === 'engineer' || a.role === 'receptionist')) {
    const coffee = sim.map.props.find((p) => p.use === 'coffee' && sim.map.rooms[p.room]?.kind === 'kitchen');
    if (coffee) o.push(spotOption(sim, a, 'repair', 0.95, 'The coffee machine is broken', ['coffee'], () => 'Fixing the coffee machine', 20, (p) => p.id === coffee.id));
  }

  // ---- social
  if (n.social < 75) {
    const mult = a.traits.includes('extrovert') ? 1.3 : a.traits.includes('introvert') ? 0.6 : 1;
    const base = Math.pow(1 - n.social / 100, 1.3) * 0.95 * mult;
    let best: { p: Agent; score: number } | null = null;
    for (const p of sim.agents) {
      if (p.id === a.id) continue;
      const pk = p.action.kind;
      const available = (pk === 'idle' || pk === 'wander' || pk === 'relax' || pk === 'coffee' || pk === 'stroll' || ((pk === 'eat' || pk === 'snack') && p.action.stage === 'perform')) && p.action.kind !== 'sleep';
      if (!available) continue;
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      if (d > 22) continue;
      const r = rel(a, p);
      const pull = r.opinion <= RIVAL ? -0.35 : r.opinion / 220 + r.familiarity / 500;
      const sc = base + pull - d * 0.012 + sim.rng.range(0, 0.06);
      if (!best || sc > best.score) best = { p, score: sc };
    }
    if (best && best.score > 0.08) {
      const b = best;
      o.push({
        kind: 'socialize', score: b.score * breakMult, reason: `Lonely (${Math.round(n.social)})`,
        begin: () => {
          const path = sim.nav.findPath(a.at, b.p.at);
          if (!path || path.length > 40) return false;
          if (b.p.action.kind === 'idle' || b.p.action.kind === 'wander' || b.p.action.kind === 'stroll') {
            endAction(sim, b.p);
            b.p.action = { kind: 'socialize', label: `Talking with ${first(a)}`, reason: `${first(a)} came over`, stage: 'perform', dest: b.p.at, partnerId: a.id, timer: 30, started: sim.time, score: 0.6 };
            b.p.path = [];
          }
          think(sim, a, `Going to catch up with ${first(b.p)}.`);
          return start(sim, a, 'socialize', `Talking with ${first(b.p)}`, `Lonely (${Math.round(n.social)})`, { cell: b.p.at, path, cost: path.length }, 10, b.score, { partnerId: b.p.id, initiator: true });
        },
      });
    }
  }

  // ---- fun
  if (n.fun < 80) {
    const x = 1 - n.fun / 100;
    const free = !workTime && !sleepTime;
    if (office && !sim.weekend && loc !== 'home') {
      const waiting = sim.agents.some((p) => p.id !== a.id && p.action.kind === 'play' && p.action.stage === 'perform');
      const s = (x * 0.85 + (a.traits.includes('competitive') ? 0.2 : 0) + (waiting ? 0.35 : 0)) * breakMult;
      o.push(spotOption(sim, a, 'play', s, waiting ? 'Someone wants a game' : `Bored (${Math.round(n.fun)})`, ['play'], () => 'Playing ping pong', 16));
      o.push(spotOption(sim, a, 'music', (x * 0.6 + a.skills.music.level * 0.04 + (a.traits.includes('creative') ? 0.15 : 0)) * breakMult, `Bored (${Math.round(n.fun)})`, ['music'], () => 'Playing the piano', 22));
    }
    o.push(spotOption(sim, a, 'read', (x * 0.55 + (a.traits.includes('introvert') ? 0.15 : 0) + (a.traits.includes('creative') ? 0.1 : 0)) * breakMult, `Bored (${Math.round(n.fun)})`, ['read'], (p) => `Reading in the ${roomName(sim, p).toLowerCase()}`, sim.rng.range(30, 50)));
    o.push(spotOption(sim, a, 'relax', (x * 0.5 + (1 - n.energy / 100) * 0.3 + (evening ? 0.15 : 0)) * breakMult, n.energy < 45 ? 'Needs a sit-down' : `Unwinding`, ['sit'], (p) => `Relaxing in the ${roomName(sim, p).toLowerCase()}`, sim.rng.range(20, 40), (p) => (evening ? p.household === a.household : true)));
    if (free && !evening && !sim.events.rain) {
      o.push({
        kind: 'stroll', score: x * 0.6 + (a.traits.includes('extrovert') ? 0.05 : 0.1), reason: 'Fresh air',
        begin: () => {
          const cell = randomCellIn(sim, 45, 2, 18, 20);
          if (cell < 0) return false;
          const path = sim.nav.findPath(a.at, cell);
          if (!path) return false;
          return start(sim, a, 'stroll', 'Walking in the park', 'Fresh air', { cell, path, cost: path.length }, sim.rng.range(15, 30), x * 0.6);
        },
      });
    }
  }

  // ---- errands
  const housemateShopping = sim.agents.some((o) => o.id !== a.id && o.household === a.household && o.action.kind === 'shop');
  if (sim.pantry[a.household] <= 1 && !housemateShopping && !workTime && !evening && a.money >= 24) {
    o.push(spotOption(sim, a, 'shop', 0.85, 'Fridge is empty', ['shop'], () => 'Shopping for groceries', 14));
  }

  // ---- go home at night / idle
  if (evening && loc !== 'home') {
    o.push(spotOption(sim, a, 'relax', 0.7, 'Heading home for the night', ['sit'], () => 'Relaxing at home', 30, (p) => p.household === a.household));
  }
  o.push({
    kind: 'wander', score: 0.06, reason: 'Nothing pressing',
    begin: () => {
      const r = sim.roomOf(a);
      const cell = r ? randomCellIn(sim, r.x, r.y, r.w, r.h) : randomCellIn(sim, sim.map.cx(a.at) - 6, sim.map.cy(a.at) - 6, 12, 12);
      if (cell < 0) return false;
      const path = sim.nav.findPath(a.at, cell);
      if (!path) return false;
      return start(sim, a, 'wander', 'Pottering around', 'Nothing pressing', { cell, path, cost: path.length }, sim.rng.range(4, 10), 0.06);
    },
  });
  return o;
}

function decide(sim: Sim, a: Agent): void {
  a.thinkIn = 4 + sim.rng.range(0, 4);
  const opts = buildOptions(sim, a).sort((x, y) => y.score - x.score);
  const cur = a.action;
  let currentScore = 0;
  if (cur.kind !== 'idle') {
    const same = opts.find((x) => x.kind === cur.kind);
    currentScore = (same ? same.score : cur.score * 0.8) + INERTIA;
    // Don't abandon things halfway through for marginal gains.
    if (cur.stage === 'perform' && ['sleep', 'eat', 'shower', 'toilet', 'socialize', 'cook', 'meet', 'play', 'repair', 'party'].includes(cur.kind)) currentScore += 0.6;
  }
  for (const opt of opts) {
    if (opt.score <= currentScore) return;
    if (opt.kind === cur.kind && cur.kind !== 'wander' && cur.kind !== 'idle') return;
    if (opt.begin()) {
      if (opt.kind !== 'wander' && opt.kind !== 'socialize') think(sim, a, thoughtFor(a, opt), opt.score > 1.1 ? 'alert' : 'neutral');
      return;
    }
  }
}

function thoughtFor(a: Agent, o: Option): string {
  switch (o.kind) {
    case 'work': return a.task ? `Back to "${a.task.title}".` : 'Time to get some work done.';
    case 'eat': return o.reason === 'Free pizza!' ? 'Someone said free pizza?' : `${o.reason}. ${a.action.label}.`;
    case 'cook': return `${o.reason}. I'll cook something.`;
    case 'coffee': return o.reason === 'Morning coffee' ? 'Not human until I have coffee.' : 'Need a coffee to keep going.';
    case 'sleep': return o.reason === 'Bedtime' ? 'Long day. Off to bed.' : 'I can barely keep my eyes open.';
    case 'toilet': return 'Quick restroom break.';
    case 'shower': return o.reason === 'Morning shower' ? 'Shower first, then the world.' : 'I really need a shower.';
    case 'play': return o.reason === 'Someone wants a game' ? 'Someone is at the ping pong table. Game on.' : 'Ping pong break!';
    case 'music': return 'I feel like playing something.';
    case 'read': return 'A few pages of my book.';
    case 'relax': return o.reason === 'Heading home for the night' ? 'Heading home.' : 'Taking a breather.';
    case 'stroll': return 'A walk in the park sounds nice.';
    case 'shop': return 'We are out of food at home. Grocery run.';
    case 'meet': return 'Standup time.';
    case 'party': return 'Party in the lounge!';
    case 'repair': return 'I will take a look at that coffee machine.';
    case 'snack': return 'Just a quick snack.';
    default: return o.reason;
  }
}

/** Needs urgent enough to interrupt anything except sleep. */
function urgent(sim: Sim, a: Agent): boolean {
  const k = a.action.kind;
  if (a.bladder < 12 && k !== 'toilet') return true;
  if (a.needs.hunger < 10 && k !== 'eat' && k !== 'cook' && k !== 'snack' && k !== 'sleep') return true;
  if (sim.events.standup && ROLES[a.role].workplace === 'office' && isWorkTime(sim, a) && k !== 'meet' && k !== 'toilet') return true;
  return false;
}

// ------------------------------------------------------------------ performing

function arrive(sim: Sim, a: Agent): void {
  const act = a.action;
  act.stage = 'perform';
  if (act.facing) a.facing = act.facing;
  switch (act.kind) {
    case 'coffee':
      a.coffeeDay = sim.day;
      if (sim.events.coffeeBroken && sim.roomOf(a)?.kind === 'kitchen') {
        addMemory(sim, a, 'noCoffee');
        think(sim, a, 'The coffee machine is still broken. Unbelievable.', 'bad');
        say(sim, a, '☹', 'bad');
        return finish(sim, a);
      }
      if (sim.roomOf(a)?.kind === 'cafe') a.money -= 4;
      break;
    case 'socialize': {
      const p = sim.agent(act.partnerId);
      if (p && p.action.kind === 'socialize' && p.action.partnerId === a.id) {
        p.action.timer = act.timer + 3;
        p.action.label = `Talking with ${first(a)}`;
      }
      break;
    }
    case 'party':
      sim.events.party?.attendees.add(a.id);
      break;
    case 'meet':
      sim.events.standup?.attendees.add(a.id);
      break;
  }
}

function others(sim: Sim, a: Agent, kinds: ActionKind[], radius: number): Agent[] {
  return sim.agents.filter((o) => o.id !== a.id && kinds.includes(o.action.kind) && o.action.stage === 'perform' && Math.abs(o.x - a.x) <= radius && Math.abs(o.y - a.y) <= radius && sim.roomOf(o) === sim.roomOf(a));
}

function perform(sim: Sim, a: Agent, dt: number): void {
  const act = a.action;
  const n = a.needs;
  const tick = () => {
    act.timer -= dt;
    return act.timer <= 0;
  };
  switch (act.kind) {
    case 'idle':
      return;
    case 'wander':
      if (tick()) finish(sim, a);
      return;
    case 'stroll':
      n.fun = Math.min(100, n.fun + 0.5 * dt);
      if (sim.events.rain) {
        addMemory(sim, a, 'soaked');
        think(sim, a, 'And now it is raining. Great.', 'bad');
        return finish(sim, a);
      }
      if (tick()) finish(sim, a);
      return;
    case 'work':
      return performWork(sim, a, dt, tick);
    case 'meet': {
      n.work = Math.min(100, n.work + 0.15 * dt);
      n.social = Math.min(100, n.social + socialGain(a, 0.12) * dt);
      for (const o of others(sim, a, ['meet'], 8)) bondNearby(sim, a, o, dt * 0.5);
      if (!sim.events.standup) {
        addMemory(sim, a, 'meeting');
        finish(sim, a);
      }
      return;
    }
    case 'eat': {
      n.hunger = Math.min(100, n.hunger + 2.6 * dt);
      const company = others(sim, a, ['eat', 'party'], 4);
      for (const o of company) bondNearby(sim, a, o, dt);
      if (company.length) n.social = Math.min(100, n.social + socialGain(a, 0.3) * dt);
      if (tick()) {
        a.mealReady = false;
        addMemory(sim, a, company.length ? 'sharedMeal' : 'ateAlone');
        if (sim.events.pizza && sim.roomOf(a)?.kind === 'kitchen') addMemory(sim, a, 'pizza');
        if (sim.roomOf(a)?.kind === 'cafe' && a.traits.includes('foodie')) say(sim, a, 'mmm', 'good');
        finish(sim, a);
      }
      return;
    }
    case 'snack':
      n.hunger = Math.min(100, n.hunger + 4 * dt);
      if (tick()) finish(sim, a);
      return;
    case 'coffee':
      n.energy = Math.min(100, n.energy + 2.6 * dt);
      if (tick()) {
        if (sim.roomOf(a)?.kind === 'cafe') addMemory(sim, a, 'greatCoffee');
        finish(sim, a);
      }
      return;
    case 'cook':
      gainXp(sim, a, 'cooking', dt * 0.4);
      if (tick()) {
        sim.pantry[a.household] = Math.max(0, sim.pantry[a.household] - 1);
        a.mealReady = true;
        say(sim, a, '♨', 'good');
        finish(sim, a);
      }
      return;
    case 'sleep': {
      n.energy = Math.min(100, n.energy + 0.21 * dt);
      const wakeTime = !isSleepTime(sim, a);
      if ((wakeTime && n.energy > 70) || (n.energy >= 99.5 && wakeTime)) {
        addMemory(sim, a, n.energy > 85 ? 'sleptWell' : 'badNight');
        think(sim, a, n.energy > 85 ? 'Good morning! Slept like a log.' : 'Did I even sleep?', n.energy > 85 ? 'good' : 'bad');
        finish(sim, a);
      }
      return;
    }
    case 'toilet':
      if (tick()) {
        a.bladder = 100;
        n.hygiene = Math.min(100, n.hygiene + 6);
        finish(sim, a);
      }
      return;
    case 'shower':
      n.hygiene = Math.min(100, n.hygiene + 8 * dt);
      if (tick()) finish(sim, a);
      return;
    case 'socialize':
      return performSocial(sim, a, dt);
    case 'play':
      return performPlay(sim, a, dt, tick);
    case 'music': {
      n.fun = Math.min(100, n.fun + (a.traits.includes('creative') ? 1.1 : 0.8) * dt);
      gainXp(sim, a, 'music', dt * 0.5);
      for (const o of others(sim, a, ['relax', 'eat', 'play', 'party', 'idle', 'wander'], 6)) o.needs.fun = Math.min(100, o.needs.fun + 0.15 * dt);
      if (Math.floor(sim.time * 2) % 7 === 0) say(sim, a, '♫', 'good', 2);
      if (tick()) {
        addMemory(sim, a, 'playedMusic');
        finish(sim, a);
      }
      return;
    }
    case 'read':
      n.fun = Math.min(100, n.fun + (a.traits.includes('creative') ? 0.75 : 0.5) * dt);
      if (a.traits.includes('introvert')) n.energy = Math.min(100, n.energy + 0.05 * dt);
      if (tick()) {
        addMemory(sim, a, 'goodRead');
        finish(sim, a);
      }
      return;
    case 'relax':
      n.fun = Math.min(100, n.fun + 0.35 * dt);
      n.energy = Math.min(100, n.energy + 0.06 * dt);
      for (const o of others(sim, a, ['relax'], 4)) bondNearby(sim, a, o, dt);
      if (tick()) finish(sim, a);
      return;
    case 'shop':
      if (tick()) {
        sim.pantry[a.household] += 6;
        a.money -= 24;
        sim.log(`${first(a)} bought groceries`, 'life', 'neutral', a);
        finish(sim, a);
      }
      return;
    case 'party':
      n.fun = Math.min(100, n.fun + 0.9 * dt);
      n.social = Math.min(100, n.social + socialGain(a, 0.7) * dt);
      n.hunger = Math.min(100, n.hunger + 0.6 * dt);
      for (const o of others(sim, a, ['party'], 10)) bondNearby(sim, a, o, dt * 2);
      if (sim.rng.chance(0.02 * dt)) say(sim, a, sim.rng.pick(['woo!', '♪', 'ha!', 'cheers']), 'good', 3);
      if (!sim.events.party) finish(sim, a);
      return;
    case 'repair':
      gainXp(sim, a, 'craft', dt * 0.2);
      if (tick()) {
        if (sim.events.coffeeBroken) {
          sim.events.coffeeBroken = false;
          sim.log(`${first(a)} fixed the coffee machine`, 'event', 'good', a);
          for (const o of sim.agents) if (ROLES[o.role].workplace === 'office' && o.id !== a.id) shiftOpinion(sim, o, a, 3);
          think(sim, a, 'Fixed it. You are welcome, everyone.', 'good');
          say(sim, a, '☕', 'good');
        }
        finish(sim, a);
      }
      return;
  }
}

function performWork(sim: Sim, a: Agent, dt: number, tick: () => boolean): void {
  const n = a.needs;
  if (!a.task) a.task = newTask(sim, a);
  const t = a.task;
  const skill = a.skills.craft.level;
  const moodF = 0.6 + a.mood / 125;
  const energyF = n.energy < 20 ? 0.6 : 1;
  const traitF = a.traits.includes('workaholic') ? 1.15 : a.traits.includes('slacker') ? 0.75 : 1;
  const rate = (0.45 + skill * 0.06) * moodF * energyF * traitF;
  t.progress += rate * dt;
  a.workedToday += dt;
  a.money += 0.4 * dt;
  n.work = Math.min(100, n.work + 0.45 * dt);
  gainXp(sim, a, 'craft', dt * 0.3);
  if (a.traits.includes('creative') && sim.rng.chance(0.0015 * dt)) {
    t.progress += 15;
    think(sim, a, 'Oh! I just had a great idea for this.', 'good');
    say(sim, a, '✨', 'good', 4);
  }
  if (t.due !== undefined && sim.time > t.due) {
    addMemory(sim, a, 'missedDeadline');
    think(sim, a, `"${t.title}" is overdue. Not good.`, 'bad');
    sim.log(`${first(a)} missed the deadline for "${t.title}"`, 'work', 'bad', a);
    t.due = undefined;
  }
  if (t.progress >= t.total) {
    a.tasksDone++;
    sim.tasksCompleted++;
    addMemory(sim, a, 'finishedTask');
    say(sim, a, '✓', 'good', 5);
    think(sim, a, `Done with "${t.title}"!`, 'good');
    sim.log(`${first(a)} finished "${t.title}"`, 'work', 'good', a);
    a.task = newTask(sim, a);
    a.action.label = a.action.label.replace(/: .*$/, `: ${a.task.title}`);
  }
  if (tick() || (!isWorkTime(sim, a) && !a.traits.includes('workaholic'))) finish(sim, a);
}

function performSocial(sim: Sim, a: Agent, dt: number): void {
  const act = a.action;
  const p = sim.agent(act.partnerId);
  if (!p) return finish(sim, a);
  act.timer -= dt;
  if (!act.initiator) {
    if (p.action.kind !== 'socialize' || p.action.partnerId !== a.id || act.timer <= 0) finish(sim, a);
    else a.facing = faceToward(a, p);
    return;
  }
  const together = Math.abs(p.x - a.x) <= 1.6 && Math.abs(p.y - a.y) <= 1.6;
  if (!together) {
    const path = sim.nav.findPath(a.at, p.at);
    if (path && path.length < 25 && path.length > 0) {
      a.path = path.slice(0, Math.max(1, path.length - 1));
      a.pathPos = 0;
      a.edgeT = 0;
      act.stage = 'travel';
      act.dest = a.path[a.path.length - 1];
      return;
    }
    if (!path || path.length >= 25) return finish(sim, a);
  }
  a.facing = faceToward(a, p);
  if (act.timer <= 0) {
    converse(sim, a, p);
    finish(sim, a);
  }
}

function performPlay(sim: Sim, a: Agent, dt: number, tick: () => boolean): void {
  const n = a.needs;
  const partner = sim.agents.find((o) => o.id !== a.id && o.action.kind === 'play' && o.action.stage === 'perform');
  n.energy = Math.max(0, n.energy - 0.05 * dt);
  if (!partner) {
    // Waiting at the table; give up after a while.
    n.fun = Math.min(100, n.fun + 0.15 * dt);
    if (tick()) {
      think(sim, a, 'Nobody wants to play. Oh well.', 'neutral');
      finish(sim, a);
    }
    return;
  }
  n.fun = Math.min(100, n.fun + 1.3 * dt);
  n.social = Math.min(100, n.social + socialGain(a, 0.3) * dt);
  gainXp(sim, a, 'athletics', dt * 0.5);
  if (sim.rng.chance(0.03 * dt)) say(sim, a, sim.rng.pick(['pok', 'tik', 'ha!']), 'neutral', 1);
  // The one whose timer runs out first resolves the match for both.
  if (tick()) {
    const pa = a.skills.athletics.level + sim.rng.range(0, 6) + (a.traits.includes('competitive') ? 1 : 0);
    const pb = partner.skills.athletics.level + sim.rng.range(0, 6) + (partner.traits.includes('competitive') ? 1 : 0);
    const [w, l] = pa >= pb ? [a, partner] : [partner, a];
    addMemory(sim, w, 'wonPingPong', l, w.traits.includes('competitive') ? 1.5 : 1);
    addMemory(sim, l, 'lostPingPong', w, l.traits.includes('competitive') ? 2.5 : 1);
    if (l.traits.includes('competitive')) shiftOpinion(sim, l, w, -3);
    else shiftOpinion(sim, l, w, 2);
    shiftOpinion(sim, w, l, 2);
    say(sim, w, 'yes!', 'good', 4);
    say(sim, l, l.traits.includes('competitive') ? 'rematch!' : 'gg', l.traits.includes('competitive') ? 'bad' : 'neutral', 4);
    sim.log(`${first(w)} beat ${first(l)} at ping pong`, 'social', 'neutral', w, l);
    finish(sim, a);
    finish(sim, partner);
  }
}

function faceToward(a: Agent, b: Agent): Facing {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}

// ------------------------------------------------------------------ movement

function move(sim: Sim, a: Agent, dt: number): void {
  const m = sim.map;
  let budget = WALK_SPEED * dt * (a.needs.energy < 15 ? 0.7 : 1);
  a.moving = true;
  while (budget > 0 && a.pathPos < a.path.length) {
    const next = a.path[a.pathPos];
    if (!m.walkable(m.cx(next), m.cy(next)) && next !== a.action.dest) {
      // Something moved into the way; re-plan.
      const p = sim.nav.findPath(a.at, a.action.dest);
      if (!p) return finish(sim, a);
      a.path = p;
      a.pathPos = 0;
      a.edgeT = 0;
      continue;
    }
    const ax = m.cx(a.at);
    const ay = m.cy(a.at);
    const bx = m.cx(next);
    const by = m.cy(next);
    // Wait at the curb while a car is coming down the lane we're about to step into.
    if (a.edgeT === 0 && carApproaching(sim, bx, by)) {
      a.moving = false;
      return;
    }
    const len = (ax !== bx && ay !== by ? Math.SQRT2 : 1) * (1 + Math.min(1.5, m.cost[next] * 0.25));
    const need = (1 - a.edgeT) * len;
    a.facing = Math.abs(bx - ax) >= Math.abs(by - ay) ? (bx > ax ? 'right' : 'left') : by > ay ? 'down' : 'up';
    if (budget >= need) {
      budget -= need;
      a.at = next;
      a.pathPos++;
      a.edgeT = 0;
      a.x = bx;
      a.y = by;
    } else {
      a.edgeT += budget / len;
      budget = 0;
      a.x = ax + (bx - ax) * a.edgeT;
      a.y = ay + (by - ay) * a.edgeT;
    }
  }
  if (a.pathPos >= a.path.length) {
    a.moving = false;
    arrive(sim, a);
  }
}

const ROAD = new Set(['asphalt', 'laneH', 'laneV', 'crossH', 'crossV']);

function carApproaching(sim: Sim, x: number, y: number): boolean {
  if (!ROAD.has(sim.map.ground[sim.map.idx(x, y)])) return false;
  // Cars already stopped for us are no threat; moving ones are.
  return sim.cars.some((c) => c.speed > 2 && laneThreat(c, x + 0.5, y + 0.5));
}

export function tickAgents(sim: Sim, dt: number): void {
  for (const a of sim.agents) {
    a.px = a.x;
    a.py = a.y;
    updateNeeds(sim, a, dt);
    a.thinkIn -= dt;
    const asleep = a.action.kind === 'sleep' && a.action.stage === 'perform';
    if (a.action.kind === 'idle' || (a.thinkIn <= 0 && !asleep) || (urgent(sim, a) && !asleep)) decide(sim, a);
    if (a.action.stage === 'travel') move(sim, a, dt);
    else {
      a.moving = false;
      perform(sim, a, dt);
    }
  }
}

export const MINUTES_PER_DAY = MIN_PER_DAY;
