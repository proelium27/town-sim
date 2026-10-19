import type { Facing } from '../assets/manifest';
import type { Prop, UseKind } from '../world/map';
import { ageOf, hasUmbrella, newTask } from './agents';
import { ADULT_AGE, MIN_PER_DAY, NEED_KEYS, ROLES, SKILL_KEYS, SKILL_LABEL, type SkillKey } from './defs';
import { FOOD_PER_CROP } from './economy';
import { CARRY, laborPlan } from './labor';
import { buildCap, completeProject, shortOf, supplied } from './planner';
import { chill, HEARTH_FULL } from './seasons';
import { learnBoost, lessonAptitude } from './careers';
import { fallIll, needsCare, offSick, tickIllness } from './health';
import { askFamilyForHelp, payWage, price, spend } from './market';
import { canMake, RECIPES, STATION_OF } from './workshop';
import { clamp } from './rng';
import {
  addMemory, bondNearby, converse, expireMemories, first, FRIEND, kinship, moodTarget, rel, RIVAL, say, shiftOpinion, socialGain, think,
} from './social';
import type { Action, ActionKind, Agent } from './types';
import type { Sim } from './sim';
import { laneThreat } from './traffic';

/** Tiles per game minute on flat ground. */
export const WALK_SPEED = 3.2;
const INERTIA = 0.15;
/** The original park, where festivals happen. */
const PARK = { x: 45, y: 2, w: 18, h: 20 };

type Stage = 'toddler' | 'child' | 'adult' | 'elder';

export function stageOf(sim: Sim, a: Agent): Stage {
  const age = ageOf(sim, a);
  if (age < 4) return 'toddler';
  if (age < ADULT_AGE) return 'child';
  return a.role === 'retired' ? 'elder' : 'adult';
}

// ------------------------------------------------------------------ time helpers

/** Is hour h inside [from, to), allowing windows that wrap past midnight. */
export function inWindow(h: number, from: number, to: number): boolean {
  const f = ((from % 24) + 24) % 24;
  const t = ((to % 24) + 24) % 24;
  return f <= t ? h >= f && h < t : h >= f || h < t;
}

export function isWorkTime(sim: Sim, a: Agent): boolean {
  if (a.role === 'child' || a.role === 'retired') return false;
  // Farms, building sites and the woods don't take weekends off; offices and shops do.
  if (ROLES[a.role].station !== 'labor' && sim.weekend) return false;
  return inWindow(sim.hour, a.schedule.workStart, a.schedule.workEnd);
}

export function isSleepTime(sim: Sim, a: Agent): boolean {
  return inWindow(sim.hour, a.schedule.sleep, a.schedule.wake);
}

const isOffice = (a: Agent) => ROLES[a.role].workplace === 'office';
const hasHome = (sim: Sim, a: Agent) => sim.town.households[a.household].building >= 0;

function where(sim: Sim, a: Agent): 'home' | 'work' | 'out' {
  const r = sim.roomOf(a);
  if (!r) return 'out';
  if (r.kind === 'home' && sim.town.households[a.household].room === r.id) return 'home';
  const wb = sim.building(a.workBuilding);
  if (wb?.rooms.includes(r.id)) return 'work';
  const wp = sim.town.workplaces.find((w) => w.id === ROLES[a.role].workplace);
  return wp?.rooms.includes(r.id) ? 'work' : 'out';
}

// ------------------------------------------------------------------ spots

/** Can this agent use this prop's spot right now? Encodes ownership, opening hours and reservations. */
function canUse(sim: Sim, a: Agent, p: Prop): boolean {
  if (!p.spot) return false;
  const holder = sim.reserved.get(p.id);
  if (holder !== undefined && holder !== a.id && p.use !== 'deposit') return false;
  if (p.use === 'work' || p.use === 'teach') return p.id === a.deskId;
  if (p.use === 'learn') return a.role === 'child';
  const room = p.room >= 0 ? sim.map.rooms[p.room] : undefined;
  if (p.household !== undefined) return p.household === a.household;
  if (room?.kind === 'home') return sim.town.households[a.household].room === room.id;
  if (room?.building === 'Northwind Studio') return isOffice(a);
  if (room) {
    const wp = sim.town.workplaces.find((w) => w.rooms.includes(room.id));
    if (wp && ROLES[a.role].workplace !== wp.id && !inWindow(sim.hour, wp.open, wp.close)) return false;
    // Built cafés and schools keep similar hours.
    if (!wp && (room.kind === 'cafe' || room.kind === 'school') && sim.building(p.building)?.id !== a.workBuilding && !inWindow(sim.hour, 7, 20)) return false;
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
    const path = cell === a.at ? [] : sim.nav.findPath(a.at, cell, 40000);
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

const roomKind = (sim: Sim, p: Prop) => (p.room >= 0 ? sim.map.rooms[p.room].kind : undefined);

// ------------------------------------------------------------------ needs

function updateNeeds(sim: Sim, a: Agent, dt: number, stage: Stage): void {
  const n = a.needs;
  const k = a.action.kind;
  const performing = a.action.stage === 'perform';
  const asleep = k === 'sleep' && performing;
  const working = (k === 'work' || k === 'build' || k === 'chop' || k === 'mine' || k === 'farm' || k === 'haul' || k === 'teach' || k === 'split' || k === 'stoke' || k === 'craft') && performing;
  // Tools wear out with use.
  if (a.tool > 0 && performing && (k === 'build' || k === 'chop' || k === 'mine' || k === 'farm' || k === 'split' || k === 'craft')) {
    a.tool -= 0.0012 * dt;
    if (a.tool <= 0) {
      a.tool = 0;
      addMemory(sim, a, 'toolBroke');
      think(sim, a, 'And there go my tools. Worn right through.', 'bad');
    }
  }
  const tired = stage === 'elder' ? 1.25 : stage === 'toddler' ? 1.3 : 1;
  if (!asleep) n.energy -= (working ? 0.075 : 0.06) * dt * tired * (a.traits.includes('earlyBird') && sim.hour > 19 ? 1.4 : 1);
  n.hunger -= (a.traits.includes('foodie') ? 0.13 : 0.105) * dt * (asleep ? 0.4 : 1) * (working && k !== 'work' ? 1.2 : 1);
  n.hygiene -= (k === 'play' || k === 'stroll' || k === 'chop' || k === 'mine' || k === 'build' || k === 'farm' ? 0.12 : 0.05) * dt * (asleep ? 0.5 : 1);
  const soc = a.traits.includes('extrovert') ? 0.1 : a.traits.includes('introvert') ? 0.04 : 0.065;
  n.social -= soc * dt * (asleep ? 0.2 : 1);
  n.fun -= (working ? 0.08 : 0.045) * dt * (asleep ? 0.2 : 1) * (stage === 'child' ? 1.3 : 1);
  if (isWorkTime(sim, a)) {
    if (!working && k !== 'meet' && k !== 'deposit') n.work -= (a.traits.includes('workaholic') ? 0.16 : a.traits.includes('slacker') ? 0.05 : 0.1) * dt;
  } else n.work += (60 - n.work) * 0.002 * dt;
  // Warmth only drops in the cold, and only away from a warm room.
  const c = chill(sim);
  if (c > 0) {
    const room = sim.roomOf(a);
    const own = room && room.id === sim.town.households[a.household].room;
    const fire = sim.fuel[a.household] > 0;
    if (!room && k === 'party' && sim.events.festival) n.warmth += 0.5 * dt;
    else if (!room) n.warmth -= c * (sim.events.snowstorm ? 0.7 : 0.35) * (working || a.moving ? 0.75 : 1) * dt;
    else if (own) n.warmth += fire ? 1.2 * dt : -c * 0.12 * dt;
    else n.warmth += 0.8 * dt;
    if (own && !fire && c > 0.3 && !asleep) addMemory(sim, a, 'coldHome');
    if (own && fire && c > 0.3 && n.warmth > 85 && (k === 'relax' || k === 'read' || k === 'eat')) addMemory(sim, a, 'cozyFire');
  } else n.warmth += 0.6 * dt;
  a.bladder -= 0.32 * dt * (asleep ? 0.3 : 1);
  if (k === 'coffee' && performing) a.bladder -= 0.4 * dt;
  tickIllness(sim, a, dt);
  if (a.illness) n.energy -= a.illness.severity * 0.04 * dt;
  for (const key of NEED_KEYS) n[key] = clamp(n[key], 0, 100);
  // Kids playing outside grow a love of the outdoors.
  if (stage === 'child' && performing && (k === 'play' || k === 'stroll' || k === 'wander') && sim.map.room[a.at] < 0) a.aptitude.outdoors = Math.min(100, a.aptitude.outdoors + 0.03 * dt);
  a.bladder = clamp(a.bladder, 0, 100);

  if (n.hunger < 8) addMemory(sim, a, 'starving');
  if (n.hygiene < 20) addMemory(sim, a, 'stinky');
  if (a.workedToday > 10 * 60) addMemory(sim, a, 'longDay');
  expireMemories(sim, a);
  a.mood = clamp(a.mood + (moodTarget(a) - a.mood) * Math.min(1, 0.02 * dt), 0, 100);
  if (a.bubble && a.bubble.until < sim.time) a.bubble = null;
}

export const xpToNext = (level: number): number => 120 + level * 90;

function gainXp(sim: Sim, a: Agent, skill: SkillKey, amount: number): void {
  const s = a.skills[skill];
  if (s.level >= 10) return;
  // Apprentices learn twice as fast, three times beside their mentor (and get to know them).
  const boost = learnBoost(sim, a);
  if (boost === 3 && skill === 'craft') {
    const m = sim.agent(a.mentor);
    if (m) bondNearby(sim, a, m, amount * 0.5);
  }
  s.xp += amount * boost * (a.traits.includes('workaholic') && skill === 'craft' ? 1.25 : 1);
  const need = xpToNext(s.level);
  if (s.xp >= need) {
    s.xp -= need;
    s.level++;
    addMemory(sim, a, 'skillUp');
    const label = skill === 'craft' ? ROLES[a.role].craft : SKILL_LABEL[skill];
    think(sim, a, `I'm getting better at ${label.toLowerCase()}.`, 'good');
    if (s.level % 2 === 0) sim.log(`${first(a)} reached ${label} ${s.level}`, 'life', 'good', a);
  }
}

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
  a.walkWith = undefined;
  a.action = { kind, label, reason, stage: t.path.length ? 'travel' : 'perform', dest: t.cell, facing: t.facing, propId: t.prop?.id, timer, started: sim.time, score, ...extra };
  a.path = t.path;
  a.pathPos = 0;
  a.edgeT = 0;
  if (t.prop && t.prop.use !== 'deposit') sim.reserved.set(t.prop.id, a.id);
  if (extra.propId !== undefined) sim.reserved.set(extra.propId, a.id);
  if (a.action.stage === 'perform') arrive(sim, a);
  else if (kind === 'stroll' && !reason.startsWith('Out with')) invitePartner(sim, a);
  else if (kind === 'learn') askForEscort(sim, a);
  if (kind === 'eat' && reason === 'Food is ready' && inWindow(sim.hour, 17.5, 20.5)) callToDinner(sim, a);
  return true;
}

/** Dinner's on the table: everyone at home takes a moment to decide whether to sit down too. */
function callToDinner(sim: Sim, a: Agent): void {
  const room = sim.town.households[a.household].room;
  if (sim.roomOf(a)?.id !== room) return;
  for (const o of sim.agents) if (o.id !== a.id && o.household === a.household && sim.roomOf(o)?.id === room && o.action.kind !== 'sleep') o.thinkIn = 0;
  say(sim, a, sim.rng.pick(['dinner!', "food's ready!"]), 'good', 3);
}

/** A young kid setting off for school gets walked there by a grown-up from home, if one is free. */
function askForEscort(sim: Sim, kid: Agent): void {
  if (ageOf(sim, kid) >= 14 || kid.path.length < 8) return;
  const room = sim.roomOf(kid);
  const school = sim.map.buildings.find((b) => b.kind === 'school');
  if (!room || !school) return;
  const free = ['idle', 'wander', 'relax', 'read', 'coffee', 'eat', 'snack'];
  const adult = sim.agents.find((p) => p.household === kid.household && (stageOf(sim, p) === 'adult' || stageOf(sim, p) === 'elder') && sim.roomOf(p) === room && !p.walkWith && free.includes(p.action.kind));
  if (!adult) return;
  const dest = sim.map.idx(school.door.x, school.door.y);
  const path = sim.nav.findPath(adult.at, dest, 40000);
  if (!path) return;
  start(sim, adult, 'escort', `Walking ${first(kid)} to school`, `${first(kid)} has school`, { cell: dest, path, cost: path.length }, 2, 1.35, { partnerId: kid.id });
  adult.walkWith = kid.id;
  kid.walkWith = adult.id;
  think(sim, adult, `I'll walk ${first(kid)} to school on my way.`, 'good');
}

/** Off for a stroll: a partner at home with nothing much on comes along, side by side. */
function invitePartner(sim: Sim, a: Agent): void {
  const b = sim.agent(a.partner ?? undefined);
  if (!b || sim.roomOf(b) !== sim.roomOf(a) || !['idle', 'wander', 'relax', 'read'].includes(b.action.kind)) return;
  if (b.needs.energy < 35 || isWorkTime(sim, b) || stageOf(sim, b) === 'toddler' || !sim.rng.chance(a.action.reason === 'Evening walk' ? 1 : 0.6)) return;
  const m = sim.map;
  const dx = m.cx(a.action.dest);
  const dy = m.cy(a.action.dest);
  const cell = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ox, oy]) => [dx + ox, dy + oy]).find(([x, y]) => m.walkable(x, y) && m.cost[m.idx(x, y)] < 1);
  if (!cell) return;
  const dest = m.idx(cell[0], cell[1]);
  const path = sim.nav.findPath(b.at, dest, 40000);
  if (!path) return;
  start(sim, b, 'stroll', `Walking with ${first(a)}`, `Out with ${first(a)}`, { cell: dest, path, cost: path.length }, a.action.timer, 0.9);
  b.walkWith = a.id;
  a.walkWith = b.id;
  say(sim, b, 'wait for me!', 'good', 2);
  if (a.action.reason === 'Evening walk') for (const x of [a, b]) addMemory(sim, x, 'eveningWalk', x === a ? b : a);
}

