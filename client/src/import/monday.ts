// Reads a Monday.com "Export board to Excel" workbook (already turned into rows of cells) into a
// plain structure, then into the body for POST /api/boards/import.
//
// Layout of the main sheet, as exported by Monday.com:
//   Board name                       (single cell, sometimes followed by a description row)
//   Group name                       (single cell)
//   Name | Subitems | Person | Status | Date | …      ← header row for the group
//   Item 1 | … values …
//   (blank) | Subitems | Name | Owner | Status | …    ← optional subitem header
//   (blank) | (blank)  | Subitem A | … values …
//   Item 2 | …
//   (blank row)                                       ← end of group
// The parser is deliberately tolerant: it keys off "Name" header rows and single-cell rows
// rather than exact positions, because Monday.com's exact layout isn't documented.

export type Cell = string | number | boolean | Date | null | undefined;
export type Rows = Cell[][];

export interface MondayItem {
  group: string;
  title: string;
  values: Record<string, Cell>;
  subitems: { title: string; values: Record<string, Cell> }[];
  updates: { author: string; date: string | null; body: string }[];
}

export interface ColumnMap {
  status?: string;
  person?: string;
  priority?: string;
  timeline?: string;
  start?: string;
  due?: string;
  description: string[];
  extra: string[];
}

export interface MondayBoard {
  name: string;
  groups: string[];
  columns: string[];
  map: ColumnMap;
  items: MondayItem[];
  statuses: string[];
  people: string[];
  updatesFound: number;
  updatesUnmatched: number;
}

const text = (c: Cell): string => {
  if (c == null) return '';
  if (c instanceof Date) return isNaN(c.getTime()) ? '' : c.toISOString().slice(0, 10);
  return String(c).trim();
};
const filled = (row: Cell[]) => row.filter((c) => text(c) !== '').length;
const isBlank = (row: Cell[] | undefined) => !row || filled(row) === 0;
const lower = (c: Cell) => text(c).toLowerCase();

const isItemHeader = (row: Cell[]) => lower(row[0]) === 'name' && filled(row) >= 2;
/** Subitem header: "Name" in column 2 or 3, with column 1 empty or "Subitems". */
function subHeaderOffset(row: Cell[]): number {
  if (!['', 'subitems', 'subitem'].includes(lower(row[0]))) return -1;
  for (const k of [1, 2]) if (lower(row[k]) === 'name') return k;
  return -1;
}

// Columns that carry no task information.
const IGNORED = /^(subitems?|item id|creation log|created( at| by)?|last updated|updated at|formula|auto number|mirror)$/i;

export function mapColumns(columns: string[]): ColumnMap {
  const map: ColumnMap = { description: [], extra: [] };
  const take = (re: RegExp, key: keyof Omit<ColumnMap, 'description' | 'extra'>) => {
    if (map[key]) return false;
    const col = columns.find((c) => re.test(c) && !Object.values(map).flat().includes(c));
    if (col) map[key] = col;
    return !!col;
  };
  take(/^status$/i, 'status') || take(/status|stage|progress|state/i, 'status');
  take(/^(person|people|owner|assignee)$/i, 'person') || take(/person|people|owner|assign|designer|responsible|who/i, 'person');
  take(/priority|urgency|importance/i, 'priority');
  take(/timeline|time ?frame|duration range/i, 'timeline');
  take(/^start|start date|kick ?off/i, 'start');
  take(/^date$|due|deadline|end date|delivery|^date/i, 'due');
  const used = new Set(Object.values(map).flat());
  for (const c of columns) {
    if (used.has(c) || IGNORED.test(c)) continue;
    if (/note|text|description|details|brief|comment|summary/i.test(c)) map.description.push(c);
    else map.extra.push(c);
  }
  return map;
}

