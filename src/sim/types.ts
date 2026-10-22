import type { Outfit } from '../assets/loader';
import type { Facing } from '../assets/manifest';
import type { UseKind } from '../world/map';
import type { Bill, Good, MemoryKind, NeedKey, RoleKey, SkillKey, TraitKey } from './defs';

export type Tone = 'neutral' | 'good' | 'bad' | 'alert';

export interface Memory {
  kind: MemoryKind;
  label: string;
  mood: number;
  created: number;
  expires: number;
  about?: number;
  major: boolean;
}

export interface Relation {
  opinion: number;
  familiarity: number;
  lastTalk: number;
}

export interface Thought {
  t: number;
  text: string;
  tone: Tone;
}

export type ActionKind =
  | 'idle' | 'wander' | 'stroll' | 'work' | 'meet' | 'eat' | 'snack' | 'coffee' | 'cook'
  | 'sleep' | 'toilet' | 'shower' | 'socialize' | 'play' | 'music' | 'read' | 'relax' | 'shop' | 'party' | 'repair'
  | 'chop' | 'mine' | 'haul' | 'build' | 'farm' | 'deposit' | 'learn' | 'teach' | 'mourn' | 'escort' | 'split' | 'stoke' | 'craft' | 'rest' | 'care' | 'pave' | 'fish';

export interface Action {
  kind: ActionKind;
  /** Short present-tense description for the tracker ("Coding at desk"). */
  label: string;
  /** Why they chose it, for the inspector ("Hungry (31)"). */
  reason: string;
  stage: 'travel' | 'perform';
  dest: number;
  facing?: Facing;
  propId?: number;
  partnerId?: number;
  initiator?: boolean;
  timer: number;
  started: number;
  score: number;
  /** Construction project this action serves. */
  projectId?: number;
  /** Haul: 'pickup' at the storehouse, then 'deliver' at the site. */
  leg?: 'pickup' | 'deliver';
  material?: Good;
  /** Firewood delivery: the household it's for. */
  household?: number;
}

export interface Task {
  title: string;
  progress: number;
  total: number;
  /** Game minute it is due, or undefined for open-ended service work. */
  due?: number;
  started: number;
}

export interface Skill {
  level: number;
  xp: number;
}

export interface Schedule {
  wake: number;
  sleep: number;
  workStart: number;
  workEnd: number;
  lunch: number;
}

export interface Agent {
  id: number;
  name: string;
  age: number;
  role: RoleKey;
  household: number;
  traits: TraitKey[];
  outfit: Outfit;
  schedule: Schedule;

  /** Position in tile units (x,y = cell top-left of the feet). */
  x: number;
  y: number;
  px: number;
  py: number;
  at: number;
  path: number[];
  pathPos: number;
  edgeT: number;
  facing: Facing;
  moving: boolean;

  needs: Record<NeedKey, number>;
  mood: number;
  skills: Record<SkillKey, Skill>;
  relations: Map<number, Relation>;
  memories: Memory[];
  thoughts: Thought[];
  action: Action;
  thinkIn: number;
  task: Task | null;
  tasksDone: number;
  money: number;
  deskId: number | null;
  bubble: { text: string; until: number; tone: Tone } | null;
  /** Minutes worked today, reset at midnight. */
  workedToday: number;
  /** Hidden need that drives restroom trips. */
  bladder: number;
  /** Just cooked at home; wants to sit down and eat it. */
  mealReady: boolean;
  /** Day index of the last coffee, for the morning-coffee habit. */
  coffeeDay: number;
  /** Game minute a cook last found the cupboard bare, so they eat out or shop instead of retrying. */
  bareAt?: number;
  /** Game minute of the last near-miss with a car, to avoid repeat scares. */
  lastScare: number;

  /** Game minute they were born (may be negative for the founders). */
  birth: number;
  partner: number | null;
  parents: number[];
  children: number[];
  /** What they're carrying back to the storehouse or to a build site. */
  carry: { kind: Good; amount: number } | null;
  /** Building they work at, for teacher/cook roles. */
  workBuilding: number | null;
  /** Calendar year of their last birthday party. */
  lastBirthday: number;
  /** The late grandparent they were named after. */
  namedAfter?: number;
  /** Someone they're walking alongside (a partner on a stroll, a parent on the school run). */
  walkWith?: number;
  /** Wear left on their tools, 0..1; working with tools is faster. */
  tool: number;
  /** Leanings built up at school and play, 0..100 each, that shape their career. */
  aptitude: Record<import('./careers').Aptitude, number>;
  /** The trade they chose when they came of age. */
  career?: RoleKey;
  /** Who they're apprenticed to, and until when. */
  mentor?: number;
  apprenticeUntil?: number;
  illness?: import('./health').Illness;
  /** Over a cold or flu recently: can't catch one again until then. */
  immuneUntil?: number;
  /** What past illnesses have taken out of them, added to age-related frailty. */
  wear: number;
  /** When the town heard they were growing frail. Old age only takes those the family saw coming. */
  frailSince?: number;
  /** When they last changed jobs (unset: since before anyone kept track). */
  roleSince?: number;
  /** Courting or engaged to someone; cleared at the wedding, when partner is set. */
  court?: import('./rites').Courtship;
  /** The one thing they most want out of life. */
  dream?: import('./aspirations').Dream;
  /** Lifetime counts (buildings helped raise, festivals danced at). */
  deeds?: import('./aspirations').Deeds;
  /** Game minute they died, for the chronicle. */
  diedAt?: number;
  /** Who they left behind, written down when they died so the obituary doesn't change as others pass on. */
  survivors?: string[];
  /** When they died, and whether they were mayor then; set only for the dead. */
  died?: { at: number; mayor: boolean };
}

export interface Project {
  id: number;
  blueprint: import('../world/blueprints').BlueprintKey;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  doorTop: boolean;
  /** Grass cells that become a dirt path from the door to the street on completion. */
  path: number[];
  /** A wing added to an existing house rather than a new building. */
  extends?: import('./growth').ExtensionSite;
  need: Bill;
  delivered: Bill;
  work: number;
  progress: number;
  reason: string;
  proposedBy?: number;
  /** Agents who will live here (houses). */
  forAgents: number[];
  started: number;
  builders: Set<number>;
  /** When the build began waiting on workshop goods that aren't coming (see unstick). */
  stalled?: number;
  /** No one fetches goods for it before this time: the last load found no way onto the site. */
  haulPause?: number;
  /** Started as a rush job, outside the town's usual project limit. */
  rush?: boolean;
}

export type ActivityKind = 'work' | 'social' | 'life' | 'event' | 'build' | 'family';

export interface Activity {
  t: number;
  text: string;
  kind: ActivityKind;
  tone: Tone;
  agentId?: number;
  otherId?: number;
  /** How much this belongs in the "while you were away" digest: NOTABLE or HEADLINE. Unset for everyday chatter. */
  weight?: number;
}

/** Worth a line in the away digest if there's room (love, coming of age, a town meeting's pick). */
export const NOTABLE = 2;
/** Always in the away digest (births, deaths, elections, new buildings, disasters). */
export const HEADLINE = 3;

/** Which use spots each action draws on. */
export const ACTION_USE: Partial<Record<ActionKind, UseKind[]>> = {
  eat: ['eat'],
  snack: ['snack'],
  coffee: ['coffee'],
  cook: ['cook'],
  sleep: ['sleep'],
  toilet: ['toilet'],
  shower: ['shower'],
  play: ['play'],
  music: ['music'],
  read: ['read'],
  relax: ['sit'],
  shop: ['shop'],
  meet: ['meet'],
};