function endAction(sim: Sim, a: Agent): void {
  const act = a.action;
  if (act.propId !== undefined && sim.reserved.get(act.propId) === a.id) sim.reserved.delete(act.propId);
  if (act.projectId !== undefined) sim.projects.find((p) => p.id === act.projectId)?.builders.delete(a.id);
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
function spotOption(sim: Sim, a: Agent, kind: ActionKind, score: number, reason: string, uses: UseKind[], label: (p: Prop) => string, timer: number, filter?: (p: Prop) => boolean, onStart?: (p: Prop) => boolean | void): Option {
  return {
    kind, score, reason,
    begin: () => {
      const t = findSpot(sim, a, uses, filter);
      if (!t?.prop) return false;
      if (onStart?.(t.prop) === false) return false;
      return start(sim, a, kind, label(t.prop), reason, t, timer, score);
    },
  };
}

function roomName(sim: Sim, p: Prop): string {
  return p.room >= 0 ? sim.map.rooms[p.room].name : 'park';
}

/** "at home", "in the lounge", "in the park": where an activity is happening, for labels. */
function where_(sim: Sim, p: Prop): string {
  return roomKind(sim, p) === 'home' ? 'at home' : `in the ${roomName(sim, p).toLowerCase()}`;
}

/** Walk somewhere in an area and hang out there. */
function areaOption(sim: Sim, a: Agent, kind: ActionKind, score: number, reason: string, label: string, area: { x: number; y: number; w: number; h: number }, timer: number, extra: Partial<Action> = {}): Option {
  return {
    kind, score, reason,
    begin: () => {
      const cell = randomCellIn(sim, area.x, area.y, area.w, area.h);
      if (cell < 0) return false;
      const path = cell === a.at ? [] : sim.nav.findPath(a.at, cell, 40000);
      if (!path) return false;
      return start(sim, a, kind, label, reason, { cell, path, cost: path.length }, timer, score, extra);
    },
  };
}

function buildOptions(sim: Sim, a: Agent, stage: Stage): Option[] {
  const n = a.needs;
  const o: Option[] = [];
  const workTime = isWorkTime(sim, a);
  const sleepTime = isSleepTime(sim, a);
  const loc = where(sim, a);
  const h = sim.hour;
  const office = isOffice(a);
  const homed = hasHome(sim, a);
  const little = stage === 'toddler' || stage === 'child';
  // During work (or school) hours, leisure has to beat the pull of the job.
  const schoolTime = stage === 'child' && !sim.weekend && inWindow(h, 8.5, 15) && ageOf(sim, a) >= 6 && sim.map.buildings.some((b) => b.kind === 'school');
  const breakMult = workTime || schoolTime ? (a.traits.includes('slacker') ? 0.85 : a.traits.includes('workaholic') ? 0.45 : 0.6) : 1;
  const evening = h >= 20.5 || h < 5;
  const homeOnly = (p: Prop) => p.household === a.household;

  // ---- sleep
  {
    const x = 1 - n.energy / 100;
    let s = Math.pow(x, 2) * 1.1 + (sleepTime ? 0.9 : 0) + (stage === 'toddler' && h > 12.5 && h < 14.5 ? 0.5 : 0);
    if (n.energy < 10) s += 0.6;
    if (!sleepTime && n.energy > 35) s *= 0.3;
    if (s > 0.15) {
      if (homed) o.push(spotOption(sim, a, 'sleep', s, sleepTime ? 'Bedtime' : `Exhausted (${Math.round(n.energy)})`, ['sleep'], () => 'Sleeping', 0, homeOnly));
      else o.push(spotOption(sim, a, 'sleep', s, 'No home to go to', ['sit'], () => 'Sleeping rough', 0, (p) => p.household === undefined && roomKind(sim, p) !== 'home', () => {
        addMemory(sim, a, 'sleptRough');
        think(sim, a, 'Another night on a bench. We need a home.', 'bad');
      }));
    }
  }

  // ---- restroom / hygiene
  if (a.bladder < 45) {
    o.push(spotOption(sim, a, 'toilet', Math.pow(1 - a.bladder / 100, 2) * 1.6, 'Needs the restroom', ['toilet'], () => 'In the restroom', 4));
  }
  if (n.hygiene < 70 && homed) {
    const morning = inWindow(h, a.schedule.wake, a.schedule.wake + 1.5);
    const s = (1 - n.hygiene / 100) * (a.traits.includes('neatFreak') ? 1.3 : 0.9) + (morning ? 0.35 : 0) - (loc === 'home' ? 0 : 0.2);
    o.push(spotOption(sim, a, 'shower', s * breakMult, morning ? 'Morning shower' : `Feeling grimy (${Math.round(n.hygiene)})`, ['shower'], () => (little ? 'Bath time' : 'Showering'), 12, homeOnly));
  }

  // ---- food
  const lunchy = inWindow(h, a.schedule.lunch - 0.4, a.schedule.lunch + 1);
  const breakfast = inWindow(h, a.schedule.wake, a.schedule.wake + 1.2);
  const dinner = inWindow(h, 18, 20.5);
  const pantry = sim.pantry[a.household] ?? 0;
  if (a.mealReady) {
    o.push(spotOption(sim, a, 'eat', 1.4, 'Food is ready', ['eat'], () => 'Eating at home', 22, homeOnly));
  } else if (n.hunger < 75) {
    const x = 1 - n.hunger / 100;
    let s = Math.pow(x, 1.5) * 1.3 + (lunchy || breakfast || dinner ? 0.35 : 0) + (a.traits.includes('foodie') ? 0.1 : 0);
    if (n.hunger < 15) s += 0.5;
    const reason = lunchy ? 'Lunchtime' : breakfast ? 'Breakfast' : dinner ? 'Dinnertime' : `Hungry (${Math.round(n.hunger)})`;
    const atHomeTime = loc === 'home' || (!workTime && !schoolTime && (evening || dinner || breakfast));
    if (homed && atHomeTime && pantry > 0 && stage !== 'toddler') {
      const famHome = dinner && sim.agents.some((x) => x.id !== a.id && x.household === a.household && sim.roomOf(x)?.id === sim.town.households[a.household].room);
      o.push(spotOption(sim, a, 'cook', s + (famHome ? 0.2 : 0), reason, ['cook'], () => (stage === 'child' ? 'Making a sandwich' : 'Cooking at home'), stage === 'child' ? 8 : 18, homeOnly));
    }
    if (little && homed && pantry > 0) {
      o.push(spotOption(sim, a, 'eat', s * 0.9, reason, ['eat'], () => 'Having a snack at home', 15, homeOnly, () => {
        if (sim.pantry[a.household] < 1) return false;
        sim.pantry[a.household] -= 0.5;
      }));
    }
    if (sim.stock.food >= 1) {
      if (office && !sim.weekend && loc !== 'home') {
        o.push(spotOption(sim, a, 'eat', s * (workTime ? 1 : 0.6) + (sim.events.pizza ? 0.4 : 0), sim.events.pizza ? 'Free pizza!' : reason, ['eat'], () => (sim.events.pizza ? 'Eating pizza in the kitchen' : 'Lunch in the kitchen'), 24, (p) => roomKind(sim, p) === 'kitchen'));
      }
      const meal = Math.round(5 + price(sim, 'food') * 1.5);
      if (a.money >= meal && !evening && !little) {
        o.push(spotOption(sim, a, 'eat', s * (a.traits.includes('foodie') ? 1.15 : 0.9) + (!homed ? 0.3 : 0), reason, ['eat'], (p) => `Eating at the ${roomName(sim, p)}`, 26, (p) => roomKind(sim, p) === 'cafe', () => spend(sim, a, meal)));
      }
    }
    if (n.hunger < 55 && workTime && stage === 'adult') o.push(spotOption(sim, a, 'snack', s * 0.7, 'Quick snack', ['snack'], () => 'Grabbing a snack', 5));
  }

  // ---- coffee (grown-ups only)
  if (!little) {
    const morningHabit = a.coffeeDay !== sim.day && inWindow(h, a.schedule.wake + 0.3, a.schedule.wake + 3.5);
    const tired = n.energy < 55 && !sleepTime;
    if (morningHabit || tired) {
      const s = (morningHabit ? 0.75 : 0) + (tired ? (1 - n.energy / 100) * 0.6 : 0);
      o.push(spotOption(sim, a, 'coffee', s, morningHabit ? 'Morning coffee' : `Tired (${Math.round(n.energy)})`, ['coffee'], (p) => `Getting coffee at the ${roomName(sim, p).toLowerCase()}`, 6, (p) => !(sim.events.coffeeBroken && roomKind(sim, p) === 'kitchen')));
    }
  }

  // ---- work
  const sick = offSick(a);
  if (stage === 'adult' && !sick) workOptions(sim, a, o, workTime, h);
  // ---- illness: to bed, or to the clinic if there is one
  if (a.illness && a.illness.severity > 0.2) {
    const sev = a.illness.severity;
    const clinic = sim.map.buildings.some((b) => b.kind === 'clinic');
    if (clinic && sev > 0.35) o.push(spotOption(sim, a, 'rest', 1.3 + sev, `Ill (${Math.round(a.needs.health)})`, ['rest'], () => 'Resting at the clinic', 120));
    if (homed) o.push(spotOption(sim, a, 'rest', 1.05 + sev, `Ill (${Math.round(a.needs.health)})`, ['sleep'], () => 'In bed, feeling ill', 90, homeOnly));
  }
  // ---- family who are ill or frail get a visit
  if ((stage === 'adult' || stage === 'elder') && !sick && !sleepTime) {
    const who = needsCare(sim, a);
    // Someone at home who's seriously ill is worth taking time off work for.
    if (who && (!workTime || (who.household === a.household && (who.illness?.severity ?? 0) > 0.5))) {
      const sev = who.illness?.severity ?? 0;
      const score = 0.62 + sev * 0.6 + (who.household === a.household ? 0.15 : 0);
      o.push({
        kind: 'care', score, reason: `${first(who)} needs looking after`,
        begin: () => {
          const room = sim.roomOf(who);
          const cell = room ? randomCellIn(sim, room.x, room.y, room.w, room.h) : who.at;
          if (cell < 0) return false;
          const path = cell === a.at ? [] : sim.nav.findPath(a.at, cell, 40000);
          if (!path) return false;
          return start(sim, a, 'care', `Looking after ${first(who)}`, `${first(who)} needs looking after`, { cell, path, cost: path.length }, 30, score, { partnerId: who.id });
        },
      });
    }
  }

  // ---- school
  if (schoolTime && !sick) {
    o.push(spotOption(sim, a, 'learn', 1.15, 'School day', ['learn'], () => 'In class at school', sim.rng.range(60, 120)));
  }

  // ---- meetings and parties
  if (sim.events.standup && office && workTime) {
    o.push(spotOption(sim, a, 'meet', 1.3, 'Daily standup', ['meet'], () => 'In the standup meeting', 9999));
  }
  if (sim.events.party && office && !sleepTime) {
    o.push(spotOption(sim, a, 'party', 1.0 + (a.traits.includes('extrovert') ? 0.2 : 0) - (a.traits.includes('introvert') ? 0.35 : 0), 'Office party', ['sit', 'play', 'music'], () => 'At the office party', 9999, (p) => roomKind(sim, p) === 'lounge' || roomKind(sim, p) === 'kitchen'));
  }
  if (sim.events.festival && !sleepTime && stage !== 'toddler') {
    o.push(areaOption(sim, a, 'party', 1.15 + (a.traits.includes('extrovert') ? 0.2 : 0) - (a.traits.includes('introvert') ? 0.25 : 0), 'Town festival', `At the ${(sim.events.festival.name ?? 'town festival').toLowerCase()}`, PARK, 9999));
  }
  for (const b of sim.events.birthdays) {
    const host = sim.agent(b.host);
    if (!host) continue;
    const isHost = host.id === a.id;
    const kin = !isHost && !!kinship(sim, a, host);
    const friend = !isHost && b.milestone && (a.relations.get(host.id)?.opinion ?? 0) >= FRIEND;
    if (!isHost && !kin && !friend) continue;
    if (sleepTime && a.household !== b.household) continue;
    const room = sim.map.rooms[sim.town.households[b.household].room];
    o.push(areaOption(sim, a, 'party', isHost ? 1.4 : kin ? 1.2 : 0.95, `Birthday: ${first(host)}`, isHost ? 'Celebrating my birthday' : `At ${first(host)}'s birthday`, room, 9999, { partnerId: host.id }));
  }
  // Join whoever in the family is already sitting down to dinner at home.
  if (homed && loc === 'home' && inWindow(h, 17.5, 20.5) && n.hunger < 92 && stage !== 'toddler' && !a.mealReady && pantry >= 0.5 && a.action.kind !== 'eat') {
    const homeRoom = sim.town.households[a.household].room;
    const eating = sim.agents.some((x) => x.id !== a.id && x.household === a.household && x.action.kind === 'eat' && x.action.stage === 'perform' && sim.roomOf(x)?.id === homeRoom);
    if (eating) {
      o.push(spotOption(sim, a, 'eat', 1.05, 'Family dinner', ['eat'], () => 'Family dinner', 20, homeOnly, () => {
        if (sim.pantry[a.household] < 0.5) return false;
        sim.pantry[a.household] -= 0.5;
      }));
    }
  }
  // Family visit their graves now and then; fresh grief makes it urgent, and a visit eases it.
  if (!sleepTime && !workTime && !schoolTime && !evening && stage !== 'toddler') {
    for (const grave of sim.map.props) {
      if (grave.key !== 'grave' || grave.about === undefined) continue;
      if (a.memories.some((x) => x.kind === 'paidRespects' && x.about === grave.about)) continue;
      const dead = sim.person(grave.about);
      const grief = a.memories.find((m) => m.kind === 'grief' && m.about === grave.about);
      if (!dead || (!grief && !kinship(sim, a, dead))) continue;
      if (!sim.map.walkable(grave.x, grave.y + 1)) continue;
      const name = first(dead);
      const score = grief ? 0.45 - grief.mood / 50 : 0.38;
      o.push({
        kind: 'mourn', score, reason: `Misses ${name}`,
        begin: () => {
          const cell = sim.map.idx(grave.x, grave.y + 1);
          const path = cell === a.at ? [] : sim.nav.findPath(a.at, cell, 40000);
          if (!path) return false;
          return start(sim, a, 'mourn', `Visiting ${name}'s grave`, `Misses ${name}`, { cell, path, cost: path.length, facing: 'up' }, 25, score, { partnerId: dead.id });
        },
      });
      break;
    }
  }
  // Cold: back home to the fire, or into the café or library if there's no firewood.
  if (n.warmth < 60 && chill(sim) > 0 && !sim.roomOf(a) && stage !== 'toddler') {
    const fire = homed && sim.fuel[a.household] > 0;
    o.push(spotOption(sim, a, 'relax', (1 - n.warmth / 100) * 1.5 + (n.warmth < 35 ? 0.5 : 0), `Cold (${Math.round(n.warmth)})`, ['sit'], (p) => (p.household === a.household ? 'Warming up by the fire' : `Warming up ${where_(sim, p)}`), 30, (p) => (fire ? homeOnly(p) : ['cafe', 'library', 'lobby'].includes(roomKind(sim, p) ?? ''))));
  }
  // After dinner, a couple at home together goes out for a walk, side by side.
  if (chill(sim) < 0.5 && loc === 'home' && inWindow(h, 19.25, 21) && n.hunger > 50 && !sleepTime && n.energy > 40 && stage !== 'toddler' && !sim.events.rain && !a.memories.some((x) => x.kind === 'eveningWalk')) {
    const p = sim.agent(a.partner ?? undefined);
    if (p && sim.roomOf(p) === sim.roomOf(a) && ['idle', 'wander', 'relax', 'read'].includes(p.action.kind) && p.needs.energy > 40) {
      o.push(areaOption(sim, a, 'stroll', 0.75 + (n.fun < 60 ? 0.15 : 0), 'Evening walk', `Evening walk with ${first(p)}`, PARK, sim.rng.range(25, 40)));
    }
  }
  if (sim.events.coffeeBroken && office && workTime && (a.role === 'engineer' || a.role === 'receptionist')) {
    const coffee = sim.map.props.find((p) => p.use === 'coffee' && roomKind(sim, p) === 'kitchen');
    if (coffee) o.push(spotOption(sim, a, 'repair', 0.95, 'The coffee machine is broken', ['coffee'], () => 'Fixing the coffee machine', 20, (p) => p.id === coffee.id));
  }

  // ---- social
  if (n.social < 75 && stage !== 'toddler') {
    const mult = a.traits.includes('extrovert') ? 1.3 : a.traits.includes('introvert') ? 0.6 : 1;
    const base = Math.pow(1 - n.social / 100, 1.3) * 0.95 * mult;
    let best: { p: Agent; score: number } | null = null;
    for (const p of sim.agents) {
      if (p.id === a.id || stageOf(sim, p) === 'toddler') continue;
      const pk = p.action.kind;
      const available = pk === 'idle' || pk === 'wander' || pk === 'relax' || pk === 'coffee' || pk === 'stroll' || pk === 'play' && !p.action.propId || ((pk === 'eat' || pk === 'snack') && p.action.stage === 'perform');
      if (!available) continue;
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      if (d > 22) continue;
      const r = rel(a, p);
      const peers = little === (stageOf(sim, p) === 'child') ? 0.08 : 0;
      const kin = kinship(sim, a, p) ? 0.12 : 0;
      const pull = r.opinion <= RIVAL ? -0.35 : r.opinion / 220 + r.familiarity / 500 + peers + kin;
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
    const free = !workTime && !sleepTime && !schoolTime;
    if (stage === 'toddler') {
      o.push(areaOption(sim, a, 'play', x * 0.8 + 0.1, 'Playtime', 'Playing with toys', homeArea(sim, a), sim.rng.range(15, 30)));
    } else if (little) {
      o.push(spotOption(sim, a, 'play', (x * 0.9 + 0.15) * breakMult, `Bored (${Math.round(n.fun)})`, ['play'], () => 'Playing in the park', sim.rng.range(20, 40), (p) => roomKind(sim, p) !== 'lounge'));
      if (free && !evening && !sim.events.rain) o.push(areaOption(sim, a, 'play', x * 0.7 + 0.1, 'Wants to run around', 'Running around the park', PARK, sim.rng.range(20, 35)));
    }
    if (office && !sim.weekend && loc !== 'home' && stage === 'adult') {
      const waiting = sim.agents.some((p) => p.id !== a.id && p.action.kind === 'play' && p.action.stage === 'perform' && roomKind(sim, sim.prop(p.action.propId) ?? ({ room: -1 } as Prop)) === 'lounge');
      const s = (x * 0.85 + (a.traits.includes('competitive') ? 0.2 : 0) + (waiting ? 0.35 : 0)) * breakMult;
      o.push(spotOption(sim, a, 'play', s, waiting ? 'Someone wants a game' : `Bored (${Math.round(n.fun)})`, ['play'], () => 'Playing ping pong', 16, (p) => roomKind(sim, p) === 'lounge'));
      o.push(spotOption(sim, a, 'music', (x * 0.6 + a.skills.music.level * 0.04 + (a.traits.includes('creative') ? 0.15 : 0)) * breakMult, `Bored (${Math.round(n.fun)})`, ['music'], () => 'Playing the piano', 22));
    }
    if (stage !== 'toddler') {
      o.push(spotOption(sim, a, 'read', (x * 0.55 + (a.traits.includes('introvert') ? 0.15 : 0) + (a.traits.includes('creative') ? 0.1 : 0) + (stage === 'elder' ? 0.15 : 0)) * breakMult, `Bored (${Math.round(n.fun)})`, ['read'], (p) => `Reading ${where_(sim, p)}`, sim.rng.range(30, 50)));
      o.push(spotOption(sim, a, 'relax', (x * 0.5 + (1 - n.energy / 100) * 0.3 + (evening ? 0.15 : 0)) * breakMult, n.energy < 45 ? 'Needs a sit-down' : 'Unwinding', ['sit'], (p) => `Relaxing ${where_(sim, p)}`, sim.rng.range(20, 40), (p) => (evening ? homeOnly(p) : true)));
    }
    if (free && !evening && !sim.events.rain && !little && chill(sim) < 0.6) {
      o.push(areaOption(sim, a, 'stroll', x * 0.6 + (stage === 'elder' ? 0.2 : 0.1), 'Fresh air', 'Walking in the park', PARK, sim.rng.range(15, 30)));
    }
  }

  // ---- errands
  const housemateShopping = sim.agents.some((p) => p.id !== a.id && p.household === a.household && p.action.kind === 'shop');
  if (homed && pantry <= 1 && !housemateShopping && !workTime && !evening && sim.stock.food >= 6 && !little) {
    o.push(spotOption(sim, a, 'shop', 0.85, 'Fridge is empty', ['shop'], () => 'Shopping for groceries', 14));
  }

  // ---- go home at night / stay near home when small
  if ((evening || stage === 'toddler') && loc !== 'home' && homed) {
    o.push(spotOption(sim, a, 'relax', stage === 'toddler' ? 1.2 : 0.7, 'Heading home', ['sit'], () => 'Relaxing at home', 30, homeOnly));
  }
  o.push({
    kind: 'wander', score: 0.06, reason: 'Nothing pressing',
    begin: () => {
      const r = stage === 'toddler' ? homeArea(sim, a) : sim.roomOf(a) ?? { x: sim.map.cx(a.at) - 6, y: sim.map.cy(a.at) - 6, w: 12, h: 12 };
      const cell = randomCellIn(sim, r.x, r.y, r.w, r.h);
      if (cell < 0) return false;
      const path = sim.nav.findPath(a.at, cell);
      if (!path) return false;
      return start(sim, a, 'wander', 'Pottering around', 'Nothing pressing', { cell, path, cost: path.length }, sim.rng.range(4, 10), 0.06);
    },
  });
  return o;
}

function homeArea(sim: Sim, a: Agent): { x: number; y: number; w: number; h: number } {
  const room = sim.map.rooms[sim.town.households[a.household].room];
  return room ?? { x: sim.map.cx(a.at) - 3, y: sim.map.cy(a.at) - 3, w: 6, h: 6 };
}

function workOptions(sim: Sim, a: Agent, o: Option[], workTime: boolean, h: number): void {
  const n = a.needs;
  const role = ROLES[a.role];
  if (role.station === 'labor') {
    if (!workTime && !(a.carry && h > 6 && h < 21)) return;
    const mult = a.traits.includes('workaholic') ? 1.2 : a.traits.includes('slacker') ? 0.8 : 1;
    // Peek first so the score reflects whether there's real work out there.
    const plan = laborPlan(sim, a);
    if (!plan) return;
    const s = (0.7 + (100 - n.work) / 300) * mult * plan.score;
    o.push({
      kind: plan.kind, score: s, reason: plan.reason,
      begin: () => {
        const target: Target = { cell: plan.dest, path: plan.path, cost: plan.path.length };
        const prop = sim.prop(plan.propId);
        if (prop && sim.reserved.has(prop.id) && sim.reserved.get(prop.id) !== a.id && plan.kind !== 'deposit') return false;
        const ok = start(sim, a, plan.kind, plan.label, plan.reason, target, plan.timer, s, { propId: plan.propId, projectId: plan.projectId, leg: plan.leg, material: plan.material, household: plan.household });
        // Pick up a fresh set of tools on the way out, if the workshop has made any.
        if (ok && a.tool <= 0 && sim.stock.tools >= 1 && plan.kind !== 'deposit') {
          sim.stock.tools -= 1;
          a.tool = 1;
          think(sim, a, 'New tools. This will go quicker.', 'good');
        }
        if (plan.projectId !== undefined) sim.projects.find((p) => p.id === plan.projectId)?.builders.add(a.id);
        return ok;
      },
    });
    return;
  }
  if (a.deskId === null) return;
  if (!workTime && !(a.traits.includes('workaholic') && !sim.weekend && h > 7 && h < 21)) return;
  const task = a.task;
  const due = task?.due !== undefined && task.due - sim.time < 4 * 60;
  let s = workTime ? 0.72 + (100 - n.work) / 300 + (due ? 0.25 : 0) : 0.3;
  s *= a.traits.includes('workaholic') ? 1.2 : a.traits.includes('slacker') ? 0.8 : 1;
  const kind: ActionKind = a.role === 'teacher' ? 'teach' : 'work';
  const label = a.role === 'teacher' ? `Teaching: ${task?.title ?? 'class'}` : role.station === 'desk' ? `Working: ${task?.title ?? 'busywork'}` : role.station === 'reception' ? `At reception: ${task?.title ?? ''}` : `On shift: ${task?.title ?? ''}`;
  const reason = due ? 'Deadline coming up' : workTime ? 'Work hours' : 'Staying late';
  o.push({
    kind, score: s, reason,
    begin: () => {
      const t = findSpot(sim, a, [kind === 'teach' ? 'teach' : 'work'], (p) => p.id === a.deskId);
      if (!t) return false;
      return start(sim, a, kind, label, reason, t, sim.rng.range(50, 95), s);
    },
  });
}

function decide(sim: Sim, a: Agent, stage: Stage): void {
  // Off sick: down tools first, so staying put at work or school isn't even an option.
  if (offSick(a) && SICK_STOPS.includes(a.action.kind) && !(a.action.kind === 'haul' && a.action.leg === 'deliver')) finish(sim, a);
  a.thinkIn = 4 + sim.rng.range(0, 4);
  const opts = buildOptions(sim, a, stage).sort((x, y) => y.score - x.score);
  const cur = a.action;
  let currentScore = 0;
  if (cur.kind !== 'idle') {
    const same = opts.find((x) => x.kind === cur.kind);
    currentScore = (same ? same.score : cur.score * 0.8) + INERTIA;
    // Don't abandon things halfway through for marginal gains.
    if (cur.stage === 'perform' && ['sleep', 'eat', 'shower', 'toilet', 'socialize', 'cook', 'meet', 'play', 'repair', 'party', 'chop', 'mine', 'farm', 'learn'].includes(cur.kind)) currentScore += 0.6;
    if (cur.kind === 'haul' || cur.kind === 'deposit') currentScore += 1;
  }
  for (const opt of opts) {
    if (opt.score <= currentScore) return;
    if (opt.kind === cur.kind && cur.kind !== 'wander' && cur.kind !== 'idle') return;
    if (opt.begin()) {
      if (opt.kind !== 'wander' && opt.kind !== 'socialize') think(sim, a, thoughtFor(a, opt, stage), opt.score > 1.1 ? 'alert' : 'neutral');
      return;
    }
  }
}

function thoughtFor(a: Agent, o: Option, stage: Stage): string {
  switch (o.kind) {
    case 'work': return a.task ? `Back to "${a.task.title}".` : 'Time to get some work done.';
    case 'teach': return 'Class is starting. Where did I put my chalk?';
    case 'learn': return stage === 'child' ? 'School again. I hope we do science today.' : 'Learning something new.';
    case 'eat': return o.reason === 'Free pizza!' ? 'Someone said free pizza?' : `${o.reason}. ${a.action.label}.`;
    case 'cook': return `${o.reason}. I'll make something.`;
    case 'coffee': return o.reason === 'Morning coffee' ? 'Not human until I have coffee.' : 'Need a coffee to keep going.';
    case 'sleep': return o.reason === 'Bedtime' ? 'Long day. Off to bed.' : o.reason === 'No home to go to' ? 'No bed tonight. I will find a bench.' : 'I can barely keep my eyes open.';
    case 'toilet': return 'Quick restroom break.';
    case 'shower': return o.reason === 'Morning shower' ? 'Shower first, then the world.' : 'I really need a wash.';
    case 'play': return stage === 'adult' ? (o.reason === 'Someone wants a game' ? 'Someone is at the ping pong table. Game on.' : 'Ping pong break!') : 'Playtime!';
    case 'music': return 'I feel like playing something.';
    case 'read': return 'A few pages of my book.';
    case 'relax': return o.reason === 'Heading home' ? 'Heading home.' : 'Taking a breather.';
    case 'stroll': return 'A walk in the park sounds nice.';
    case 'shop': return 'We are out of food at home. Grocery run.';
    case 'meet': return 'Standup time.';
    case 'party':
      if (o.reason === `Birthday: ${first(a)}`) return "My birthday party! I wonder who'll come.";
      if (o.reason.startsWith('Birthday: ')) return `Off to ${o.reason.slice(10)}'s birthday.`;
      return o.reason === 'Town festival' ? 'The whole town is out for the festival!' : 'Party in the lounge!';
    case 'mourn': return `I'll go and sit with ${o.reason.slice(7)} for a while.`;
    case 'escort': return `I'll walk ${o.reason.split(' ')[0]} to school on my way.`;
    case 'repair': return 'I will take a look at that coffee machine.';
    case 'snack': return 'Just a quick snack.';
    case 'chop': return a.action.projectId !== undefined ? 'Clearing trees for the new build.' : 'The town needs timber. Off to the woods.';
    case 'mine': return a.action.projectId !== undefined ? 'These rocks have to go before we can build.' : 'Time to break some stone.';
    case 'haul': return `${o.reason}. I'll fetch it from the storehouse.`;
    case 'split': return 'Logs to split before the cold sets in.';
    case 'rest': return 'I need to lie down for a while.';
    case 'care': return `I'll go and see how ${o.reason.split(' ')[0]} is doing.`;
    case 'craft': return `${o.reason}. Off to the workshop.`;
    case 'stoke': return `${o.reason}. I'll bring them some firewood.`;
    case 'build': return `${a.action.label}. Let's get this up.`;
    case 'farm': return o.reason === 'The crop is ripe' ? 'The crop looks ready. Harvest time.' : 'Watering and weeding.';
    case 'deposit': return 'Dropping this off at the storehouse.';
    default: return o.reason;
  }
}

/** Needs urgent enough to interrupt anything except sleep. */
function urgent(sim: Sim, a: Agent): boolean {
  const k = a.action.kind;
  if (k === 'haul' && a.action.leg === 'deliver') return false;
  if (a.bladder < 12 && k !== 'toilet') return true;
  if (a.needs.hunger < 10 && k !== 'eat' && k !== 'cook' && k !== 'snack' && k !== 'sleep') return true;
  if (sim.events.standup && isOffice(a) && isWorkTime(sim, a) && k !== 'meet' && k !== 'toilet') return true;
  // Freezing outdoors: stop and go somewhere warm.
  if (a.needs.warmth < 20 && sim.map.room[a.at] < 0 && k !== 'relax' && chill(sim) > 0) return true;
  // Too ill to carry on: down tools and go lie down.
  if (offSick(a) && SICK_STOPS.includes(k)) return true;
  return false;
}

/** What someone off sick stops doing at once, whatever stage it's at. */
const SICK_STOPS: ActionKind[] = ['work', 'teach', 'learn', 'build', 'chop', 'mine', 'farm', 'haul', 'split', 'stoke', 'craft', 'meet'];

// ------------------------------------------------------------------ performing

function arrive(sim: Sim, a: Agent): void {
  const act = a.action;
  act.stage = 'perform';
  a.walkWith = undefined;
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
      if (sim.roomOf(a)?.kind === 'cafe') spend(sim, a, 3);
      break;
    case 'eat': {
      // Kitchens, the café and diners serve from the town's stores.
      const k = sim.roomOf(a)?.kind;
      if (!a.mealReady && (k === 'kitchen' || k === 'cafe')) {
        if (sim.stock.food < 1) {
          think(sim, a, 'They are out of food. The whole town is.', 'bad');
          return finish(sim, a);
        }
        sim.stock.food -= 1;
      }
      break;
    }
    case 'socialize': {
      const p = sim.agent(act.partnerId);
      if (p && p.action.kind === 'socialize' && p.action.partnerId === a.id) {
        p.action.timer = act.timer + 3;
        p.action.label = `Talking with ${first(a)}`;
      }
      break;
    }
    case 'party':
      if (a.action.partnerId !== undefined) sim.events.birthdays.find((b) => b.host === a.action.partnerId)?.guests.add(a.id);
      else (sim.events.party ?? sim.events.festival)?.attendees.add(a.id);
      break;
    case 'meet':
      sim.events.standup?.attendees.add(a.id);
      break;
    case 'deposit':
      if (a.carry) {
        sim.stock[a.carry.kind] += a.carry.amount;
        if (a.carry.amount >= 6 && sim.rng.chance(0.06)) sim.log(`${first(a)} brought ${Math.round(a.carry.amount)} ${a.carry.kind} to the storehouse`, 'build', 'neutral', a);
        a.carry = null;
      }
      return finish(sim, a);
    case 'haul':
      return arriveHaul(sim, a);
    case 'stoke':
      return arriveStoke(sim, a);
  }
}

function arriveHaul(sim: Sim, a: Agent): void {
  const act = a.action;
  const pr = sim.projects.find((p) => p.id === act.projectId);
  const mat = act.material!;
  if (!pr) {
    // Project finished or gone; anything in hand goes back to the store.
    return finish(sim, a);
  }
  if (act.leg === 'pickup') {
    const take = Math.min(CARRY, Math.floor(sim.stock[mat]), Math.ceil(shortOf(pr, mat)));
    if (take <= 0) return finish(sim, a);
    sim.stock[mat] -= take;
    a.carry = { kind: mat, amount: take };
    // Second leg: walk it to the site.
    const m = sim.map;
    let best: number[] | null = null;
    let dest = -1;
    for (let y = pr.y; y < pr.y + pr.h && !best; y++) for (let x = pr.x; x < pr.x + pr.w; x++) {
      const edge = x === pr.x || y === pr.y || x === pr.x + pr.w - 1 || y === pr.y + pr.h - 1;
      if (!edge || !m.walkable(x, y)) continue;
      const path = sim.nav.findPath(a.at, m.idx(x, y), 40000);
      if (path) {
        best = path;
        dest = m.idx(x, y);
        break;
      }
    }
    if (!best) return finish(sim, a);
    act.leg = 'deliver';
    act.label = `Carrying ${mat} to ${pr.name}`;
    act.dest = dest;
    act.stage = 'travel';
    a.path = best;
    a.pathPos = 0;
    a.edgeT = 0;
    return;
  }
  if (a.carry) {
    pr.delivered[mat] = (pr.delivered[mat] ?? 0) + a.carry.amount;
    a.carry = null;
  }
  finish(sim, a);
}

function others(sim: Sim, a: Agent, kinds: ActionKind[], radius: number): Agent[] {
  return sim.agents.filter((o) => o.id !== a.id && kinds.includes(o.action.kind) && o.action.stage === 'perform' && Math.abs(o.x - a.x) <= radius && Math.abs(o.y - a.y) <= radius && sim.roomOf(o) === sim.roomOf(a));
}

function perform(sim: Sim, a: Agent, dt: number, stage: Stage): void {
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
      for (const o of sim.agents) if (o.id === a.partner && o.action.kind === 'stroll' && Math.hypot(o.x - a.x, o.y - a.y) < 4) bondNearby(sim, a, o, dt);
      if (sim.events.rain && !hasUmbrella(a)) {
        addMemory(sim, a, 'soaked');
        think(sim, a, 'And now it is raining. Great.', 'bad');
        return finish(sim, a);
      }
      if (tick()) finish(sim, a);
      return;
    case 'work':
    case 'teach':
      return performWork(sim, a, dt, tick);
    case 'learn': {
      n.fun = Math.min(100, n.fun + 0.1 * dt);
      n.social = Math.min(100, n.social + socialGain(a, 0.15) * dt);
      gainXp(sim, a, sim.rng.pick(SKILL_KEYS), dt * 0.4);
      // Each minute of lessons builds an aptitude; a teacher at the board makes it count for more.
      if (Math.floor(sim.time) !== Math.floor(sim.time - dt)) {
        const k = lessonAptitude(sim, a);
        const taught = sim.agents.some((t) => t.role === 'teacher' && t.action.kind === 'teach' && t.action.stage === 'perform');
        a.aptitude[k] = Math.min(100, a.aptitude[k] + (taught ? 0.075 : 0.05));
      }
      for (const o of others(sim, a, ['learn'], 6)) bondNearby(sim, a, o, dt);
      if (tick() || !inWindow(sim.hour, 8.5, 15)) {
        addMemory(sim, a, 'school');
        finish(sim, a);
      }
      return;
    }
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
        const family = where(sim, a) === 'home' && company.some((x) => x.household === a.household);
        addMemory(sim, a, family ? 'familyDinner' : company.length ? 'sharedMeal' : 'ateAlone');
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
        if (sim.pantry[a.household] < 1) {
          think(sim, a, 'The cupboards are bare.', 'bad');
          return finish(sim, a);
        }
        sim.pantry[a.household] -= 1;
        // One pot feeds whoever in the family is home and hungry.
        a.mealReady = true;
        for (const o of sim.agents) if (o.household === a.household && o.id !== a.id && o.needs.hunger < 70 && sim.roomOf(o) === sim.roomOf(a)) o.mealReady = true;
        say(sim, a, '♨', 'good');
        finish(sim, a);
      }
      return;
    case 'sleep': {
      n.energy = Math.min(100, n.energy + (stage === 'toddler' ? 0.3 : 0.21) * dt);
      const wakeTime = !isSleepTime(sim, a);
      if (wakeTime && (n.energy > 70 || (stage === 'toddler' && n.energy > 55))) {
        addMemory(sim, a, n.energy > 85 ? 'sleptWell' : 'badNight');
        if (stage !== 'toddler') think(sim, a, n.energy > 85 ? 'Good morning! Slept like a log.' : 'Did I even sleep?', n.energy > 85 ? 'good' : 'bad');
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
      if (stage !== 'adult') {
        n.fun = Math.min(100, n.fun + 1.1 * dt);
        n.energy = Math.max(0, n.energy - 0.03 * dt);
        for (const o of others(sim, a, ['play'], 5)) {
          bondNearby(sim, a, o, dt);
          n.social = Math.min(100, n.social + socialGain(a, 0.2) * dt);
        }
        gainXp(sim, a, 'athletics', dt * 0.2);
        if (tick()) finish(sim, a);
        return;
      }
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
        // Groceries at today's price; short of money, family chips in, or the basket stays light.
        const unit = price(sim, 'food');
        if (a.money < unit * 3) askFamilyForHelp(sim, a, Math.ceil(unit * 5));
        const buy = Math.min(6, Math.floor(sim.stock.food), Math.floor(a.money / unit));
        if (buy > 0) {
          spend(sim, a, buy * unit);
          sim.stock.food -= buy;
          sim.pantry[a.household] += buy;
          sim.log(`${first(a)} bought groceries ($${(buy * unit).toFixed(0)})`, 'life', 'neutral', a);
        } else if (sim.stock.food < 1) {
          sim.log(`${first(a)} found the market shelves empty`, 'life', 'bad', a);
        } else {
          addMemory(sim, a, 'broke');
          think(sim, a, "I can't afford groceries this week.", 'bad');
          sim.log(`${first(a)} couldn't afford groceries`, 'life', 'bad', a);
        }
        finish(sim, a);
      }
      return;
    case 'party': {
      const festival = !!sim.events.festival;
      n.fun = Math.min(100, n.fun + 0.9 * dt);
      n.social = Math.min(100, n.social + socialGain(a, 0.7) * dt);
      n.hunger = Math.min(100, n.hunger + 0.6 * dt);
      for (const o of sim.agents) if (o.id !== a.id && o.action.kind === 'party' && Math.abs(o.x - a.x) < 6 && Math.abs(o.y - a.y) < 6) bondNearby(sim, a, o, dt * 2);
      if (sim.rng.chance(0.02 * dt)) say(sim, a, sim.rng.pick(['woo!', '♪', 'ha!', 'cheers']), 'good', 3);
      const bday = act.partnerId !== undefined ? sim.events.birthdays.find((b) => b.host === act.partnerId) : undefined;
      if (act.partnerId !== undefined ? !bday : !sim.events.party && !festival) finish(sim, a);
      else if (bday && sim.rng.chance(0.015 * dt)) say(sim, a, a.id === bday.host ? 'thank you!' : sim.rng.pick(['happy birthday!', '♪', 'cake!']), 'good', 3);
      return;
    }
    case 'escort': {
      const kid = sim.agent(act.partnerId);
      if (kid) say(sim, a, sim.rng.pick(['have a good day!', 'be good!', 'see you later!']), 'good', 3);
      if (kid) think(sim, a, `Dropped ${first(kid)} at school.`, 'good');
      return finish(sim, a);
    }
    case 'rest': {
      n.energy = Math.min(100, n.energy + 0.25 * dt);
      const ill = a.illness;
      if (ill && sim.roomOf(a)?.kind === 'clinic') {
        // Seen by the doctor if they're in; medicine if the clinic has any.
        const doc = sim.agents.find((d) => d.role === 'doctor' && d.action.kind === 'work' && d.action.stage === 'perform' && sim.roomOf(d)?.kind === 'clinic');
        if (doc && !ill.treated) {
          ill.treated = true;
          if (!ill.medicine && sim.stock.medicine >= 1) {
            sim.stock.medicine -= 1;
            ill.medicine = true;
          }
          think(sim, a, `${first(doc)} says I'll be fine${ill.medicine ? ' with this medicine' : ''}.`, 'good');
          sim.log(`Dr. ${first(doc)} treated ${first(a)}${ill.medicine ? ' with medicine' : ''}`, 'life', 'good', doc, a);
        }
      }
      if (!ill || tick()) finish(sim, a);
      return;
    }
    case 'care': {
      const who = sim.agent(act.partnerId);
      if (!who) return finish(sim, a);
      a.facing = faceToward(a, who);
      bondNearby(sim, a, who, dt);
      if (sim.rng.chance(0.01 * dt)) say(sim, a, who.illness ? 'get well soon' : 'how are you feeling?', 'good', 3);
      if (tick()) {
        if (who.illness) who.illness.caredUntil = sim.time + 240;
        addMemory(sim, who, 'caredFor', a);
        addMemory(sim, a, 'lookedAfter', who);
        think(sim, who, `${first(a)} came to look after me.`, 'good');
        finish(sim, a);
      }
      return;
    }
    case 'mourn': {
      a.facing = 'up';
      if (sim.rng.chance(0.01 * dt)) say(sim, a, '…', 'neutral', 3);
      if (tick()) {
        const dead = sim.person(act.partnerId);
        const grief = a.memories.find((m) => m.kind === 'grief' && m.about === act.partnerId);
        if (grief) grief.mood = Math.round(grief.mood * 0.6);
        if (dead) {
          addMemory(sim, a, 'paidRespects', dead);
          think(sim, a, `I miss you, ${first(dead)}.`, 'neutral');
        }
        finish(sim, a);
      }
      return;
    }
    case 'repair':
      gainXp(sim, a, 'craft', dt * 0.2);
      if (tick()) {
        if (sim.events.coffeeBroken) {
          sim.events.coffeeBroken = false;
          sim.log(`${first(a)} fixed the coffee machine`, 'event', 'good', a);
          for (const o of sim.agents) if (isOffice(o) && o.id !== a.id) shiftOpinion(sim, o, a, 3);
          think(sim, a, 'Fixed it. You are welcome, everyone.', 'good');
          say(sim, a, '☕', 'good');
        }
        finish(sim, a);
      }
      return;
    case 'chop':
    case 'mine':
      return performGather(sim, a, dt, tick);
    case 'build':
      return performBuild(sim, a, dt, tick);
    case 'farm':
      return performFarm(sim, a, dt, tick);
    case 'split':
      gainXp(sim, a, 'craft', dt * 0.2);
      a.workedToday += dt;
      payWage(sim, a, 0.3 * dt);
      a.needs.work = Math.min(100, a.needs.work + 0.4 * dt);
      if (Math.floor(sim.time * 2) % 4 === 0) say(sim, a, 'thwack', 'neutral', 1);
      act.timer -= dt * (laborRate(a) - 1);
      if (tick()) {
        if (sim.stock.wood >= 4) {
          sim.stock.wood -= 4;
          sim.stock.firewood += 6;
        }
        finish(sim, a);
      }
      return;
    case 'craft': {
      const r = RECIPES.find((x) => x.good === act.material && x.station === STATION_OF[sim.prop(act.propId)?.key ?? '']);
      if (!r) return finish(sim, a);
      a.workedToday += dt;
      payWage(sim, a, 0.35 * dt);
      n.work = Math.min(100, n.work + 0.45 * dt);
      gainXp(sim, a, 'craft', dt * 0.3);
      act.timer -= dt * (laborRate(a) - 1);
      if (sim.rng.chance(0.015 * dt)) say(sim, a, r.station === 'saw' ? 'bzzzt' : r.station === 'kiln' ? 'fwoosh' : 'tap tap', 'neutral', 1.5);
      if (tick()) {
        if (canMake(sim, r)) {
          for (const [g, q] of Object.entries(r.inputs)) sim.stock[g as keyof typeof sim.stock] -= q!;
          // A skilled hand gets a little more out of the same material.
          sim.stock[r.good] += r.out + (sim.rng.chance(a.skills.craft.level * 0.03) ? 1 : 0);
          if (sim.rng.chance(0.3)) addMemory(sim, a, 'madeSomething');
          if (r.good === 'furniture' && sim.rng.chance(0.4)) sim.log(`${first(a)} finished a new piece of furniture`, 'work', 'good', a);
        }
        finish(sim, a);
      }
      return;
    }
    case 'deposit':
    case 'haul':
    case 'stoke':
      return finish(sim, a);
  }
}

