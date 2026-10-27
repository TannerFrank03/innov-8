import { useState } from 'react';
import { addDays, isoDay, startOfWeek } from '../util';
import { useToast } from '../components/ui';
import { useBoardCtx } from './BoardPage';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CalendarView() {
  const { data, tasks, openTask, create, canEdit } = useBoardCtx();
  const toast = useToast();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const gridStart = startOfWeek(month);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = isoDay();
  const byDay = new Map<string, typeof tasks>();
  for (const t of tasks) if (t.due_date) byDay.set(t.due_date, [...(byDay.get(t.due_date) ?? []), t]);
  const undated = tasks.filter((t) => !t.due_date).length;

  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  async function addOn(day: string) {
    try {
      const t = await create({ title: 'New task', due_date: day });
      openTask(t.id);
    } catch {
      toast('Could not add the task. Try again.', 'error');
    }
  }

  return (
    <div className="calendar">
      <div className="view-nav">
        <button className="btn" onClick={() => shift(-1)} aria-label="Previous month">←</button>
        <button className="btn" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
        <button className="btn" onClick={() => shift(1)} aria-label="Next month">→</button>
        <h2 className="view-range">{month.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}</h2>
      </div>
      {undated > 0 && <p className="muted small">{undated} task{undated > 1 ? 's' : ''} without a due date not shown.</p>}
      <div className="cal-scroll">
        <div className="cal-grid" role="grid" aria-label="Tasks by due date">
          {WEEKDAYS.map((d) => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
          {cells.map((d) => {
            const key = isoDay(d);
            const items = byDay.get(key) ?? [];
            const outside = d.getMonth() !== month.getMonth();
            return (
              <div key={key} role="gridcell" className={`cal-cell${outside ? ' is-outside' : ''}${key === today ? ' is-today' : ''}`}>
                <div className="cal-day">
                  <span>{d.getDate()}</span>
                  {canEdit && <button className="cal-add" onClick={() => addOn(key)} aria-label={`Add task due ${key}`}>+</button>}
                </div>
                {items.map((t) => {
                  const s = data.statuses.find((x) => x.id === t.status_id)!;
                  return (
                    <button key={t.id} className={`cal-item${s.is_done ? ' is-done' : ''}`} style={{ ['--c' as string]: s.color }}
                      onClick={() => openTask(t.id)} title={`${t.title} (${s.name})`}>
                      {t.title}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