export function parseMonday(main: Rows, updates?: Rows, fallbackName = 'Imported board'): MondayBoard {
  const rows = main.map((r) => (r ?? []).map((c) => (typeof c === 'string' ? c.trim() : c)));
  const nextNonBlank = (i: number) => {
    for (let j = i + 1; j < rows.length; j++) if (!isBlank(rows[j])) return rows[j];
    return undefined;
  };

  let boardName = '';
  let group = '';
  let header: string[] | null = null;
  let sub: { offset: number; header: string[] } | null = null;
  let current: MondayItem | null = null;
  const items: MondayItem[] = [];
  const groups: string[] = [];
  const columns: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (isBlank(row)) { header = null; sub = null; current = null; continue; }

    if (isItemHeader(row)) {
      header = row.map(text);
      sub = null;
      current = null;
      if (!group) group = 'Imported';
      if (!groups.includes(group)) groups.push(group);
      for (const h of header.slice(1)) if (h && !columns.includes(h)) columns.push(h);
      continue;
    }

    const offset = subHeaderOffset(row);
    if (offset > 0 && header) {
      sub = { offset, header: row.map(text) };
      continue;
    }

    // A lone cell is a group title when a header row follows, the board title before any header,
    // and otherwise an item that only has a name.
    if (filled(row) === 1 && text(row[0])) {
      const next = nextNonBlank(i);
      if (next && isItemHeader(next)) { group = text(row[0]); header = null; continue; }
      if (!header) { if (!boardName) boardName = text(row[0]); continue; }
    }

    if (!header) continue;

    if (text(row[0])) {
      const values: Record<string, Cell> = {};
      header.forEach((h, k) => { if (k > 0 && h) values[h] = row[k]; });
      current = { group, title: text(row[0]), values, subitems: [], updates: [] };
      items.push(current);
      sub = null;
    } else if (sub && current && text(row[sub.offset])) {
      const values: Record<string, Cell> = {};
      sub.header.forEach((h, k) => { if (k > sub!.offset && h) values[h] = row[k]; });
      current.subitems.push({ title: text(row[sub.offset]), values });
    }
  }

  const map = mapColumns(columns);
  const { found, unmatched } = attachUpdates(items, updates);
  const statuses = uniq(items.map((it) => text(it.values[map.status ?? ''])).filter(Boolean));
  const people = uniq(items.flatMap((it) => [
    ...splitPeople(it.values[map.person ?? '']),
    ...it.updates.map((u) => u.author),
  ]).filter(Boolean));

  return {
    name: boardName || fallbackName,
    groups: groups.length ? groups : ['Imported'],
    columns,
    map,
    items,
    statuses,
    people,
    updatesFound: found,
    updatesUnmatched: unmatched,
  };
}

/** Updates tab: one row per update, with the item's name, the author, a date and the text. */
function attachUpdates(items: MondayItem[], rows?: Rows): { found: number; unmatched: number } {
  if (!rows?.length) return { found: 0, unmatched: 0 };
  const h = rows.findIndex((r) => r.some((c) => /^item( name)?$/i.test(text(c))) &&
    r.some((c) => /update|content|text|body/i.test(text(c))));
  if (h < 0) return { found: 0, unmatched: 0 };
  const head = rows[h].map(lower);
  const col = (re: RegExp) => head.findIndex((c) => re.test(c));
  const itemCol = col(/^item( name)?$/);
  const bodyCol = col(/update content|^content$|^update$|^text$|^body$/) >= 0 ? col(/update content|^content$|^update$|^text$|^body$/) : col(/update|content|text|body/);
  const userCol = col(/^user$|^author$|created by|^by$|^user name$|^name$/);
  const dateCol = col(/created at|^date$|^created$|time/);
  const byTitle = new Map(items.map((it) => [it.title.toLowerCase(), it]));
  let found = 0, unmatched = 0;
  for (const row of rows.slice(h + 1)) {
    const body = text(row[bodyCol]);
    if (!body) continue;
    found++;
    const item = byTitle.get(lower(row[itemCol]));
    if (!item) { unmatched++; continue; }
    item.updates.push({ author: userCol >= 0 ? text(row[userCol]) : '', date: toDateTime(row[dateCol]), body });
  }
  return { found, unmatched };
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

export function splitPeople(c: Cell): string[] {
  return text(c).split(/\s*[,;]\s*|\s+&\s+/).map((s) => s.trim()).filter(Boolean);
}

// ---- Values → Orchestr8 fields ----

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const iso = (d: Date) => (isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10));