/** Firewood run: load up at the storehouse, then stack it by a home's hearth. */
function arriveStoke(sim: Sim, a: Agent): void {
  const act = a.action;
  const hh = act.household !== undefined ? sim.town.households[act.household] : undefined;
  if (!hh || hh.building < 0) return finish(sim, a);
  if (act.leg === 'pickup') {
    const take = Math.min(6, Math.floor(sim.stock.firewood), Math.ceil(HEARTH_FULL - sim.fuel[hh.id]));
    if (take <= 0) return finish(sim, a);
    sim.stock.firewood -= take;
    a.carry = { kind: 'firewood', amount: take };
    const dest = sim.map.idx(hh.door.x, hh.door.y);
    const path = sim.nav.findPath(a.at, dest, 40000);
    if (!path) {
      sim.stock.firewood += take;
      a.carry = null;
      return finish(sim, a);
    }
    act.leg = 'deliver';
    act.label = `Carrying firewood to the ${hh.name}`;
    act.dest = dest;
    act.stage = 'travel';
    a.path = path;
    a.pathPos = 0;
    a.edgeT = 0;
    return;
  }
  if (a.carry?.kind === 'firewood') {
    sim.fuel[hh.id] += a.carry.amount;
    a.carry = null;
    for (const o of sim.agents) if (o.household === hh.id && o.id !== a.id && o.relations.has(a.id)) shiftOpinion(sim, o, a, 0.5);
  }
  finish(sim, a);
}

