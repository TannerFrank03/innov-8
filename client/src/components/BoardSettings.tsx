import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, useAuth } from '../api';
import type { Group, Label, Status } from '../types';
import { SWATCHES } from '../util';
import { useBoardCtx } from '../views/BoardPage';
import { ColorPicker, ConfirmButton, Field, Modal, useToast } from './ui';

export default function BoardSettings({ onClose }: { onClose: () => void }) {
  const { data, access } = useBoardCtx();
  // Renaming, archiving and deleting a project is for the studio team; guests who can edit shape its columns.
  const tabs = access === 'team' ? (['board', 'statuses', 'groups', 'labels'] as const) : (['statuses', 'groups', 'labels'] as const);
  const [tab, setTab] = useState<'board' | 'statuses' | 'groups' | 'labels'>(tabs[0]);
  return (
    <Modal title="Board settings" onClose={onClose} wide>
      <div className="tabs tabs-sm" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' is-on' : ''}`} onClick={() => setTab(t)}>
            {t === 'board' ? 'Board' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'board' && <BoardTab onClose={onClose} />}
      {tab === 'statuses' && <ListEditor kind="statuses" items={data.statuses} />}
      {tab === 'groups' && <ListEditor kind="groups" items={data.groups} />}
      {tab === 'labels' && <ListEditor kind="labels" items={data.labels} />}
    </Modal>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  const { data } = useBoardCtx();
  return () => {
    qc.invalidateQueries({ queryKey: ['board', data.board.id] });
    qc.invalidateQueries({ queryKey: ['boards'] });
  };
}

function BoardTab({ onClose }: { onClose: () => void }) {
  const { data } = useBoardCtx();
  const b = data.board;
  const auth = useAuth();
  const refresh = useRefresh();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: b.name, description: b.description, color: b.color });
  const [error, setError] = useState('');

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError('The board needs a name.');
    try {
      await api(`/boards/${b.id}`, { method: 'PATCH', body: form });
      refresh();
      toast('Board saved');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
  }
  async function setArchived(archived: boolean) {
    await api(`/boards/${b.id}`, { method: 'PATCH', body: { archived } });
    refresh();
    toast(archived ? 'Board archived. Find it under Settings.' : 'Board restored');
    if (archived) { onClose(); navigate('/'); }
  }
  async function destroy() {
    await api(`/boards/${b.id}`, { method: 'DELETE' });
    refresh();
    toast('Board deleted');
    onClose();
    navigate('/');
  }

  return (
    <form className="stack" onSubmit={save}>
      <Field label="Board name" error={error}>
        <input id="bs-name" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Description">
        <textarea id="bs-desc" rows={2} maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field label="Colour"><ColorPicker value={form.color} onChange={(color) => setForm({ ...form, color })} colors={SWATCHES} /></Field>
      <div className="row-end"><button className="btn btn-primary">Save board</button></div>
      <hr />
      <div className="danger-zone">
        {b.archived ? (
          <>
            <button type="button" className="btn" onClick={() => setArchived(false)}>Restore board</button>
            {auth.data?.user?.role === 'owner' && (
              <ConfirmButton onConfirm={destroy} confirmText="Delete forever? Click again">Delete board permanently</ConfirmButton>
            )}
          </>
        ) : (
          <ConfirmButton className="btn" onConfirm={() => setArchived(true)} confirmText="Click again to archive">Archive board</ConfirmButton>
        )}
      </div>
    </form>
  );
}

type Kind = 'statuses' | 'groups' | 'labels';
type Item = Status | Group | Label;

function ListEditor({ kind, items }: { kind: Kind; items: Item[] }) {
  const { data } = useBoardCtx();
  const refresh = useRefresh();
  const toast = useToast();
  const [newName, setNewName] = useState('');
  const singular = kind === 'statuses' ? 'status' : kind.slice(0, -1);
  const ordered = kind !== 'labels';

  const call = async (p: Promise<unknown>) => {
    try { await p; refresh(); } catch (e) { toast(e instanceof Error ? e.message : 'Could not save.', 'error'); }
  };
  const patch = (item: Item, body: Record<string, unknown>) => call(api(`/${kind}/${item.id}`, { method: 'PATCH', body }));

  function move(index: number, dir: -1 | 1) {
    const other = items[index + dir] as Status | Group | undefined;
    const item = items[index] as Status | Group;
    if (!other) return;
    // Swap positions with the neighbour.
    call(Promise.all([
      api(`/${kind}/${item.id}`, { method: 'PATCH', body: { position: other.position } }),
      api(`/${kind}/${other.id}`, { method: 'PATCH', body: { position: item.position } }),
    ]));
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await call(api(`/boards/${data.board.id}/${kind}`, {
      method: 'POST', body: { name: newName.trim(), color: SWATCHES[items.length % SWATCHES.length] },
    }));
    setNewName('');
  }

  return (
    <div className="stack">
      {kind === 'statuses' && <p className="muted small">Statuses are the Kanban columns. Mark the final one as “done” so finished work is counted. A WIP limit warns when a column has too many cards.</p>}
      {kind === 'groups' && <p className="muted small">Groups are the sections in Table and Timeline view, for example “This week” or one per project phase.</p>}
      <ul className="edit-list">
        {items.map((item, i) => (
          <EditRow key={item.id} item={item} kind={kind} index={i} count={items.length} ordered={ordered}
            others={items.filter((x) => x.id !== item.id)}
            onPatch={(body) => patch(item, body)} onMove={(d) => move(i, d)}
            onDelete={(moveTo) => call(api(`/${kind}/${item.id}${moveTo ? `?moveTo=${moveTo}` : ''}`, { method: 'DELETE' }))} />
        ))}
      </ul>
      <form onSubmit={add} className="row">
        <input id={`new-${kind}`} placeholder={`New ${singular} name`} aria-label={`New ${singular}`} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn">Add {singular}</button>
      </form>
    </div>
  );
}

function EditRow({ item, kind, index, count, ordered, others, onPatch, onMove, onDelete }: {
  item: Item; kind: Kind; index: number; count: number; ordered: boolean; others: Item[];
  onPatch: (b: Record<string, unknown>) => void; onMove: (d: -1 | 1) => void; onDelete: (moveTo?: number) => void;
}) {
  const [name, setName] = useState(item.name);
  const [showColors, setShowColors] = useState(false);
  const [moveTo, setMoveTo] = useState<number | undefined>(others[0]?.id);
  const status = kind === 'statuses' ? (item as Status) : null;
  const needsMove = kind !== 'labels';

  return (
    <li className="edit-row">
      <div className="edit-main">
        <button type="button" className="swatch" style={{ background: item.color }} aria-label="Change colour" onClick={() => setShowColors(!showColors)} />
        <input id={`${kind}-name-${item.id}`} aria-label="Name" value={name} onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== item.name && onPatch({ name: name.trim() })} />
        {status && (
          <>
            <label className="inline-field">WIP
              <input id={`wip-${item.id}`} type="number" min={1} max={999} className="num" value={status.wip_limit ?? ''} placeholder="–"
                onChange={(e) => onPatch({ wip_limit: e.target.value ? Number(e.target.value) : null })} />
            </label>
            <label className="check"><input id={`done-${item.id}`} type="checkbox" checked={!!status.is_done}
              onChange={(e) => onPatch({ is_done: e.target.checked })} /> Done</label>
          </>
        )}
        {ordered && (
          <span className="order-btns">
            <button type="button" className="icon-btn icon-btn-sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">↑</button>
            <button type="button" className="icon-btn icon-btn-sm" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">↓</button>
          </span>
        )}
      </div>
      {showColors && <ColorPicker value={item.color} colors={SWATCHES} onChange={(c) => { onPatch({ color: c }); setShowColors(false); }} />}
      {(!needsMove || others.length > 0) && (
        <div className="edit-delete">
          {needsMove && (
            <label className="inline-field">Move its tasks to
              <select id={`move-${item.id}`} value={moveTo} onChange={(e) => setMoveTo(Number(e.target.value))}>
                {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          )}
          <ConfirmButton className="btn btn-ghost btn-sm text-danger" onConfirm={() => onDelete(needsMove ? moveTo : undefined)}
            confirmText="Click again to delete">Delete</ConfirmButton>
        </div>
      )}
    </li>
  );
}