/** A single date from a Date, an Excel serial number, or text like 2026-11-02, 02/11/2026 or Nov 2, 2026. */
export function toDate(c: Cell): string | null {
  if (c == null || c === '') return null;
  if (c instanceof Date) return iso(c);
  if (typeof c === 'number') return c > 20000 && c < 80000 ? iso(new Date(EXCEL_EPOCH + Math.round(c) * 86400000)) : null;
  const s = String(c).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/); // day/month/year (South African order)
  if (m) return iso(new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])));
  const t = Date.parse(`${s} UTC`);
  if (!isNaN(t)) return iso(new Date(t));
  const t2 = Date.parse(s);
  return isNaN(t2) ? null : iso(new Date(Date.UTC(new Date(t2).getFullYear(), new Date(t2).getMonth(), new Date(t2).getDate())));
}

function toDateTime(c: Cell): string | null {
  if (c instanceof Date) return isNaN(c.getTime()) ? null : c.toISOString();
  const s = text(c);
  if (!s) return null;
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t).toISOString();
  const d = toDate(c);
  return d ? `${d}T00:00:00.000Z` : null;
}

/** "2026-11-02 - 2026-11-06" (or a single date) → [start, end]. */
export function toRange(c: Cell): [string | null, string | null] {
  if (c instanceof Date || typeof c === 'number') { const d = toDate(c); return [d, d]; }
  const s = text(c);
  if (!s) return [null, null];
  const parts = s.split(/\s+(?:-|–|—|to)\s+/);
  if (parts.length === 2) return [toDate(parts[0]), toDate(parts[1])];
  const d = toDate(s);
  return [d, d];
}

export function toPriority(c: Cell): 'low' | 'medium' | 'high' | 'urgent' | null {
  const s = lower(c);
  if (!s) return null;
  if (/critical|urgent|asap|highest|top/.test(s)) return 'urgent';
  if (/high/.test(s)) return 'high';
  if (/med|normal/.test(s)) return 'medium';
  if (/low/.test(s)) return 'low';
  return null;
}

export const isDoneStatus = (s: string) => /^(done|complete(d)?|finished|closed|delivered|approved|live|launched|shipped)\b/i.test(s.trim());

const STATUS_COLORS: [RegExp, string][] = [
  [/^(done|complete|finished|closed|delivered|approved|live|launched|shipped)/i, '#30a46c'],
  [/working|progress|doing|active|started/i, '#f5a524'],
  [/stuck|blocked|on hold|waiting/i, '#e5484d'],
  [/review|feedback|client/i, '#8e4ec6'],
  [/^(to ?do|not started|new|backlog|open|planned)/i, '#8b8d98'],
];
const PALETTE = ['#0090ff', '#12a594', '#d6409f', '#5b5bd6', '#f76b15', '#8b8d98'];
/** Colour a Monday.com status gets on import; `i` picks a palette colour for unrecognised ones. */
export const statusColor = (name: string, i = 0) => STATUS_COLORS.find(([re]) => re.test(name))?.[1] ?? PALETTE[i % PALETTE.length];
const GROUP_COLORS = ['#8f52c4', '#0090ff', '#12a594', '#f5a524', '#d6409f', '#30a46c', '#e5484d', '#5b5bd6'];

