import type { Prop, Room } from '../world/map';
import { type Town, buildTown } from '../world/town';
import { tickAgents } from './ai';
import { createAgents } from './agents';
import { DAY_NAMES, MIN_PER_DAY } from './defs';
import { tickEvents, type EventState, initialEvents } from './events';
import { Nav } from './nav';
import { Rng } from './rng';
import { type Car, tickTraffic } from './traffic';
import type { Activity, ActivityKind, Agent, Tone } from './types';

/** Game minutes per simulation step. At 1x the sim runs 20 steps per real second (1 game minute/s). */
export const STEP = 0.05;

export class Sim {
  readonly town: Town;
  readonly nav: Nav;
  readonly rng: Rng;
  /** Game minutes since Monday 00:00 of week one. */
  time = 6 * 60 + 30;
  agents: Agent[] = [];
  activity: Activity[] = [];
  activityVersion = 0;
  /** propId -> agentId holding that use spot. */
  reserved = new Map<number, number>();
  /** Meals in each household's fridge. */
  pantry: number[] = [];
  events: EventState = initialEvents();
  cars: Car[] = [];
  /** Stats for the top bar. */
  tasksCompleted = 0;

  constructor(seed = 7, opts: { agents?: boolean } = {}) {
    this.rng = new Rng(seed);
    this.town = buildTown();
    this.nav = new Nav(this.town.map);
    this.pantry = this.town.households.map(() => 4);
    if (opts.agents !== false) createAgents(this);
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
    return `${DAY_NAMES[this.weekday]} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  agent(id: number | undefined): Agent | undefined {
    return id === undefined ? undefined : this.agents.find((a) => a.id === id);
  }

  prop(id: number | undefined): Prop | undefined {
    return id === undefined ? undefined : this.town.map.props.find((p) => p.id === id);
  }

  roomOf(a: Agent): Room | undefined {
    const m = this.town.map;
    return m.roomAt(m.cx(a.at), m.cy(a.at));
  }

  log(text: string, kind: ActivityKind, tone: Tone = 'neutral', a?: Agent, b?: Agent): void {
    this.activity.push({ t: this.time, text, kind, tone, agentId: a?.id, otherId: b?.id });
    if (this.activity.length > 400) this.activity.splice(0, this.activity.length - 400);
    this.activityVersion++;
  }

  step(): void {
    const dayBefore = this.day;
    this.time += STEP;
    if (this.day !== dayBefore) for (const a of this.agents) a.workedToday = 0;
    tickEvents(this, STEP);
    tickAgents(this, STEP);
    tickTraffic(this, STEP);
  }

  run(minutes: number): void {
    const n = Math.round(minutes / STEP);
    for (let i = 0; i < n; i++) this.step();
  }
}
