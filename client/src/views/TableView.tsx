import { useEffect, useState, type FormEvent } from 'react';
import type { Group, Task } from '../types';
import { PRIORITIES, relativeDue, textOn } from '../util';
import { Avatar, useToast } from '../components/ui';
import { useBoardCtx } from './BoardPage';

export default function TableView() {
  const { data, tasks } = useBoardCtx();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="table-wrap">
      {data.groups.map((g) => {
        const rows = tasks.filter((t) => t.group_id === g.id).sort((a, b) => a.position - b.position);
        const isCollapsed = collapsed.has(g.id);
        return (
          <section key={g.id} className="tgroup" style={{ ['--c' as string]: g.color }}>
            <button className="tgroup-head" onClick={() => toggle(g.id)} aria-expanded={!isCollapsed}>
              <span className="caret">{isCollapsed ? '▸' : '▾'}</span>
              <span className="tgroup-name">{g.name}</span>
              <span className="count">{rows.length}</span>
            </button>
            {!isCollapsed && (
              <div className="table-scroll">
                <table className="tasks-table">
                  <thead>
                    <tr>
                      <th scope="col" className="col-title">Task</th>
                      <th scope="col">Status</th>
                      <th scope="col">Owner</th>
                      <th scope="col">Priority</th>
                      <th scope="col">Start</th>
                      <th scope="col">Due</th>
                      <th scope="col">Labels</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => <Row key={t.id} task={t} />)}
                    <AddRow group={g} />
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Row({ task }: { task: Task }) {
  const { data, users, userById, update, openTask } = useBoardCtx();
  const status = data.statuses.find((s) => s.id === task.status_id)!;
  const due = relativeDue(task.due_date, !!status?.is_done);
  const labels = data.labels.filter((l) => task.label_ids.includes(l.id));
  const [title, setTitle] = useState(task.title);
  useEffect(() => setTitle(task.title), [task.title]);
  const saveTitle = () => {
    const v = title.trim();
    if (v && v !== task.title) update(task.id, { title: v }); else setTitle(task.title);
  };

  return (
    <tr className={status?.is_done ? 'is-done' : ''} style={{ ['--c' as string]: status?.color }}>
      <td className="col-title">
        <div className="title-cell">
          <input id={`title-${task.id}`} className="cell-input" value={title} aria-label="Task name"
            onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <button className="open-btn" onClick={() => openTask(task.id)} aria-label={`Open ${task.title}`}>
            Open{task.comment_count ? ` · ${task.comment_count}💬` : ''}
          </button>
        </div>
      </td>
      <td className="cell-status" style={{ background: status?.color, color: textOn(status?.color ?? '#888888') }}>
        <select id={`status-${task.id}`} aria-label="Status" value={task.status_id}
          onChange={(e) => update(task.id, { status_id: Number(e.target.value) })}>
          {data.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </td>
      <td>
        <div className="owner-cell">
          <Avatar user={task.assignee_id ? userById.get(task.assignee_id) : null} size={22} />
          <select id={`assignee-${task.id}`} aria-label="Owner" value={task.assignee_id ?? ''}
            onChange={(e) => update(task.id, { assignee_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </td>
      <td>
        <select id={`priority-${task.id}`} aria-label="Priority" value={task.priority ?? ''}
          onChange={(e) => update(task.id, { priority: (e.target.value || null) as Task['priority'] })}>
          <option value="">—</option>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </td>
      <td>
        <input id={`start-${task.id}`} type="date" aria-label="Start date" value={task.start_date ?? ''}
          max={task.due_date ?? undefined} onChange={(e) => update(task.id, { start_date: e.target.value || null })} />
      </td>
      <td className={due ? `due-${due.tone}` : ''}>
        <input id={`due-${task.id}`} type="date" aria-label="Due date" value={task.due_date ?? ''}
          min={task.start_date ?? undefined} onChange={(e) => update(task.id, { due_date: e.target.value || null })} />
      </td>
      <td>
        <div className="chips">
          {labels.map((l) => <span key={l.id} className="chip" style={{ ['--c' as string]: l.color }}>{l.name}</span>)}
        </div>
      </td>
    </tr>
  );
}

function AddRow({ group }: { group: Group }) {
  const { create } = useBoardCtx();
  const toast = useToast();
  const [title, setTitle] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await create({ title: title.trim(), group_id: group.id });
      setTitle('');
    } catch {
      toast('Could not add the task. Try again.', 'error');
    }
  }
  return (
    <tr className="add-tr">
      <td colSpan={7}>
        <form onSubmit={submit}>
          <input id={`add-${group.id}`} className="cell-input" placeholder="+ Add task" aria-label={`Add task to ${group.name}`}
            value={title} onChange={(e) => setTitle(e.target.value)} />
        </form>
      </td>
    </tr>
  );
}
