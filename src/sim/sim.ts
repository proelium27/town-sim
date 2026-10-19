import type { Building, Prop, Room } from '../world/map';
import { type Town, buildTown } from '../world/town';
import { tickAgents } from './ai';
import { createAgents } from './agents';
import { DAY_NAMES, MIN_PER_DAY, type PriorityKey } from './defs';
import { tickEconomy } from './economy';
import { tickEvents, type EventState, initialEvents } from './events';
import { tickLife } from './life';
import { Nav } from './nav';
import { tickPlanner } from './planner';
import { Rng } from './rng';
import { type Car, tickTraffic } from './traffic';
import type { Activity, ActivityKind, Agent, Project, Tone } from './types';

/** Game minutes per simulation step. At 1x the sim runs 20 steps per real second (1 game minute/s). */
export const STEP = 0.05;

export interface Stock {
  wood: number;
  stone: number;
  food: number;
}

export interface Milestone {
  t: number;
  text: string;
}

export class Sim {
  readonly town: Town;
  readonly nav: Nav;
  readonly rng: Rng;
  /** Game minutes since Monday 00:00 of week one. */
  time = 6 * 60 + 30;
  /** The living. */
  agents: Agent[] = [];
  /** The dead, kept for family trees and relationship history. */
  deceased: Agent[] = [];
  nextAgentId = 1;
  /** Bumped whenever someone is born, arrives or dies. */
  populationVersion = 0;
  activity: Activity[] = [];
  activityVersion = 0;
  /** propId -> agentId holding that use spot. */
  reserved = new Map<number, number>();
  /** Meals in each household's fridge, indexed by household id. */
  pantry: number[] = [];
  /** The town's shared stockpile, kept in storehouses. */
  stock: Stock = { wood: 45, stone: 30, food: 160 };
  projects: Project[] = [];
  nextProjectId = 1;
  /** Player-set emphasis for the town planner: 0 low, 1 normal, 2 high. */
  priorities: Record<PriorityKey, number> = { housing: 1, food: 1, materials: 1, community: 1 };
  history: Milestone[] = [];
  events: EventState = initialEvents();
  cars: Car[] = [];
  tasksCompleted = 0;
  /** Countdown timers (game minutes) for periodic systems. */
  timers = { plan: 30, roles: 0, regrow: 0, life: 60, arrival: 1.5 * 1440 };

  constructor(seed = 7, opts: { agents?: boolean } = {}) {
    this.rng = new Rng(seed);
    this.town = buildTown(seed);
    this.nav = new Nav(this.town.map);
    this.pantry = this.town.households.map(() => 5);
    if (opts.agents !== false) createAgents(this);
    this.milestone(`${this.agents.length} townsfolk call Northwind home`);
  }

  get map() {
    return this.town.map;
  }

  get day(): number {
    return Math.floor(this.time / MIN_PER_DAY);
  }

  get weekday(): number {
    return this.day % 7;
  }

  get weekend(): boolean {
    return this.weekday >= 5;
  }

  get hour(): number {
    return (this.time % MIN_PER_DAY) / 60;
  }

  clock(): string {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `Day ${this.day + 1} · ${DAY_NAMES[this.weekday]} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  agent(id: number | undefined): Agent | undefined {
    return id === undefined ? undefined : this.agents.find((a) => a.id === id);
  }

  /** Living or dead. */
  person(id: number | undefined): Agent | undefined {
    return this.agent(id) ?? (id === undefined ? undefined : this.deceased.find((a) => a.id === id));
  }

  prop(id: number | undefined): Prop | undefined {
    return this.town.map.prop(id);
  }

  building(id: number | undefined | null): Building | undefined {
    return id == null ? undefined : this.town.map.buildings.find((b) => b.id === id);
  }

  roomOf(a: Agent): Room | undefined {
    const m = this.town.map;
    return m.roomAt(m.cx(a.at), m.cy(a.at));
  }

  log(text: string, kind: ActivityKind, tone: Tone = 'neutral', a?: Agent, b?: Agent): void {
    this.activity.push({ t: this.time, text, kind, tone, agentId: a?.id, otherId: b?.id });
    if (this.activity.length > 500) this.activity.splice(0, this.activity.length - 500);
    this.activityVersion++;
  }

  milestone(text: string): void {
    this.history.push({ t: this.time, text });
  }

  step(): void {
    const dayBefore = this.day;
    this.time += STEP;
    if (this.day !== dayBefore) for (const a of this.agents) a.workedToday = 0;
    tickEvents(this, STEP);
    tickLife(this, STEP);
    tickPlanner(this, STEP);
    tickEconomy(this, STEP);
    tickAgents(this, STEP);
    tickTraffic(this, STEP);
  }

  run(minutes: number): void {
    const n = Math.round(minutes / STEP);
    for (let i = 0; i < n; i++) this.step();
  }
}
