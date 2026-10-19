import { DAY_NAMES } from '../sim/defs';

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function hhmm(t: number): string {
  const m = Math.floor(((t % 1440) + 1440) % 1440);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function dayTime(t: number): string {
  return `${DAY_NAMES[Math.floor(t / 1440) % 7]} ${hhmm(t)}`;
}

export function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  return `${String(Math.floor(hh)).padStart(2, '0')}:${String(Math.round((hh % 1) * 60)).padStart(2, '0')}`;
}

export function duration(min: number): string {
  if (min >= 1440) return `${(min / 1440).toFixed(1)}d`;
  if (min >= 60) return `${Math.round(min / 60)}h`;
  return `${Math.max(1, Math.round(min))}m`;
}
