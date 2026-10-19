const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 6;

/** Smoothly-eased 2D camera. Positions are world pixels; zoom is screen px per world px. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 2;
  tx = 0;
  ty = 0;
  tz = 2;
  /** Screen-space point the camera centers on (the middle of the unobstructed play area). */
  cx = 0;
  cy = 0;
  bounds = { w: 1, h: 1 };

  jumpTo(x: number, y: number): void {
    this.x = this.tx = x;
    this.y = this.ty = y;
  }

  lookAt(x: number, y: number): void {
    this.tx = x;
    this.ty = y;
  }

  update(dtSec: number): void {
    const k = 1 - Math.exp(-dtSec * 12);
    this.zoom += (this.tz - this.zoom) * k;
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    if (Math.abs(this.tz - this.zoom) < 1e-4) this.zoom = this.tz;
  }

  panBy(dxScreen: number, dyScreen: number, immediate = false): void {
    this.tx -= dxScreen / this.tz;
    this.ty -= dyScreen / this.tz;
    this.clampTarget();
    if (immediate) {
      this.x = this.tx;
      this.y = this.ty;
    }
  }

  /** Zooms so the world point under the cursor stays put. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const wx = this.tx + (sx - this.cx) / this.tz;
    const wy = this.ty + (sy - this.cy) / this.tz;
    this.tz = clamp(this.tz * factor, MIN_ZOOM, MAX_ZOOM);
    this.tx = wx - (sx - this.cx) / this.tz;
    this.ty = wy - (sy - this.cy) / this.tz;
    this.clampTarget();
  }

  /** Unobstructed viewport edges in screen px, so the map never scrolls past its own border. */
  view = { left: 0, top: 0, right: 0, bottom: 0 };

  clampTarget(): void {
    const z = this.tz;
    const minX = (this.cx - this.view.left) / z;
    const maxX = this.bounds.w - (this.view.right - this.cx) / z;
    const minY = (this.cy - this.view.top) / z;
    const maxY = this.bounds.h - (this.view.bottom - this.cy) / z;
    this.tx = minX > maxX ? this.bounds.w / 2 : clamp(this.tx, minX, maxX);
    this.ty = minY > maxY ? this.bounds.h / 2 : clamp(this.ty, minY, maxY);
  }

  lookAtClamped(x: number, y: number): void {
    this.tx = x;
    this.ty = y;
    this.clampTarget();
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.zoom + this.cx, (wy - this.y) * this.zoom + this.cy];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.cx) / this.zoom + this.x, (sy - this.cy) / this.zoom + this.y];
  }
}
