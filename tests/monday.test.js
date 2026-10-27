import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import writeXlsxFile from 'write-excel-file/node';
import readXlsxFile, { readSheetNames } from 'read-excel-file/node';
import {
  guessPerson, mapColumns, parseCsv, parseMonday, toDate, toImportBody, toPriority, toRange,
} from '../client/src/import/monday.ts';

// Shaped like Monday.com's "Export board to Excel" (table + subitems), with an Updates tab.
const MAIN = [
  ['SAICRA Website'],
  ['Board for the SAICRA website rebuild'],
  [],
  ['Discovery'],
  ['Name', 'Subitems', 'Person', 'Status', 'Timeline', 'Priority', 'Notes', 'Budget'],
  ['Kickoff call', '', 'Tanner Frank', 'Done', '2026-11-02 - 2026-11-03', 'High', 'Agenda in Drive', 1500],
  ['Sitemap', 'Draft, Sign-off', 'Tanner Frank, Mholi Nkabinde', 'Working on it', '2026-11-03 - 2026-11-05', 'Critical ⚠️', '', ''],
  ['', 'Subitems', 'Name', 'Owner', 'Status', 'Date'],
  ['', '', 'Draft sitemap', 'Tanner Frank', 'Done', '2026-11-03'],
  ['', '', 'Client sign-off', 'Tanner Frank', '', '2026-11-05'],
  ['Content from client', '', '', '', '', 'Medium', '', ''],
  [],
  ['Design'],
  ['Name', 'Subitems', 'Person', 'Status', 'Timeline', 'Priority', 'Notes', 'Budget'],
  ['Homepage design', '', 'Mholi', 'Stuck', '2026-11-09 - 2026-11-13', 'Low', 'Waiting on logo', ''],
  ['Logo only item'],
  [],
];
const UPDATES = [
  ['Item ID', 'Item Name', 'Content Type', 'User', 'Created At', 'Update Content'],
  ['1', 'Kickoff call', 'Update', 'Tanner Frank', '2026-11-02 09:15:00', 'Client wants a darker palette'],
  ['2', 'Sitemap', 'Update', 'Someone Else', '2026-11-04 10:00:00', 'Added FAQ page'],
  ['9', 'Deleted item', 'Update', 'Tanner Frank', '2026-11-04 10:00:00', 'Orphan'],
];
const USERS = [{ id: 1, name: 'Tanner Frank' }, { id: 2, name: 'Mholi Nkabinde' }];

