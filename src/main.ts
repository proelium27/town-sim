import { Application } from 'pixi.js';
import { Art } from './assets/loader';
import { TILE } from './assets/manifest';
import { Camera } from './engine/camera';
import { AgentsView } from './render/agentsView';
import { WorldView } from './render/worldView';
import { CLASSIC } from './sim/character';
import { Sim, STEP } from './sim/sim';
import { ActivityLog } from './ui/activity';
import { Hud } from './ui/hud';
import { Inspector } from './ui/inspector';
import { TownPanel } from './ui/townPanel';
import { readAway, readSave, Saves } from './ui/saves';
import { Away } from './ui/away';
import { Director } from './ui/director';
import { ChronicleBook } from './ui/chronicle';
import { Tracker } from './ui/tracker';

/** Game minutes per real second at each speed: Normal plays a day in 8 minutes, Fast in about 90 seconds, Fastest in 24. */
const MINUTES_PER_SECOND = [0, 3, 15, 60];
/** Real milliseconds per sim step at one game minute per real second. */
const STEP_MS = 1000 * STEP;
/** Most real time a frame spends stepping the sim; past it the backlog is dropped, so a slow machine runs slower instead of stalling. */
const SIM_BUDGET_MS = 10;

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#1f2a1d',
    antialias: false,
    roundPixels: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });
  document.getElementById('stage')!.appendChild(app.canvas);

  // Name tags are Pixi text; give the UI font a moment so they don't render in the fallback.
  await Promise.race([document.fonts.load('600 11px Rubik'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});

  const art = new Art();
  await art.load();
  // A ?seed= link is a scratch town: it never touches the saved one.
  const params = new URLSearchParams(location.search);
  const scratch = params.has('seed');
  const saved = scratch ? null : readSave();
  // A brand-new town rolls its own seed, so no two grow up alike; the seed is saved with it.
  // `&classic` replays the original Northwind (old saves) rather than the character the seed rolls now.
  const seed = Number(params.get('seed') ?? Math.floor(Math.random() * 1e6));
  const sim = saved?.sim ?? new Sim(seed, params.has('classic') ? { character: CLASSIC } : {});
  const saves = new Saves(sim, !scratch, saved?.unreadable);
  // Save the new town straight away, or a reload before the first autosave would roll a different one.
  if (!saved?.sim) saves.save();
  const world = new WorldView(art, sim);
  const people = new AgentsView(art, sim, world);
  app.stage.addChild(world.root, people.sky, people.rain, people.overlay);

  const camera = new Camera();
  camera.bounds = { w: sim.map.w * TILE, h: sim.map.h * TILE };
  /** Panels float over the map: the map may scroll under them, but the camera centers on the clear middle. */
  const layout = () => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    // Layout boxes (offset*), not getBoundingClientRect: the inspector's slide-in transform would skew it.
    // While directing, the side panels step aside and the shot uses the whole window.
    const directing = document.body.classList.contains('directing');
    const edge = (id: string) => {
      const el = document.getElementById(id)!;
      return el.hidden || (directing && id !== 'hud') ? null :{ left: el.offsetLeft, right: el.offsetLeft + el.offsetWidth, bottom: el.offsetTop + el.offsetHeight };
    };
    const roster = edge('tracker');
    const ins = edge('inspector');
    const hud = edge('hud');
    const left = roster ? roster.right : 0;
    const right = ins ? ins.left : W;
    const top = hud ? hud.bottom : 0;
    // Opening or closing a panel moves the clear middle; shift the camera with it so the world stays put on screen.
    const cx = (left + right) / 2;
    const cy = (top + H) / 2;
    camera.x += (cx - camera.cx) / camera.zoom;
    camera.tx += (cx - camera.cx) / camera.tz;
    camera.y += (cy - camera.cy) / camera.zoom;
    camera.ty += (cy - camera.cy) / camera.tz;
    camera.cx = cx;
    camera.cy = cy;
    // Clamp to the clear area so the map's own edges (and anyone standing there) can always be brought into view.
    camera.view = { left, top, right, bottom: H };
    camera.clampTarget();
  };
  window.addEventListener('resize', layout);
  layout();
  // Start on the edge of the old town, where the new neighborhoods will grow.
  camera.jumpTo(62 * TILE, 30 * TILE);
  camera.clampTarget();
  camera.x = camera.tx;
  camera.y = camera.ty;

  // ---- state + UI
  let speed = 1;
  let lastSpeed = 1;
  let selected: number | null = null;
  let following = false;
  /** Roofs: shown from afar and lifted up close; R forces them off. */
  let roofsOff = false;
  const ROOF_LIFT_ZOOM = 3;
  const select = (id: number | null, focus = false) => {
    selected = id;
    people.selected = id;
    if (id === null) following = false;
    inspector.show(id);
    layout();
    if (id !== null) {
      const a = sim.agent(id)!;
      const [sx, sy] = camera.toScreen((a.x + 0.5) * TILE, (a.y + 0.5) * TILE);
      const v = camera.view;
      const hidden = sx < v.left + 48 || sx > v.right - 48 || sy < v.top + 48 || sy > v.bottom - 48;
      // Picked from a list: bring them to the middle. Clicked on the map: only pan if a panel now covers them.
      if (focus || hidden) camera.lookAtClamped((a.x + 0.5) * TILE, (a.y + 0.5) * TILE);
    }
    refreshUi();
  };
  const tracker = new Tracker(document.getElementById('tracker')!, sim, art, (id) => select(id, true), () => {
    document.body.classList.toggle('roster-collapsed', tracker.collapsed);
    layout();
  }, () => refreshUi());
  const book = new ChronicleBook(sim, (id) => select(id, true));
  const town = new TownPanel(tracker.townEl, sim, (x, y) => camera.lookAtClamped(x * TILE, y * TILE), (id) => select(id, true), saves, () => book.toggle());
  if (window.innerWidth < 900) tracker.toggle(true);
  const hud = new Hud(sim);
  const activity = new ActivityLog(document.getElementById('activity')!, sim, (id) => select(id, true));
  const inspector = new Inspector(document.getElementById('inspector')!, sim, art, {
    select: (id) => select(id, true),
    follow: () => (following = !following),
    isFollowing: () => following,
  });

  // The card catches up in game minutes per real second, not the speed button's number.
  const away = new Away(sim, { speed: () => MINUTES_PER_SECOND[speed], select: (id) => select(id, true), openLog: () => activity.toggle(true) });
  const director = new Director(sim, camera, document.getElementById('director-btn')!, (on) => {
    if (on) following = false;
    layout();
  }, () => !away.busy);

  const speedEl = document.getElementById('speed')!;
  const setSpeed = (s: number) => {
    if (s > 0) lastSpeed = s;
    speed = s;
    saves.speed = s;
    for (const b of speedEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s));
  };
  speedEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) setSpeed(Number(b.dataset.speed));
  });
  setSpeed(1);

  const refreshUi = () => {
    hud.update();
    // The roster keeps its header count fresh even while the Town view is showing.
    tracker.update(selected);
    if (tracker.view === 'town' && !tracker.collapsed) town.update();
    activity.update(selected);
    book.update();
    inspector.update();
  };

  // ---- input
  const cv = app.canvas;
  const keys = new Set<string>();
  let drag: { x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  /** Canvas-local CSS pixels (offsetX is unreliable for scaled canvases and synthetic events). */
  const local = (e: MouseEvent): [number, number] => {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoomAt(...local(e), Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel']) window.addEventListener(ev, () => away.input(), { passive: true });
  // Any deliberate input takes the camera back from the director; just moving the mouse doesn't.
  for (const ev of ['pointerdown', 'keydown', 'wheel']) {
    window.addEventListener(ev, (e) => {
      if (!director.owns(e.target) && (e as KeyboardEvent).code !== 'KeyC') director.input();
    }, { passive: true });
  }
  cv.addEventListener('pointerdown', (e) => {
    drag ={ x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    const hit = e.target === cv ? people.pick(...local(e), camera) : null;
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
      const hit = people.pick(...local(e), camera);
      // A headstone opens that person's page in the chronicle.
      const [wx, wy] = camera.toWorld(...local(e));
      const grave = hit ? undefined : sim.map.propsOn(Math.floor(wx / TILE), Math.floor(wy / TILE)).find((p) => p.key === 'grave' && p.about !== undefined);
      if (grave) book.show('family', grave.about!);
      else select(hit?.id ?? null);
    }
    drag = null;
  });
  window.addEventListener('keydown', (e) => {
    const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea');
    if (typing) {
      if (e.code === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    keys.add(e.code);
    if (e.code === 'Space') {
      e.preventDefault();
      setSpeed(speed ? 0 : lastSpeed);
    } else if (e.key >= '1' && e.key <= '3') setSpeed(Number(e.key));
    else if (e.code === 'Escape') {
      if (away.open && !away.busy) away.close();
      else if (book.open) book.close();
      else select(null);
    }
    else if (e.code === 'KeyF' && selected !== null) following = !following;
    else if (e.code === 'KeyP') tracker.toggle();
    else if (e.code === 'KeyT') tracker.setView(tracker.view === 'town' ? 'people' : 'town');
    else if (e.code === 'KeyR') roofsOff = !roofsOff;
    else if (e.code === 'KeyC') director.toggle();
    else if (e.code === 'KeyH') book.toggle();
    else if (e.code === 'KeyL') activity.toggle();
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
    if (away.busy) {
      away.frame();
      acc = 0;
    } else if (speed > 0) {
      acc += dtMs * MINUTES_PER_SECOND[speed];
      const start = performance.now();
      while (acc >= STEP_MS) {
        sim.step();
        acc -= STEP_MS;
        if (performance.now() - start > SIM_BUDGET_MS) {
          acc = 0;
          break;
        }
      }
    }
    const pan = 520 * dt;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) camera.panBy(pan, 0);
    if (keys.has('KeyD') || keys.has('ArrowRight')) camera.panBy(-pan, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) camera.panBy(0, pan);
    if (keys.has('KeyS') || keys.has('ArrowDown')) camera.panBy(0, -pan);
    if ([...keys].some((k) => /Key[WASD]|Arrow/.test(k))) following = false;
    director.frame();
    if (following && selected !== null) {
      const a = sim.agent(selected)!;
      camera.lookAtClamped((a.x + 0.5) * TILE, (a.y + 0.5) * TILE);
    }
    camera.update(dt);
    world.sync();
    world.updateFx(speed > 0 ? dt : 0);
    const open = new Set<number>();
    const sel = selected !== null ? sim.agent(selected) : undefined;
    const home = sel ? world.exteriors.buildingAt(Math.round(sel.x), Math.round(sel.y)) : undefined;
    if (home) open.add(home.id);
    world.exteriors.update(dt, open, roofsOff || camera.zoom >= ROOF_LIFT_ZOOM);
    world.root.scale.set(camera.zoom);
    world.root.position.set(Math.round(camera.cx - camera.x * camera.zoom), Math.round(camera.cy - camera.y * camera.zoom));
    const alpha = speed > 0 ? acc / STEP_MS : 1;
    people.update(Math.min(1, alpha), dt, speed, camera, app.screen.width, app.screen.height);
    people.updateWeather(sim.hour, !!sim.events.rain, performance.now(), app.screen.width, app.screen.height, sim.season, sim.seasonProgress, !!sim.events.snowstorm);
    uiTimer -= dt;
    if (uiTimer <= 0) {
      uiTimer = 0.25;
      refreshUi();
      saves.tick();
    }
  });
  refreshUi();
  if (saved?.sim) away.resume(readAway());
  Object.assign(window, { sim, camera, select, setSpeed, away, director });
}

boot();
