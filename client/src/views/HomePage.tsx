import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBoards, useMyTasks } from '../api';
import { EmptyState, ErrorState, Pill, Spinner } from '../components/ui';
import NewBoardModal from '../components/NewBoardModal';
import type { MyTask, User } from '../types';
import { addDays, isoDay, priorityInfo, relativeDue } from '../util';

function bucket(t: MyTask, today: string, weekEnd: string) {
  if (!t.due_date) return 'No date';
  if (t.due_date < today) return 'Overdue';
  if (t.due_date <= weekEnd) return 'Next 7 days';
  return 'Later';
}
const ORDER = ['Overdue', 'Next 7 days', 'Later', 'No date'];

export default function HomePage({ user }: { user: User }) {
  const boards = useBoards();
  const mine = useMyTasks();
  const [creating, setCreating] = useState(false);
  const today = isoDay();
  const weekEnd = isoDay(addDays(new Date(), 7));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const grouped = new Map<string, MyTask[]>();
  for (const t of mine.data ?? []) {
    const k = bucket(t, today, weekEnd);
    grouped.set(k, [...(grouped.get(k) ?? []), t]);
  }
  const overdue = grouped.get('Overdue')?.length ?? 0;
  const thisWeek = grouped.get('Next 7 days')?.length ?? 0;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{greeting}, {user.name.split(' ')[0]}</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New board</button>
      </header>

      <section className="summary" aria-label="Your week">
        <div className="summary-item"><b>{mine.data?.length ?? '–'}</b><span>open tasks for you</span></div>
        <div className="summary-item"><b>{mine.data ? thisWeek : '–'}</b><span>due in the next 7 days</span></div>
        <div className={`summary-item${overdue ? ' is-alert' : ''}`}><b>{mine.data ? overdue : '–'}</b><span>overdue</span></div>
      </section>

      <div className="home-grid">
        <section className="panel" aria-labelledby="my-tasks-h">
          <h2 id="my-tasks-h">My tasks</h2>
          {mine.isPending && <Spinner />}
          {mine.isError && <ErrorState error={mine.error} onRetry={() => mine.refetch()} />}
          {mine.data?.length === 0 && (
            <EmptyState title="Nothing assigned to you">Tasks assigned to you on any board show up here.</EmptyState>
          )}
          {ORDER.filter((k) => grouped.has(k)).map((k) => (
            <div key={k} className="my-group">
              <h3 className={k === 'Overdue' ? 'text-danger' : ''}>{k} <span className="count">{grouped.get(k)!.length}</span></h3>
              <ul className="my-list">
                {grouped.get(k)!.map((t) => {
                  const due = relativeDue(t.due_date, false);
                  const prio = priorityInfo(t.priority);
                  return (
                    <li key={t.id}>
                      <Link to={`/boards/${t.board_id}?task=${t.id}`} className="my-item">
                        <span className="dot" style={{ background: t.board_color }} title={t.board_name} />
                        <span className="my-title">{t.title}</span>
                        <span className="my-meta">
                          {prio && <span className="prio" style={{ color: prio.color }}>{prio.label}</span>}
                          <Pill color={t.status_color}>{t.status_name}</Pill>
                          {due && <span className={`due due-${due.tone}`}>{due.text}</span>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

        <section className="panel" aria-labelledby="boards-h">
          <h2 id="boards-h">Boards</h2>
          {boards.isPending && <Spinner />}
          {boards.isError && <ErrorState error={boards.error} onRetry={() => boards.refetch()} />}
          {boards.data?.length === 0 && (
            <EmptyState title="No boards yet">
              <span>Create one board per client or per stream of work.</span>
              <button className="btn btn-primary" onClick={() => setCreating(true)}>Create your first board</button>
            </EmptyState>
          )}
          <div className="board-cards">
            {boards.data?.map((b) => {
              const pct = b.task_count ? Math.round(((b.done_count ?? 0) / b.task_count) * 100) : 0;
              return (
                <Link key={b.id} to={`/boards/${b.id}`} className="board-card" style={{ ['--c' as string]: b.color }}>
                  <span className="board-card-name">{b.name}</span>
                  {b.description && <span className="board-card-desc">{b.description}</span>}
                  <span className="progress" aria-label={`${pct}% done`}><span style={{ width: `${pct}%` }} /></span>
                  <span className="board-card-meta">
                    {b.done_count}/{b.task_count} done
                    {!!b.overdue_count && <span className="text-danger"> · {b.overdue_count} overdue</span>}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
      {creating && <NewBoardModal onClose={() => setCreating(false)} />}
    </div>
  );
}
