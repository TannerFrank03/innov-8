import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, useTask } from '../api';
import type { Activity, BoardData, Comment, Subtask } from '../types';
import { PRIORITIES, timeAgo } from '../util';
import { useBoardCtx } from '../views/BoardPage';
import { Avatar, ConfirmButton, ErrorState, Spinner, useToast } from './ui';

export default function TaskDrawer({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const detail = useTask(taskId);
  const { data } = useBoardCtx();
  const boardTask = data.tasks.find((t) => t.id === taskId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay overlay-drawer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Task details">
        <header className="drawer-head">
          <span className="muted small">Task #{taskId}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close task">✕</button>
        </header>
        {detail.isPending && <Spinner label="Loading task" />}
        {detail.isError && <ErrorState error={detail.error} onRetry={() => detail.refetch()} />}
        {detail.data && boardTask && (
          <DrawerBody taskId={taskId} subtasks={detail.data.subtasks} comments={detail.data.comments}
            activity={detail.data.activity} onClose={onClose} />
        )}
        {detail.data && !boardTask && <ErrorState error={new Error('This task belongs to another board.')} />}
      </aside>
    </div>
  );
}

function DrawerBody({ taskId, subtasks, comments, activity, onClose }:
  { taskId: number; subtasks: Subtask[]; comments: Comment[]; activity: Activity[]; onClose: () => void }) {
  const { data, users, update, canEdit } = useBoardCtx();
  const task = data.tasks.find((t) => t.id === taskId)!;
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');

  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description), [task.description]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['task', taskId] });
    qc.invalidateQueries({ queryKey: ['board', task.board_id] });
  };
  const run = async (p: Promise<unknown>, fail: string) => {
    try { await p; refresh(); } catch (e) { toast(e instanceof Error ? e.message : fail, 'error'); }
  };

  async function remove() {
    try {
      await api(`/tasks/${taskId}`, { method: 'DELETE' });
      qc.setQueryData<BoardData>(['board', task.board_id], (d) => d && { ...d, tasks: d.tasks.filter((t) => t.id !== taskId) });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
      toast('Task deleted');
      onClose();
    } catch {
      toast('Could not delete the task.', 'error');
    }
  }

  const toggleLabel = (id: number) =>
    update(taskId, { label_ids: task.label_ids.includes(id) ? task.label_ids.filter((x) => x !== id) : [...task.label_ids, id] });

  return (
    <div className="drawer-body">
      <textarea id="task-title" className="drawer-title" rows={1} value={title} aria-label="Task name" readOnly={!canEdit}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())}
        onBlur={() => { const v = title.trim(); if (v && v !== task.title) update(taskId, { title: v }); else setTitle(task.title); }} />

      {!canEdit && <p className="banner banner-info">You can view this task and comment on it.</p>}
      <fieldset className="plain-fieldset" disabled={!canEdit}>
      <dl className="props">
        <dt><label htmlFor="d-status">Status</label></dt>
        <dd>
          <select id="d-status" value={task.status_id} onChange={(e) => update(taskId, { status_id: Number(e.target.value) })}>
            {data.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </dd>
        <dt><label htmlFor="d-assignee">Owner</label></dt>
        <dd className="owner-cell">
          <Avatar user={users.find((u) => u.id === task.assignee_id)} size={22} />
          <select id="d-assignee" value={task.assignee_id ?? ''}
            onChange={(e) => update(taskId, { assignee_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </dd>
        <dt><label htmlFor="d-priority">Priority</label></dt>
        <dd>
          <select id="d-priority" value={task.priority ?? ''}
            onChange={(e) => update(taskId, { priority: (e.target.value || null) as typeof task.priority })}>
            <option value="">None</option>
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </dd>
        <dt><label htmlFor="d-group">Group</label></dt>
        <dd>
          <select id="d-group" value={task.group_id} onChange={(e) => update(taskId, { group_id: Number(e.target.value) })}>
            {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </dd>
        <dt><label htmlFor="d-start">Dates</label></dt>
        <dd className="dates">
          <input id="d-start" type="date" aria-label="Start date" value={task.start_date ?? ''} max={task.due_date ?? undefined}
            onChange={(e) => update(taskId, { start_date: e.target.value || null })} />
          <span aria-hidden>→</span>
          <input id="d-due" type="date" aria-label="Due date" value={task.due_date ?? ''} min={task.start_date ?? undefined}
            onChange={(e) => update(taskId, { due_date: e.target.value || null })} />
        </dd>
        <dt>Labels</dt>
        <dd className="chips">
          {data.labels.map((l) => (
            <button key={l.id} type="button" className={`chip chip-toggle${task.label_ids.includes(l.id) ? ' is-on' : ''}`}
              style={{ ['--c' as string]: l.color }} aria-pressed={task.label_ids.includes(l.id)} onClick={() => toggleLabel(l.id)}>
              {l.name}
            </button>
          ))}
          {data.labels.length === 0 && <span className="muted small">Add labels in Board settings.</span>}
        </dd>
      </dl>

      <section className="drawer-section">
        <h3><label htmlFor="d-desc">Description</label></h3>
        <textarea id="d-desc" rows={5} value={description} placeholder="Brief, links, client notes…"
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== task.description && update(taskId, { description })} />
      </section>

      <Subtasks taskId={taskId} items={subtasks} run={run} />
      </fieldset>

      <section className="drawer-section">
        <div className="tabs tabs-sm" role="tablist">
          <button role="tab" aria-selected={tab === 'comments'} className={`tab${tab === 'comments' ? ' is-on' : ''}`} onClick={() => setTab('comments')}>
            Comments ({comments.length})
          </button>
          <button role="tab" aria-selected={tab === 'activity'} className={`tab${tab === 'activity' ? ' is-on' : ''}`} onClick={() => setTab('activity')}>
            Activity
          </button>
        </div>
        {tab === 'comments' ? <Comments taskId={taskId} items={comments} run={run} /> : <ActivityList items={activity} />}
      </section>

      <footer className="drawer-foot">
        <span className="muted small">Created {timeAgo(task.created_at)}{task.completed_at ? ` · done ${timeAgo(task.completed_at)}` : ''}</span>
        {canEdit && <ConfirmButton onConfirm={remove} confirmText="Click again to delete">Delete task</ConfirmButton>}
      </footer>
    </div>
  );
}

type Run = (p: Promise<unknown>, fail: string) => Promise<void>;

function Subtasks({ taskId, items, run }: { taskId: number; items: Subtask[]; run: Run }) {
  const [title, setTitle] = useState('');
  const done = items.filter((s) => s.done).length;
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await run(api(`/tasks/${taskId}/subtasks`, { method: 'POST', body: { title } }), 'Could not add the subtask.');
    setTitle('');
  }
  return (
    <section className="drawer-section">
      <h3>Subtasks {items.length > 0 && <span className="count">{done}/{items.length}</span>}</h3>
      <ul className="subtasks">
        {items.map((s) => (
          <li key={s.id}>
            <label className="check">
              <input id={`sub-${s.id}`} type="checkbox" checked={!!s.done}
                onChange={(e) => run(api(`/subtasks/${s.id}`, { method: 'PATCH', body: { done: e.target.checked } }), 'Could not update.')} />
              <span className={s.done ? 'strike' : ''}>{s.title}</span>
            </label>
            <button className="icon-btn icon-btn-sm" aria-label={`Remove ${s.title}`}
              onClick={() => run(api(`/subtasks/${s.id}`, { method: 'DELETE' }), 'Could not remove.')}>✕</button>
          </li>
        ))}
      </ul>
      <form onSubmit={add}>
        <input id="new-subtask" placeholder="+ Add a subtask" aria-label="New subtask" value={title} onChange={(e) => setTitle(e.target.value)} />
      </form>
    </section>
  );
}

function Comments({ taskId, items, run }: { taskId: number; items: Comment[]; run: Run }) {
  const [body, setBody] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    await run(api(`/tasks/${taskId}/comments`, { method: 'POST', body: { body } }), 'Could not post the comment.');
    setBody('');
  }
  return (
    <div className="comments">
      {items.length === 0 && <p className="muted small">No comments yet. Use comments for feedback and decisions.</p>}
      {items.map((c) => (
        <article key={c.id} className="comment">
          <Avatar user={c.user_name ? { name: c.user_name, color: c.user_color ?? '#888888' } : null} size={26} />
          <div>
            <header><b>{c.user_name ?? 'Former member'}</b> <span className="muted small">{timeAgo(c.created_at)}</span></header>
            <p>{c.body}</p>
          </div>
        </article>
      ))}
      <form onSubmit={add} className="comment-form">
        <textarea id="new-comment" rows={2} placeholder="Write a comment…" aria-label="New comment" value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && add(e)} />
        <button className="btn btn-primary" disabled={!body.trim()}>Comment</button>
      </form>
    </div>
  );
}