/** How fast someone gets through physical work: skill, tools, energy and temperament. */
export function laborRate(a: Agent): number {
  return (a.tool > 0 ? 1.25 : 1) * (0.55 + a.skills.craft.level * 0.07) * (a.needs.energy < 20 ? 0.6 : 1) * (a.traits.includes('workaholic') ? 1.15 : a.traits.includes('slacker') ? 0.8 : 1);
}

function performGather(sim: Sim, a: Agent, dt: number, tick: () => boolean): void {
  const act = a.action;
  const p = sim.prop(act.propId);
  if (!p) return finish(sim, a);
  if (sim.rng.chance(0.00008 * dt)) {
    fallIll(sim, a, 'injury', act.kind === 'chop' ? 'an axe slipped' : 'a rock fell');
    return finish(sim, a);
  }
  a.workedToday += dt;
  payWage(sim, a, 0.3 * dt);
  a.needs.work = Math.min(100, a.needs.work + 0.4 * dt);
  gainXp(sim, a, 'craft', dt * 0.3);
  if (Math.floor(sim.time * 3) % 5 === 0) say(sim, a, act.kind === 'chop' ? 'thunk' : 'clink', 'neutral', 1);
  act.timer -= dt * (laborRate(a) - 1);
  if (!tick()) return;
  const kind = p.resource!;
  let amount = p.amount ?? 6;
  sim.map.removeProp(p);
  if (kind === 'wood') sim.map.addProp({ key: 'stump', drawn: true, x: p.x, y: p.y, w: 1, h: 1, blocks: false, flat: true, expires: sim.time + MIN_PER_DAY });
  const pr = sim.projects.find((x) => x.id === act.projectId);
  if (pr) {
    // Cleared timber and stone go straight into the build; any surplus heads to the store.
    const use = Math.min(amount, shortOf(pr, kind));
    pr.delivered[kind] = (pr.delivered[kind] ?? 0) + use;
    amount -= use;
  }
  if (amount > 0) a.carry = { kind, amount: (a.carry?.kind === kind ? a.carry.amount : 0) + amount };
  finish(sim, a);
}