describe('Monday.com parser', () => {
  const board = parseMonday(MAIN, UPDATES);

  it('reads the board name, groups and items', () => {
    expect(board.name).toBe('SAICRA Website');
    expect(board.groups).toEqual(['Discovery', 'Design']);
    expect(board.items.map((i) => [i.group, i.title])).toEqual([
      ['Discovery', 'Kickoff call'], ['Discovery', 'Sitemap'], ['Discovery', 'Content from client'],
      ['Design', 'Homepage design'], ['Design', 'Logo only item'],
    ]);
  });

  it('attaches subitems to their parent item', () => {
    const sitemap = board.items.find((i) => i.title === 'Sitemap');
    expect(sitemap.subitems.map((s) => s.title)).toEqual(['Draft sitemap', 'Client sign-off']);
    expect(board.items.find((i) => i.title === 'Content from client').subitems).toEqual([]);
  });

  it('matches columns to fields and keeps the rest for the description', () => {
    expect(board.map).toMatchObject({ status: 'Status', person: 'Person', priority: 'Priority', timeline: 'Timeline' });
    expect(board.map.description).toEqual(['Notes']);
    expect(board.map.extra).toEqual(['Budget']);
    expect(mapColumns(['Owner', 'Stage', 'Due date', 'Start date'])).toMatchObject({
      person: 'Owner', status: 'Stage', due: 'Due date', start: 'Start date',
    });
  });

  it('attaches updates by item name and counts the ones it cannot place', () => {
    expect(board.updatesFound).toBe(3);
    expect(board.updatesUnmatched).toBe(1);
    expect(board.items[0].updates[0]).toMatchObject({ author: 'Tanner Frank', body: 'Client wants a darker palette' });
  });

  it('lists statuses and people', () => {
    expect(board.statuses).toEqual(['Done', 'Working on it', 'Stuck']);
    expect(board.people).toEqual(['Tanner Frank', 'Mholi Nkabinde', 'Someone Else', 'Mholi']);
  });

  it('builds the import body', () => {
    const people = Object.fromEntries(board.people.map((n) => [n, guessPerson(n, USERS)]));
    expect(people).toEqual({ 'Tanner Frank': 1, 'Mholi Nkabinde': 2, 'Someone Else': null, Mholi: 2 });
    const body = toImportBody(board, people);

    expect(body.statuses.map((s) => [s.name, s.is_done])).toEqual([
      ['To do', false], ['Working on it', false], ['Stuck', false], ['Done', true],
    ]);
    const [kickoff, sitemap, content, homepage, logo] = body.tasks;
    expect(kickoff).toMatchObject({
      status: 'Done', assignee_id: 1, priority: 'high', start_date: '2026-11-02', due_date: '2026-11-03',
      description: 'Agenda in Drive\n\nBudget: 1500',
    });
    expect(kickoff.comments[0]).toMatchObject({ user_id: 1, body: 'Client wants a darker palette' });
    expect(sitemap).toMatchObject({ assignee_id: 1, priority: 'urgent' });
    expect(sitemap.subtasks).toEqual([{ title: 'Draft sitemap', done: true }, { title: 'Client sign-off', done: false }]);
    expect(sitemap.comments[0]).toMatchObject({ user_id: null, body: 'Someone Else: Added FAQ page' });
    expect(content).toMatchObject({ status: 'To do', assignee_id: null, priority: 'medium', start_date: null });
    expect(homepage).toMatchObject({ group: 'Design', assignee_id: 2, status: 'Stuck', priority: 'low' });
    expect(logo).toMatchObject({ group: 'Design', title: 'Logo only item', status: 'To do' });
  });
});

describe('value conversion', () => {
  it('reads dates in the formats Monday.com and Excel produce', () => {
    expect(toDate('2026-11-02')).toBe('2026-11-02');
    expect(toDate('02/11/2026')).toBe('2026-11-02');
    expect(toDate('Nov 2, 2026')).toBe('2026-11-02');
    expect(toDate(46328)).toBe('2026-11-02'); // Excel serial date
    expect(toDate(new Date(Date.UTC(2026, 10, 2)))).toBe('2026-11-02');
    expect(toDate('soon')).toBeNull();
    expect(toRange('2026-11-02 - 2026-11-06')).toEqual(['2026-11-02', '2026-11-06']);
    expect(toRange('2026-11-02')).toEqual(['2026-11-02', '2026-11-02']);
  });

  it('maps Monday.com priorities', () => {
    expect(['Critical ⚠️', 'High', 'Medium', 'Low', '', 'whatever'].map(toPriority))
      .toEqual(['urgent', 'high', 'medium', 'low', null, null]);
  });

  it('reads CSV with quotes and semicolons', () => {
    expect(parseCsv('Name;Status\n"Logo; v2";"Done"\r\n"Say ""hi""";\n')).toEqual([
      ['Name', 'Status'], ['Logo; v2', 'Done'], ['Say "hi"', ''],
    ]);
  });
});

describe('real .xlsx file', () => {
  it('reads a Monday-style workbook with an Updates tab', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'i8-xlsx-')), 'board.xlsx');
    const toCells = (rows) => rows.map((r) => r.map((v) => (v === '' || v == null ? null : { value: v })));
    await writeXlsxFile([toCells(MAIN), toCells(UPDATES)], { sheets: ['SAICRA Website', 'Updates'], filePath: file });

    const names = await readSheetNames(file);
    expect(names).toEqual(['SAICRA Website', 'Updates']);
    const main = await readXlsxFile(file, { sheet: 1 });
    const updates = await readXlsxFile(file, { sheet: 2 });
    const board = parseMonday(main, updates);
    expect(board.items).toHaveLength(5);
    expect(board.items[1].subitems).toHaveLength(2);
    expect(board.updatesFound).toBe(3);
    const body = toImportBody(board, { 'Tanner Frank': 1 });
    expect(body.tasks[0]).toMatchObject({ title: 'Kickoff call', start_date: '2026-11-02', due_date: '2026-11-03' });
  });
});
