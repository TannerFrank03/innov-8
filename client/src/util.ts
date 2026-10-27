import type { Priority } from './types';

/** Local YYYY-MM-DD for a Date (not UTC, so "today" matches the user's clock). */
export function isoDay(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = (x.getDay() + 6) % 7; // Monday start
  return addDays(x, -offset);
}

export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

const fmt = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short' });
export function shortDate(s: string | null): string {
  return s ? fmt.format(parseDay(s)) : '';
}

export function relativeDue(s: string | null, done: boolean): { text: string; tone: 'overdue' | 'soon' | 'normal' } | null {
  if (!s) return null;
  const diff = daysBetween(parseDay(isoDay()), parseDay(s));
  if (done) return { text: shortDate(s), tone: 'normal' };
  if (diff < 0) return { text: `${-diff}d overdue`, tone: 'overdue' };
  if (diff === 0) return { text: 'Today', tone: 'soon' };
  if (diff === 1) return { text: 'Tomorrow', tone: 'soon' };
  return { text: shortDate(s), tone: 'normal' };
}

export function timeAgo(iso: string): string {
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 86400 * 7) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

export const PRIORITIES: { value: Priority; label: string; color: string }[] = [
  { value: 'urgent', label: 'Urgent', color: '#d93025' },
  { value: 'high', label: 'High', color: '#f76b15' },
  { value: 'medium', label: 'Medium', color: '#0090ff' },
  { value: 'low', label: 'Low', color: '#8b8d98' },
];
export const priorityInfo = (p: Priority | null) => PRIORITIES.find((x) => x.value === p);

export const SWATCHES = ['#ff5a1f', '#e5484d', '#d6409f', '#8e4ec6', '#5b5bd6', '#0090ff', '#12a594', '#30a46c', '#f5a524', '#8b8d98'];

/** Readable text colour (dark or white) for a hex background. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#1c1b22' : '#ffffff';
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