function performBuild(sim: Sim, a: Agent, dt: number, tick: () => boolean): void {
  const pr = sim.projects.find((x) => x.id === a.action.projectId);
  if (!pr) return finish(sim, a);
  pr.builders.add(a.id);
  const cap = buildCap(pr);
  if (pr.progress >= cap - 0.01 && pr.progress < pr.work) {
    think(sim, a, `We're out of materials for ${pr.name}.`, 'neutral');
    return finish(sim, a);
  }
  pr.progress = Math.min(cap, pr.progress + laborRate(a) * dt);
  a.workedToday += dt;
  payWage(sim, a, 0.35 * dt);
  a.needs.work = Math.min(100, a.needs.work + 0.45 * dt);
  gainXp(sim, a, 'craft', dt * 0.3);
  if (sim.rng.chance(0.02 * dt)) say(sim, a, sim.rng.pick(['tap tap', 'bonk', 'nearly!']), 'neutral', 1.5);
  for (const id of pr.builders) {
    const o = sim.agent(id);
    if (o && o.id !== a.id) bondNearby(sim, a, o, dt * 0.5);
  }
  if (pr.progress >= pr.work - 0.01 && supplied(pr)) {
    completeProject(sim, pr);
    think(sim, a, `${pr.name} is done. I helped build that.`, 'good');
    return finish(sim, a);
  }
  if (tick() || !isWorkTime(sim, a)) finish(sim, a);
}