export interface ImportBody {
  name: string;
  description: string;
  color: string;
  statuses: { name: string; color: string; is_done: boolean }[];
  groups: { name: string; color: string }[];
  tasks: {
    group: string; status: string | null; title: string; description: string;
    assignee_id: number | null; priority: 'low' | 'medium' | 'high' | 'urgent' | null;
    start_date: string | null; due_date: string | null;
    subtasks: { title: string; done: boolean }[];
    comments: { body: string; user_id: number | null; created_at: string | null }[];
  }[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Builds the import request. `people` maps a Monday.com name to an Orchestr8 user id (or null). */
export function toImportBody(board: MondayBoard, people: Record<string, number | null>, name = board.name): ImportBody {
  const { map } = board;
  // Statuses: Monday's own, in the order they appear, with an empty status becoming "To do"
  // and a done status added if the board had none.
  const names = [...board.statuses];
  const hasBlank = board.items.some((it) => !text(it.values[map.status ?? '']));
  if (hasBlank || names.length === 0) names.unshift('To do');
  if (!names.some(isDoneStatus)) names.push('Done');
  let p = 0;
  const statuses = uniq(names.map((n) => clip(n, 40))).map((n) => {
    const known = STATUS_COLORS.some(([re]) => re.test(n));
    return { name: n, color: statusColor(n, known ? 0 : p++), is_done: isDoneStatus(n) };
  });
  // Put "To do"-like statuses first and done ones last, keeping Monday's order otherwise.
  const rank = (s: { name: string; is_done: boolean }) => (s.is_done ? 2 : /^(to ?do|not started|new|backlog)/i.test(s.name) ? 0 : 1);
  statuses.sort((a, b) => rank(a) - rank(b));

  const who = (c: Cell) => {
    for (const n of splitPeople(c)) { const id = people[n]; if (id != null) return id; }
    return null;
  };
  const describe = (values: Record<string, Cell>) => {
    const parts: string[] = [];
    for (const c of map.description) if (text(values[c])) parts.push(text(values[c]));
    const extra = map.extra.filter((c) => text(values[c])).map((c) => `${c}: ${text(values[c])}`);
    if (extra.length) parts.push(extra.join('\n'));
    return clip(parts.join('\n\n'), 20000);
  };

  const tasks = board.items.map((it) => {
    let [start, due] = map.timeline ? toRange(it.values[map.timeline]) : [null, null];
    if (map.start && toDate(it.values[map.start])) start = toDate(it.values[map.start]);
    if (map.due && toDate(it.values[map.due])) due = toDate(it.values[map.due]);
    if (start && !due) due = start;
    const status = text(it.values[map.status ?? '']);
    const subStatusCol = (values: Record<string, Cell>) => Object.keys(values).find((k) => /status/i.test(k));
    return {
      group: clip(it.group, 60),
      status: status ? clip(status, 40) : (hasBlank || board.statuses.length === 0 ? 'To do' : null),
      title: clip(it.title, 200),
      description: describe(it.values),
      assignee_id: map.person ? who(it.values[map.person]) : null,
      priority: map.priority ? toPriority(it.values[map.priority]) : null,
      start_date: start,
      due_date: due,
      subtasks: it.subitems.slice(0, 200).map((s) => {
        const col = subStatusCol(s.values);
        return { title: clip(s.title, 200), done: col ? isDoneStatus(text(s.values[col])) : false };
      }),
      comments: it.updates.slice(0, 200).map((u) => {
        const id = people[u.author] ?? null;
        return { body: clip(id != null || !u.author ? u.body : `${u.author}: ${u.body}`, 5000), user_id: id, created_at: u.date };
      }),
    };
  });

  return {
    name: clip(name.trim() || board.name, 80),
    description: 'Imported from Monday.com',
    color: '#8f52c4',
    statuses,
    groups: board.groups.map((g, i) => ({ name: clip(g, 60), color: GROUP_COLORS[i % GROUP_COLORS.length] })),
    tasks,
  };
}

/** Best guess of which Orchestr8 user a Monday.com name refers to: full name, then first name. */
export function guessPerson(name: string, users: { id: number; name: string }[]): number | null {
  const n = name.trim().toLowerCase();
  const full = users.find((u) => u.name.trim().toLowerCase() === n);
  if (full) return full.id;
  const first = n.split(/\s+/)[0];
  const matches = users.filter((u) => u.name.trim().toLowerCase().split(/\s+/)[0] === first);
  return matches.length === 1 ? matches[0].id : null;
}

/** Minimal CSV reader (quoted fields, commas or semicolons) for boards exported as CSV. */
export function parseCsv(input: string): Rows {
  const textIn = input.replace(/^﻿/, '');
  const firstLine = textIn.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: Rows = [];
  let row: Cell[] = [], field = '', quoted = false;
  for (let i = 0; i < textIn.length; i++) {
    const ch = textIn[i];
    if (quoted) {
      if (ch === '"' && textIn[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && textIn[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
