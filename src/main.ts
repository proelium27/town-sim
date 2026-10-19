import { Application } from 'pixi.js';
import { Art } from './assets/loader';
import { TILE } from './assets/manifest';
import { Camera } from './engine/camera';
import { AgentsView } from './render/agentsView';
import { WorldView } from './render/worldView';
import { Sim, STEP } from './sim/sim';
import { ActivityLog } from './ui/activity';
import { Inspector } from './ui/inspector';
import { Tracker, statusOf } from './ui/tracker';

/** Real milliseconds per sim step at 1x: 20 steps per second, so one game minute per real second. */
const STEP_MS = 1000 * STEP;
const MAX_STEPS_PER_FRAME = 40;

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#e9e4d8',
    antialias: false,
    roundPixels: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });
  document.getElementById('stage')!.appendChild(app.canvas);

  const art = new Art();
  await art.load();
  const seed = Number(new URLSearchParams(location.search).get('seed') ?? 7);
  const sim = new Sim(seed);
  const world = new WorldView(art, sim.map);
  const people = new AgentsView(art, sim, world);
  app.stage.addChild(world.root, people.sky, people.rain, people.overlay);

  const camera = new Camera();
  camera.bounds = { w: sim.map.w * TILE, h: sim.map.h * TILE };
  const layout = () => {
    const css = getComputedStyle(document.body);
    const left = parseFloat(css.getPropertyValue('--left-w')) || 0;
    const right = parseFloat(css.getPropertyValue('--right-w')) || 0;
    const top = parseFloat(css.getPropertyValue('--top-h')) || 0;
    const bottom = parseFloat(css.getPropertyValue('--log-h')) || 0;
    camera.cx = left + (window.innerWidth - left - right) / 2;
    camera.cy = top + (window.innerHeight - top - bottom) / 2;
    camera.view = { left, top, right: window.innerWidth - right, bottom: window.innerHeight - bottom };
    camera.clampTarget();
  };
  window.addEventListener('resize', layout);
  layout();
  camera.jumpTo(30 * TILE, 22 * TILE);
  camera.clampTarget();
  camera.x = camera.tx;
  camera.y = camera.ty;

  // ---- state + UI
  let speed = 1;
  let lastSpeed = 1;
  let selected: number | null = null;
  let following = false;
  const select = (id: number | null, focus = false) => {
    selected = id;
    people.selected = id;
    if (id === null) following = false;
    inspector.show(id);
    layout();
    if (focus && id !== null) {
      const a = sim.agent(id)!;
      camera.lookAtClamped((a.x + 0.5) * TILE, (a.y + 0.5) * TILE);
    }
    refreshUi();
  };
  const tracker = new Tracker(document.getElementById('tracker')!, sim, art, (id) => select(id, true));
  const activity = new ActivityLog(document.getElementById('activity')!, sim, (id) => select(id, true));
  const inspector = new Inspector(document.getElementById('inspector')!, sim, art, {
    select: (id) => select(id, true),
    follow: () => (following = !following),
    isFollowing: () => following,
  });

  const speedEl = document.getElementById('speed')!;
  const setSpeed = (s: number) => {
    if (s > 0) lastSpeed = s;
    speed = s;
    for (const b of speedEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s));
  };
  speedEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) setSpeed(Number(b.dataset.speed));
  });
  setSpeed(1);

  const clockEl = document.getElementById('clock')!;
  const statsEl = document.getElementById('stats')!;
  const refreshUi = () => {
    clockEl.textContent = sim.clock();
    const working = sim.agents.filter((a) => statusOf(a) === 'working').length;
    const asleep = sim.agents.filter((a) => statusOf(a) === 'asleep').length;
    const mood = Math.round(sim.agents.reduce((s, a) => s + a.mood, 0) / sim.agents.length);
    const ev = sim.events;
    const happening = [ev.standup && 'Standup in progress', ev.pizza && 'Pizza in the kitchen', ev.party && 'Party in the lounge', ev.coffeeBroken && 'Coffee machine broken'].filter(Boolean).join(' · ');
    statsEl.innerHTML = `<span><b>${working}</b> working</span><span><b>${asleep}</b> asleep</span><span>Mood <b>${mood}</b></span><span>Tasks done <b>${sim.tasksCompleted}</b></span><span>${ev.rain ? 'Raining' : sim.hour > 6 && sim.hour < 20 ? 'Clear' : 'Night'}</span>${happening ? `<span class="happening">${happening}</span>` : ''}`;
    tracker.update(selected);
    activity.update(selected);
    inspector.update();
  };

  // ---- input
  const cv = app.canvas;
  const keys = new Set<string>();
  let drag: { x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });
  cv.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    const hit = e.target === cv ? people.pick(e.offsetX, e.offsetY, camera) : null;
    people.hovered = hit?.id ?? null;
    cv.style.cursor = hit ? 'pointer' : drag?.moved ? 'grabbing' : 'grab';
    if (!drag) return;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
    if (drag.moved) {
      following = false;
      camera.panBy(e.clientX - drag.x, e.clientY - drag.y, true);
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  window.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved && e.target === cv) {
      const hit = people.pick(e.offsetX, e.offsetY, camera);
      select(hit?.id ?? null);
    }
    drag = null;
  });
  window.addEventListener('keydown', (e) => {
    const typing = (e.target as HTMLElement).closest('input, textarea');
    if (typing) {
      if (e.code === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    keys.add(e.code);
    if (e.code === 'Space') {
      e.preventDefault();
      setSpeed(speed ? 0 : lastSpeed);
    } else if (e.key >= '1' && e.key <= '3') setSpeed(Number(e.key));
    else if (e.code === 'Escape') select(null);
    else if (e.code === 'KeyF' && selected !== null) following = !following;
    else if (e.key === '/') {
      e.preventDefault();
      tracker.focusSearch();
    } else if (e.code === 'Tab') {
      e.preventDefault();
      const i = sim.agents.findIndex((a) => a.id === selected);
      const next = sim.agents[(i + (e.shiftKey ? -1 : 1) + sim.agents.length) % sim.agents.length];
      select(next.id, true);
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // ---- loop
  let acc = 0;
  let uiTimer = 0;
  app.ticker.add((tk) => {
    const dtMs = Math.min(250, tk.deltaMS);
    const dt = dtMs / 1000;
    if (speed > 0) {
      acc += dtMs * speed;
      let n = 0;
      while (acc >= STEP_MS && n < MAX_STEPS_PER_FRAME) {
        sim.step();
        acc -= STEP_MS;
        n++;
      }
      if (n === MAX_STEPS_PER_FRAME) acc = 0;
    }
    const pan = 520 * dt;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) camera.panBy(pan, 0);
    if (keys.has('KeyD') || keys.has('ArrowRight')) camera.panBy(-pan, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) camera.panBy(0, pan);
    if (keys.has('KeyS') || keys.has('ArrowDown')) camera.panBy(0, -pan);
    if ([...keys].some((k) => /Key[WASD]|Arrow/.test(k))) following = false;
    if (following && selected !== null) {
      const a = sim.agent(selected)!;
      camera.lookAtClamped((a.x + 0.5) * TILE, (a.y + 0.5) * TILE);
    }
    camera.update(dt);
    world.root.scale.set(camera.zoom);
    world.root.position.set(Math.round(camera.cx - camera.x * camera.zoom), Math.round(camera.cy - camera.y * camera.zoom));
    const alpha = speed > 0 ? acc / STEP_MS : 1;
    people.update(Math.min(1, alpha), dt, speed, camera, app.screen.width, app.screen.height);
    people.updateWeather(sim.hour, !!sim.events.rain, performance.now(), app.screen.width, app.screen.height);
    uiTimer -= dt;
    if (uiTimer <= 0) {
      uiTimer = 0.25;
      refreshUi();
    }
  });
  refreshUi();
  Object.assign(window, { sim, camera, select, setSpeed });
}

boot();
