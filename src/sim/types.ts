import type { Outfit } from '../assets/loader';
import type { Facing } from '../assets/manifest';
import type { UseKind } from '../world/map';
import type { MemoryKind, NeedKey, RoleKey, SkillKey, TraitKey } from './defs';

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
  | 'chop' | 'mine' | 'haul' | 'build' | 'farm' | 'deposit' | 'learn' | 'teach';

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
  material?: 'wood' | 'stone';
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
  /** Game minute of the last near-miss with a car, to avoid repeat scares. */
  lastScare: number;

  /** Game minute they were born (may be negative for the founders). */
  birth: number;
  partner: number | null;
  parents: number[];
  children: number[];
  /** What they're carrying back to the storehouse or to a build site. */
  carry: { kind: 'wood' | 'stone' | 'food'; amount: number } | null;
  /** Building they work at, for teacher/cook roles. */
  workBuilding: number | null;
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
  need: { wood: number; stone: number };
  delivered: { wood: number; stone: number };
  work: number;
  progress: number;
  reason: string;
  proposedBy?: number;
  /** Agents who will live here (houses). */
  forAgents: number[];
  started: number;
  builders: Set<number>;
}

export type ActivityKind = 'work' | 'social' | 'life' | 'event' | 'build' | 'family';

export interface Activity {
  t: number;
  text: string;
  kind: ActivityKind;
  tone: Tone;
  agentId?: number;
  otherId?: number;
}

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