function performFarm(sim: Sim, a: Agent, dt: number, tick: () => boolean): void {
  const p = sim.prop(a.action.propId);
  if (!p) return finish(sim, a);
  a.workedToday += dt;
  payWage(sim, a, 0.3 * dt);
  a.needs.work = Math.min(100, a.needs.work + 0.4 * dt);
  gainXp(sim, a, 'craft', dt * 0.3);
  if (!tick()) return;
  if ((p.growth ?? 0) >= 1) {
    p.growth = 0;
    const amount = (a.carry?.kind === 'food' ? a.carry.amount : 0) + FOOD_PER_CROP * (1 + a.skills.craft.level * 0.04);
    a.carry = { kind: 'food', amount };
    if (amount >= 8) addMemory(sim, a, 'harvest');
    if (sim.rng.chance(0.15)) sim.stock.herbs += 1;
  } else {
    p.growth = Math.min(1, (p.growth ?? 0) + 0.06 + a.skills.craft.level * 0.006);
  }
  finish(sim, a);
  // Keep harvesting until the basket is full, then take it in.
  if (a.carry && a.carry.amount < 8) a.thinkIn = 0;
}

function performWork(sim: Sim, a: Agent, dt: number, tick: () => boolean): void {
  const n = a.needs;
  if (a.role === 'doctor' && sim.stock.herbs >= 2 && Math.floor(sim.time / 45) !== Math.floor((sim.time - dt) / 45)) {
    sim.stock.herbs -= 2;
    sim.stock.medicine += 1;
  }
  if (!a.task) a.task = newTask(sim, a);
  const t = a.task;
  if (t) {
    const moodF = 0.6 + a.mood / 125;
    const energyF = n.energy < 20 ? 0.6 : 1;
    const traitF = a.traits.includes('workaholic') ? 1.15 : a.traits.includes('slacker') ? 0.75 : 1;
    t.progress += (0.45 + a.skills.craft.level * 0.06) * moodF * energyF * traitF * dt;
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
      if (a.task) a.action.label = a.action.label.replace(/: .*$/, `: ${a.task.title}`);
    }
  }
  a.workedToday += dt;
  payWage(sim, a, 0.4 * dt);
  n.work = Math.min(100, n.work + 0.45 * dt);
  gainXp(sim, a, 'craft', dt * 0.3);
  if (a.role === 'teacher') for (const k of others(sim, a, ['learn'], 8)) gainXp(sim, k, sim.rng.pick(SKILL_KEYS), dt * 0.2);
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
  const partner = sim.agents.find((o) => o.id !== a.id && o.action.kind === 'play' && o.action.stage === 'perform' && stageOf(sim, o) === 'adult' && sim.roomOf(o)?.kind === 'lounge');
  n.energy = Math.max(0, n.energy - 0.05 * dt);
  if (!partner) {
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

const ROAD = new Set(['asphalt', 'laneH', 'laneV', 'crossH', 'crossV']);

function carApproaching(sim: Sim, x: number, y: number): boolean {
  if (!ROAD.has(sim.map.ground[sim.map.idx(x, y)])) return false;
  // Cars already stopped for us are no threat; moving ones are.
  return sim.cars.some((c) => c.speed > 2 && laneThreat(c, x + 0.5, y + 0.5));
}

function move(sim: Sim, a: Agent, dt: number, stage: Stage): void {
  const m = sim.map;
  const speed = stage === 'elder' ? 0.75 : stage === 'toddler' ? 0.6 : stage === 'child' ? 0.95 : 1;
  let budget = WALK_SPEED * dt * speed * (a.needs.energy < 15 ? 0.7 : 1) * (a.carry ? 0.85 : 1);
  // Walking together: whoever gets ahead slows down for the other.
  const mate = a.walkWith !== undefined ? sim.agent(a.walkWith) : undefined;
  if (mate && mate.walkWith === a.id && mate.action.stage === 'travel') {
    const ahead = a.path.length - a.pathPos < mate.path.length - mate.pathPos;
    const gap = Math.hypot(mate.x - a.x, mate.y - a.y);
    if (ahead && gap > 1.2) budget *= gap > 3 ? 0.1 : 0.5;
  } else if (a.walkWith !== undefined && (!mate || mate.walkWith !== a.id)) a.walkWith = undefined;
  // Out in the rain without an umbrella: hurry, and get soaked anyway.
  if (sim.events.rain && m.room[a.at] < 0 && !hasUmbrella(a)) {
    budget *= 1.3;
    if (!a.memories.some((x) => x.kind === 'soaked')) {
      addMemory(sim, a, 'soaked');
      think(sim, a, 'No umbrella, of course. Soaked.', 'bad');
    }
  }
  a.moving = true;
  while (budget > 0 && a.pathPos < a.path.length) {
    const next = a.path[a.pathPos];
    if (!m.walkable(m.cx(next), m.cy(next)) && next !== a.action.dest) {
      // Something moved into the way (a tree grew, a wall went up); re-plan.
      const p = sim.nav.findPath(a.at, a.action.dest, 40000);
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
      m.step(next);
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

export function tickAgents(sim: Sim, dt: number): void {
  for (const a of sim.agents) {
    a.px = a.x;
    a.py = a.y;
    const stage = stageOf(sim, a);
    updateNeeds(sim, a, dt, stage);
    a.thinkIn -= dt;
    const asleep = a.action.kind === 'sleep' && a.action.stage === 'perform';
    if (a.action.kind === 'idle' || (a.thinkIn <= 0 && !asleep) || (urgent(sim, a) && !asleep)) decide(sim, a, stage);
    if (a.action.stage === 'travel') move(sim, a, dt, stage);
    else {
      a.moving = false;
      perform(sim, a, dt, stage);
    }
  }
}

