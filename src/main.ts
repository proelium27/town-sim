import { Application, Sprite } from 'pixi.js';
import { Art } from './assets/loader';
import { TILE, type Facing } from './assets/manifest';
import { Camera } from './engine/camera';
import { WorldView } from './render/worldView';
import { Nav } from './sim/nav';
import { buildTown } from './world/town';

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
  const town = buildTown();
  const view = new WorldView(art, town.map);
  app.stage.addChild(view.root);

  const camera = new Camera();
  camera.bounds = { w: town.map.w * TILE, h: town.map.h * TILE };
  const layout = () => {
    const css = getComputedStyle(document.body);
    const left = parseFloat(css.getPropertyValue('--left-w')) || 0;
    const right = parseFloat(css.getPropertyValue('--right-w')) || 0;
    const top = parseFloat(css.getPropertyValue('--top-h')) || 0;
    const bottom = parseFloat(css.getPropertyValue('--log-h')) || 0;
    camera.cx = left + (window.innerWidth - left - right) / 2;
    camera.cy = top + (window.innerHeight - top - bottom) / 2;
  };
  window.addEventListener('resize', layout);
  layout();
  camera.jumpTo(21 * TILE, 13 * TILE);

  // ---- temporary wanderers to exercise A* (replaced by the agent sim in phase 3)
  const nav = new Nav(town.map);
  const m = town.map;
  const walkable: number[] = [];
  for (let i = 0; i < m.w * m.h; i++) if (m.walkable(i % m.w, (i / m.w) | 0) && m.cost[i] < 2) walkable.push(i);
  const walkers = Array.from({ length: 12 }, (_, k) => {
    const frames = art.character({ base: k % 6, shirtHue: (k * 47) % 360, hairHue: (k * 89) % 360, hairLight: 0.8 + (k % 3) * 0.2 });
    const s = new Sprite(frames.down[0]);
    s.anchor.set(0.5, 1);
    view.entities.addChild(s);
    const at = walkable[(k * 977) % walkable.length];
    return { s, frames, at, x: at % m.w, y: (at / m.w) | 0, path: [] as number[], t: 0, facing: 'down' as Facing, anim: 0 };
  });

  let speed = 1;
  const speedEl = document.getElementById('speed')!;
  const setSpeed = (s: number) => {
    speed = s;
    for (const b of speedEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s));
  };
  speedEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) setSpeed(Number(b.dataset.speed));
  });
  setSpeed(1);

  // ---- camera input
  const cv = app.canvas;
  const keys = new Set<string>();
  let drag: { x: number; y: number } | null = null;
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });
  cv.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY }));
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    camera.panBy(e.clientX - drag.x, e.clientY - drag.y, true);
    drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointerup', () => (drag = null));
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'Space') setSpeed(speed ? 0 : 1);
    if (e.key >= '1' && e.key <= '3') setSpeed(Number(e.key));
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  app.ticker.add((tk) => {
    const dt = tk.deltaMS / 1000;
    const pan = 500 * dt;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) camera.panBy(pan, 0);
    if (keys.has('KeyD') || keys.has('ArrowRight')) camera.panBy(-pan, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) camera.panBy(0, pan);
    if (keys.has('KeyS') || keys.has('ArrowDown')) camera.panBy(0, -pan);

    for (const w of walkers) {
      if (!w.path.length) {
        const goal = walkable[Math.floor(Math.random() * walkable.length)];
        w.path = nav.findPath(w.at, goal) ?? [];
        continue;
      }
      w.t += dt * 3.2 * speed;
      while (w.t >= 1 && w.path.length) {
        w.t -= 1;
        w.at = w.path.shift()!;
      }
      const next = w.path[0] ?? w.at;
      const ax = w.at % m.w, ay = (w.at / m.w) | 0, bx = next % m.w, by = (next / m.w) | 0;
      w.x = ax + (bx - ax) * w.t;
      w.y = ay + (by - ay) * w.t;
      if (bx !== ax || by !== ay) w.facing = Math.abs(bx - ax) >= Math.abs(by - ay) ? (bx > ax ? 'right' : 'left') : by > ay ? 'down' : 'up';
      w.anim += dt * 8 * speed;
      w.s.texture = w.frames[w.facing][speed ? Math.floor(w.anim) % 4 : 0];
      w.s.position.set(Math.round((w.x + 0.5) * TILE), Math.round((w.y + 1) * TILE - 1));
      w.s.zIndex = w.s.y;
    }

    camera.update(dt);
    view.root.scale.set(camera.zoom);
    view.root.position.set(Math.round(camera.cx - camera.x * camera.zoom), Math.round(camera.cy - camera.y * camera.zoom));
  });
  Object.assign(window, { town, camera, view });
}

boot();
