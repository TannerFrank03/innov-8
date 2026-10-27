import { useState } from 'react';
import { addDays, daysBetween, isoDay, parseDay, startOfWeek } from '../util';
import { Avatar } from '../components/ui';
import { useBoardCtx } from './BoardPage';

const DAY_W = 34; // px per day
const SPANS = [4, 8, 12] as const;

export default function TimelineView() {
  const { data, tasks, userById, openTask } = useBoardCtx();
  const [weeks, setWeeks] = useState<(typeof SPANS)[number]>(8);
  const [from, setFrom] = useState(() => addDays(startOfWeek(new Date()), -7));
  const days = weeks * 7;
  const to = addDays(from, days - 1);
  const today = parseDay(isoDay());
  const todayOffset = daysBetween(from, today);

  const dated = tasks.filter((t) => t.due_date || t.start_date);
  const undated = tasks.length - dated.length;
  const weekStarts = Array.from({ length: weeks }, (_, i) => addDays(from, i * 7));

  return (
    <div className="timeline">
      <div className="view-nav">
        <button className="btn" onClick={() => setFrom(addDays(from, -7))} aria-label="Earlier">←</button>
        <button className="btn" onClick={() => setFrom(addDays(startOfWeek(new Date()), -7))}>Today</button>
        <button className="btn" onClick={() => setFrom(addDays(from, 7))} aria-label="Later">→</button>
        <span className="view-range">
          {from.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} – {to.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Weeks shown">
          {SPANS.map((s) => (
            <button key={s} className={weeks === s ? 'is-on' : ''} onClick={() => setWeeks(s)} aria-pressed={weeks === s}>{s}w</button>
          ))}
        </div>
      </div>
      {undated > 0 && <p className="muted small">{undated} task{undated > 1 ? 's have' : ' has'} no dates and {undated > 1 ? 'are' : 'is'} not shown. Add a start or due date to place {undated > 1 ? 'them' : 'it'} here.</p>}

      <div className="tl-scroll">
        <div className="tl-grid" style={{ ['--days' as string]: days, ['--dw' as string]: `${DAY_W}px` }}>
          <div className="tl-corner">Task</div>
          <div className="tl-weeks">
            {weekStarts.map((w) => (
              <div key={w.toISOString()} className="tl-week">
                Week of {w.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
              </div>
            ))}
          </div>

          {data.groups.map((g) => {
            const rows = dated.filter((t) => t.group_id === g.id).sort((a, b) =>
              (a.start_date ?? a.due_date!).localeCompare(b.start_date ?? b.due_date!));
            if (rows.length === 0) return null;
            return (
              <div key={g.id} className="tl-section">
                <div className="tl-group" style={{ ['--c' as string]: g.color }}>{g.name}</div>
                {rows.map((t) => {
                  const status = data.statuses.find((s) => s.id === t.status_id)!;
                  const start = parseDay(t.start_date ?? t.due_date!);
                  const end = parseDay(t.due_date ?? t.start_date!);
                  const left = daysBetween(from, start);
                  const len = daysBetween(start, end) + 1;
                  const clippedLeft = Math.max(0, left);
                  const clippedLen = Math.min(days, left + len) - clippedLeft;
                  const visible = clippedLen > 0;
                  return (
                    <div key={t.id} className="tl-row">
                      <button className="tl-label" onClick={() => openTask(t.id)}>
                        <Avatar user={t.assignee_id ? userById.get(t.assignee_id) : null} size={20} />
                        <span>{t.title}</span>
                      </button>
                      <div className="tl-track">
                        {todayOffset >= 0 && todayOffset < days && <span className="tl-today" style={{ left: todayOffset * DAY_W + DAY_W / 2 }} />}
                        {visible ? (
                          <button className={`tl-bar${status.is_done ? ' is-done' : ''}`} onClick={() => openTask(t.id)}
                            style={{ left: clippedLeft * DAY_W + 2, width: clippedLen * DAY_W - 4, background: status.color }}
                            title={`${t.title}: ${t.start_date ?? '…'} → ${t.due_date ?? '…'} (${status.name})`}>
                            <span>{t.title}</span>
                          </button>
                        ) : (
                          <span className="tl-off">{left < 0 ? '← earlier' : 'later →'}</span>
                        )}
                      </div>
                    </div>
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
