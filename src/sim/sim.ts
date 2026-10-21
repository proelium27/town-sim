import type { Building, Prop, Room } from '../world/map';
import { type Town, buildTown } from '../world/town';
import { tickAgents } from './ai';
import { createAgents } from './agents';
import { DAY_NAMES, emptyStock, MIN_PER_DAY, type PriorityKey, SEASON_DAYS, SEASONS, type Season, type Stock, YEAR_DAYS } from './defs';
import { tickEconomy } from './economy';
import { tickEvents, type EventState, initialEvents } from './events';
import { tickLife } from './life';
import { Nav } from './nav';
import { tickPlanner } from './planner';
import { emptyLedger, tickMarket } from './market';
import { tickPolitics } from './politics';
import { tickRites } from './rites';
import { tickLake } from './lake';
import { type Fire, tickFires } from './fire';
import { type Annal, type ChronicleEntry, tickChronicle } from './chronicle';
import { tickSeasons } from './seasons';
import { Rng } from './rng';
import { type Car, tickTraffic } from './traffic';
import type { Activity, ActivityKind, Agent, Project, Tone } from './types';

/** Game minutes per simulation step. At 1x the sim runs 20 steps per real second (1 game minute/s). */
export const STEP = 0.05;

export type { Stock } from './defs';

export interface Milestone {
  t: number;
  text: string;
}

export class Sim {
  readonly town: Town;
  /** Rebuilt after loading a save. */
  nav: Nav;
  readonly rng: Rng;
  readonly seed: number;
  /** Game minutes since Monday 00:00 of week one. */
  time = 6 * 60 + 30;
  /** The living. */
  agents: Agent[] = [];
  /** The dead, kept for family trees and relationship history. */
  deceased: Agent[] = [];
  /** The dead waiting for a cemetery to be built. */
  unburied: number[] = [];
  /** People who moved away in hard times. */
  departed: Agent[] = [];
  /** The town's purse: shop takings, taxes and trade in; town wages and building costs out. */
  treasury = 400;
  /** Today's money in and out, and yesterday's for the Town view. */
  ledger = emptyLedger();
  lastLedger = emptyLedger();
  ledgerDay = 0;
  /** 0 village, 1 town, 2 city. */
  tier = 0;
  /** The elected mayor and what they ran on. */
  mayor: number | null = null;
  /** Terms the sitting mayor has won in a row. */
  mayorTerms = 0;
  agenda: PriorityKey | null = null;
  election: import('./politics').ElectionState | null = null;
  lastElection: import('./politics').ElectionResult | null = null;
  /** When the last outbreak began (or -Infinity). */
  outbreak = -Infinity;
  /** Consecutive days each household has been broke and miserable. */
  hardDays: number[] = [];
  nextAgentId = 1;
  /** Bumped whenever someone is born, arrives or dies. */
  populationVersion = 0;
  activity: Activity[] = [];
  activityVersion = 0;
  /** propId -> agentId holding that use spot. */
  reserved = new Map<number, number>();
  /** Meals in each household's fridge, indexed by household id. */
  pantry: number[] = [];
  /** Firewood by each household's hearth, indexed by household id. */
  fuel: number[] = [];
  /** Last season the sim noticed, to fire season-change events once. */
  seasonSeen = -1;
  /** The town's shared stockpile, kept in storehouses. */
  stock: Stock = { ...emptyStock(), wood: 45, stone: 30, food: 160, firewood: 30 };
  projects: Project[] = [];
  nextProjectId = 1;
  /** Player-set emphasis for the town planner: 0 low, 1 normal, 2 high. */
  priorities: Record<PriorityKey, number> = { housing: 1, food: 1, materials: 1, community: 1 };
  history: Milestone[] = [];
  /** Every headline the town has had, kept for good (the feed keeps only its last 500 lines). */
  chronicle: ChronicleEntry[] = [];
  /** The town on the first morning of each year. */
  annals: Annal[] = [];
  /** activityVersion the chronicle has caught up to. */
  chronicleSeen = 0;
  events: EventState = initialEvents();
  cars: Car[] = [];
  tasksCompleted = 0;
  nextCarId = 1;
  /** Countdown timers (game minutes) for periodic systems. */
  timers = { plan: 30, roles: 0, regrow: 0, life: 60, arrival: 1.5 * 1440, fire: 60 };
  /** Fires burning right now. */
  fires: Fire[] = [];
  /** Fires the town has ever had. */
  firesEver = 0;

  constructor(seed = 7, opts: { agents?: boolean } = {}) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.town = buildTown(seed);
    this.nav = new Nav(this.town.map);
    this.pantry = this.town.households.map(() => 5);
    this.fuel = this.town.households.map(() => 8);
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

  /** 0 spring, 1 summer, 2 autumn, 3 winter. The town is founded on the first day of spring. */
  get season(): number {
    return Math.floor(this.day / SEASON_DAYS) % SEASONS.length;
  }

  get seasonName(): Season {
    return SEASONS[this.season];
  }

  /** 1-based day within the season. */
  get seasonDay(): number {
    return (this.day % SEASON_DAYS) + 1;
  }

  /** How far through the season we are, 0..1, including the time of day. */
  get seasonProgress(): number {
    return ((this.time / MIN_PER_DAY) % SEASON_DAYS) / SEASON_DAYS;
  }

  /** 1-based year since the town was founded. */
  get year(): number {
    return Math.floor(this.day / YEAR_DAYS) + 1;
  }

  /** "Spring 2 · Year 1" */
  date(): string {
    return `${this.seasonName} ${this.seasonDay} · Year ${this.year}`;
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

  /** Adds a line to the feed. Set `weight` on the returned entry to put it in the away digest. */
  log(text: string, kind: ActivityKind, tone: Tone = 'neutral', a?: Agent, b?: Agent): Activity {
    const e: Activity = { t: this.time, text, kind, tone, agentId: a?.id, otherId: b?.id };
    this.activity.push(e);
    if (this.activity.length > 500) this.activity.splice(0, this.activity.length - 500);
    this.activityVersion++;
    return e;
  }

  milestone(text: string): void {
    this.history.push({ t: this.time, text });
  }

  step(): void {
    const dayBefore = this.day;
    this.time += STEP;
    if (this.day !== dayBefore) for (const a of this.agents) a.workedToday = 0;
    tickEvents(this, STEP);
    tickRites(this);
    tickSeasons(this, STEP);
    tickLake(this);
    tickFires(this, STEP);
    tickMarket(this);
    tickPolitics(this);
    tickLife(this, STEP);
    tickPlanner(this, STEP);
    tickEconomy(this, STEP);
    tickAgents(this, STEP);
    tickTraffic(this, STEP);
    tickChronicle(this);
  }

  run(minutes: number): void {
    const n = Math.round(minutes / STEP);
    for (let i = 0; i < n; i++) this.step();
  }
}