export function describeActivity(a: Activity): string {
  const d = a.detail;
  switch (a.action) {
    case 'task.created': return `created ${a.task_title ?? d.title ?? 'a task'}`;
    case 'task.status': return `moved ${a.task_title ? `${a.task_title} ` : ''}from ${d.from} to ${d.to}`;
    case 'task.assigned': return d.to ? `assigned ${a.task_title ?? 'a task'} to ${d.to}` : `unassigned ${a.task_title ?? 'a task'}`;
    case 'task.due': return d.to ? `set ${a.task_title ?? 'the'} due date to ${d.to}` : `cleared the due date`;
    case 'task.renamed': return `renamed “${d.from}” to “${d.to}”`;
    case 'task.commented': return `commented on ${a.task_title ?? 'a task'}`;
    case 'task.deleted': return `deleted ${d.title}`;
    case 'board.created': return `created this board`;
    case 'board.archived': return `archived this board`;
    case 'board.restored': return `restored this board`;
    default: return a.action;
  }
}

function ActivityList({ items }: { items: Activity[] }) {
  if (items.length === 0) return <p className="muted small">No activity yet.</p>;
  return (
    <ul className="activity">
      {items.map((a) => (
        <li key={a.id}><b>{a.user_name ?? 'Someone'}</b> {describeActivity({ ...a, task_title: null })} <span className="muted small">{timeAgo(a.created_at)}</span></li>
      ))}
    </ul>
  );
}
