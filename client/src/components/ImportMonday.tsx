import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, useUsers } from '../api';
import type { Board } from '../types';
import { guessPerson, isDoneStatus, parseCsv, parseMonday, statusColor, toImportBody, type MondayBoard, type Rows } from '../import/monday';
import { Field, Pill } from './ui';

async function readFile(file: File): Promise<MondayBoard> {
  const fallback = file.name.replace(/\.(xlsx|csv)$/i, '');
  if (/\.csv$/i.test(file.name)) return parseMonday(parseCsv(await file.text()), undefined, fallback);
  const { default: readXlsxFile, readSheetNames } = await import('read-excel-file');
  const sheets = await readSheetNames(file);
  const updatesSheet = sheets.findIndex((s) => /update/i.test(s));
  const mainSheet = sheets.findIndex((_, i) => i !== updatesSheet);
  const main = (await readXlsxFile(file, { sheet: mainSheet + 1 })) as Rows;
  const updates = updatesSheet >= 0 ? ((await readXlsxFile(file, { sheet: updatesSheet + 1 })) as Rows) : undefined;
  return parseMonday(main, updates, fallback);
}

export default function ImportMonday({ onClose }: { onClose: () => void }) {
  const users = useUsers();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [board, setBoard] = useState<MondayBoard | null>(null);
  const [name, setName] = useState('');
  const [people, setPeople] = useState<Record<string, number | null>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setBoard(null);
    setBusy(true);
    try {
      const parsed = await readFile(file);
      if (parsed.items.length === 0) {
        setError('No items found in that file. Use the Excel file from Monday.com’s “Export board to Excel”.');
      } else {
        setBoard(parsed);
        setName(parsed.name);
        setPeople(Object.fromEntries(parsed.people.map((p) => [p, guessPerson(p, users.data ?? [])])));
      }
    } catch {
      setError('Could not read that file. Check it’s an .xlsx or .csv exported from Monday.com.');
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!board) return;
    setBusy(true);
    setError('');
    try {
      const created = await api<Board>('/boards/import', { method: 'POST', body: toImportBody(board, people, name) });
      qc.invalidateQueries({ queryKey: ['boards'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
      onClose();
      navigate(`/boards/${created.id}?view=table`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The import failed. Nothing was created; try again.');
      setBusy(false);
    }
  }

  const subitems = board?.items.reduce((n, it) => n + it.subitems.length, 0) ?? 0;
  const m = board?.map;
  const matched: [string, string][] = m ? ([
    [m.status, 'Status'], [m.person, 'Owner'], [m.priority, 'Priority'], [m.timeline, 'Start & due dates'],
    [m.start, 'Start date'], [m.due, 'Due date'], ...m.description.map((c) => [c, 'Description'] as [string, string]),
  ].filter(([c]) => c) as [string, string][]) : [];

  return (
    <div className="stack">
      {!board && (
        <>
          <ol className="steps">
            <li>In Monday.com, open the board and tap <b>⋯ → More actions → Export board to Excel</b>.</li>
            <li>Tick <b>Include updates</b> and <b>Include subitems</b>, then download the file.</li>
            <li>Choose that file here. You’ll see a preview before anything is created.</li>
          </ol>
          <Field label="Monday.com export (.xlsx or .csv)" error={error}>
            <input id="monday-file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
          </Field>
          {busy && <p className="muted small" role="status">Reading the file…</p>}
        </>
      )}

      {board && m && (
        <>
          <Field label="Board name">
            <input id="import-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="import-summary" aria-label="What was found">
            <span><b>{board.groups.length}</b> group{board.groups.length === 1 ? '' : 's'}</span>
            <span><b>{board.items.length}</b> items</span>
            <span><b>{subitems}</b> subitems</span>
            <span><b>{board.updatesFound - board.updatesUnmatched}</b> updates</span>
          </div>
          {board.updatesUnmatched > 0 && (
            <p className="muted small">{board.updatesUnmatched} update{board.updatesUnmatched === 1 ? '' : 's'} belong to items not in this file and will be skipped.</p>
          )}

          <section className="import-section">
            <h3>Columns</h3>
            <ul className="map-list">
              {matched.map(([from, to]) => <li key={`${from}-${to}`}><span>{from}</span><span aria-hidden>→</span><b>{to}</b></li>)}
              <li><span>Name</span><span aria-hidden>→</span><b>Task name</b></li>
            </ul>
            {m.extra.length > 0 && <p className="muted small">Added to each task’s description: {m.extra.join(', ')}.</p>}
          </section>

          {board.statuses.length > 0 && (
            <section className="import-section">
              <h3>Statuses</h3>
              <div className="chips">
                {board.statuses.map((s, i) => <Pill key={s} color={statusColor(s, i)}>{s}{isDoneStatus(s) ? ' ✓' : ''}</Pill>)}
              </div>
              <p className="muted small">These become the board’s Kanban columns; ✓ marks finished work.</p>
            </section>
          )}

          {board.people.length > 0 && (
            <section className="import-section">
              <h3>People</h3>
              <ul className="people-map">
                {board.people.map((p) => (
                  <li key={p}>
                    <label htmlFor={`person-${p}`}>{p}</label>
                    <select id={`person-${p}`} value={people[p] ?? ''}
                      onChange={(e) => setPeople({ ...people, [p]: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">No one</option>
                      {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="import-section">
            <h3>First items</h3>
            <ul className="preview-list">
              {board.items.slice(0, 5).map((it, i) => (
                <li key={i}><span className="muted small">{it.group}</span> {it.title}
                  {it.subitems.length > 0 && <span className="muted small"> · {it.subitems.length} subitems</span>}</li>
              ))}
              {board.items.length > 5 && <li className="muted small">…and {board.items.length - 5} more</li>}
            </ul>
          </section>

          {error && <div className="banner banner-error" role="alert">{error}</div>}
          <div className="row-end">
            <button type="button" className="btn" disabled={busy} onClick={() => { setBoard(null); setError(''); }}>Choose another file</button>
            <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={runImport}>
              {busy ? 'Importing…' : `Import ${board.items.length} items`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
