import type { Task } from '../types';
import { priorityInfo, relativeDue } from '../util';
import { useBoardCtx } from '../views/BoardPage';
import { Avatar } from './ui';

export default function TaskCard({ task, done }: { task: Task; done: boolean }) {
  const { data, userById } = useBoardCtx();
  const labels = data.labels.filter((l) => task.label_ids.includes(l.id));
  const due = relativeDue(task.due_date, done);
  const prio = priorityInfo(task.priority);
  return (
    <div className={`card${done ? ' is-done' : ''}`}>
      {labels.length > 0 && (
        <div className="card-labels">
          {labels.map((l) => <span key={l.id} className="chip" style={{ ['--c' as string]: l.color }}>{l.name}</span>)}
        </div>
      )}
      <div className="card-title">{task.title}</div>
      <div className="card-meta">
        {prio && <span className="prio" style={{ color: prio.color }} title="Priority">● {prio.label}</span>}
        {due && <span className={`due due-${due.tone}`}>{due.text}</span>}
        {task.subtask_count > 0 && <span className="meta-ic" title="Subtasks done">☑ {task.subtask_done}/{task.subtask_count}</span>}
        {task.comment_count > 0 && <span className="meta-ic" title="Comments">💬 {task.comment_count}</span>}
        <span className="spacer" />
        <Avatar user={task.assignee_id ? userById.get(task.assignee_id) : null} size={24} />
      </div>
    </div>
  );
}
