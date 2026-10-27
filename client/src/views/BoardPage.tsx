import { createContext, useContext, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useBoard, useCreateTask, useUpdateTask } from '../api';
import { EmptyState, ErrorState, Spinner, useToast } from '../components/ui';
import TaskDrawer from '../components/TaskDrawer';
import BoardSettings from '../components/BoardSettings';
import ActivityPanel from '../components/ActivityPanel';
import ShareModal from '../components/ShareModal';
import type { Access, BoardData, Person, Task, TaskPatch } from '../types';
import TableView from './TableView';
import KanbanView from './KanbanView';
import TimelineView from './TimelineView';
import CalendarView from './CalendarView';

const VIEWS = [
  { id: 'table', label: 'Table' },
  { id: 'kanban', label: 'Kanban' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'calendar', label: 'Calendar' },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

interface BoardCtx {
  data: BoardData;
  tasks: Task[]; // after filters
  users: Person[]; // everyone who can work on this project
  userById: Map<number, Person>;
  access: Access;
  canEdit: boolean; // false for view-only guests: they can read and comment
  openTask: (id: number) => void;
  update: (id: number, patch: TaskPatch) => void;
  create: (body: TaskPatch & { title: string }) => Promise<Task>;
}
const Ctx = createContext<BoardCtx | null>(null);
export const useBoardCtx = () => useContext(Ctx)!;

interface Filters { q: string; assignee: string; label: string; hideDone: boolean }

export default function BoardPage() {
  const boardId = Number(useParams().boardId);
  const [params, setParams] = useSearchParams();
  const board = useBoard(boardId);
  const toast = useToast();
  const updateM = useUpdateTask(boardId);
  const createM = useCreateTask(boardId);
  const [filters, setFilters] = useState<Filters>({ q: '', assignee: '', label: '', hideDone: false });
  const [panel, setPanel] = useState<'settings' | 'activity' | 'share' | null>(null);

  const view: ViewId = (VIEWS.find((v) => v.id === params.get('view'))?.id ?? readStoredView()) as ViewId;
  const taskParam = params.get('task');
  const openTaskId = taskParam ? Number(taskParam) : null;

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v == null) next.delete(k); else next.set(k, v);
    setParams(next, { replace: k === 'view' });
  };

  const ctx = useMemo<BoardCtx | null>(() => {
    if (!board.data) return null;
    const doneIds = new Set(board.data.statuses.filter((s) => s.is_done).map((s) => s.id));
    const q = filters.q.trim().toLowerCase();
    const tasks = board.data.tasks.filter((t) =>
      (!q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)) &&
      (!filters.assignee || (filters.assignee === 'none' ? t.assignee_id == null : t.assignee_id === Number(filters.assignee))) &&
      (!filters.label || t.label_ids.includes(Number(filters.label))) &&
      (!filters.hideDone || !doneIds.has(t.status_id)));
    const list = board.data.people ?? [];
    return {
      data: board.data,
      tasks,
      users: list,
      userById: new Map(list.map((u) => [u.id, u])),
      access: board.data.access,
      canEdit: board.data.access !== 'viewer',
      openTask: (id) => setParam('task', String(id)),
      update: (id, patch) => updateM.mutate({ id, patch }),
      create: (body) => createM.mutateAsync(body),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.data, filters, params]);

  if (board.isPending) return <Spinner label="Loading board" />;
  if (board.isError) return <ErrorState error={board.error} onRetry={() => board.refetch()} />;
  if (!ctx) return null;
  const { board: b, labels } = board.data;
  const filtering = !!(filters.q || filters.assignee || filters.label || filters.hideDone);

  return (
    <Ctx.Provider value={ctx}>
      <div className="page page-board">
        <header className="board-head">
          <div className="board-title">
            <span className="dot dot-lg" style={{ background: b.color }} />
            <div>
              <h1>{b.name}{b.archived ? <span className="tag">Archived</span> : null}</h1>
              <div className="board-meta">
                <button type="button" className="project-id" title="Copy project ID" onClick={() => {
                  navigator.clipboard?.writeText(b.code).then(() => toast(`Copied ${b.code}`), () => toast(b.code));
                }}>{b.code} <span aria-hidden>⧉</span></button>
                {ctx.access !== 'team' && <span className="tag">{ctx.access === 'editor' ? 'Shared with you · can edit' : 'Shared with you · view & comment'}</span>}
                {b.description && <span className="muted">{b.description}</span>}
              </div>
            </div>
          </div>
          <div className="board-actions">
            {ctx.access === 'team' && <button className="btn" onClick={() => setPanel('share')}>Share</button>}
            <button className="btn" onClick={() => setPanel('activity')}>Activity</button>
            {ctx.canEdit && <button className="btn" onClick={() => setPanel('settings')}>Board settings</button>}
            {ctx.canEdit && (
              <button className="btn btn-primary" onClick={async () => {
                const t = await ctx.create({ title: 'New task' });
                ctx.openTask(t.id);
              }}>+ New task</button>
            )}
          </div>
        </header>

        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Board views">
            {VIEWS.map((v) => (
              <button key={v.id} role="tab" aria-selected={view === v.id} className={`tab${view === v.id ? ' is-on' : ''}`}
                onClick={() => { storeView(v.id); setParam('view', v.id); }}>{v.label}</button>
            ))}
          </div>
          <div className="filters">
            <input id="board-filter" type="search" placeholder="Filter tasks" aria-label="Filter tasks on this board"
              value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
            <select id="filter-assignee" aria-label="Filter by person" value={filters.assignee}
              onChange={(e) => setFilters({ ...filters, assignee: e.target.value })}>
              <option value="">Everyone</option>
              {ctx.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              <option value="none">Unassigned</option>
            </select>
            <select id="filter-label" aria-label="Filter by label" value={filters.label}
              onChange={(e) => setFilters({ ...filters, label: e.target.value })}>
              <option value="">All labels</option>
              {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <label className="check">
              <input id="filter-hide-done" type="checkbox" checked={filters.hideDone}
                onChange={(e) => setFilters({ ...filters, hideDone: e.target.checked })} /> Hide done
            </label>
            {filtering && <button className="btn btn-ghost" onClick={() => setFilters({ q: '', assignee: '', label: '', hideDone: false })}>Clear</button>}
          </div>
        </div>

        {board.data.tasks.length === 0 && view !== 'table' && view !== 'kanban' ? (
          <EmptyState title="No tasks on this board yet">Add one with “New task”, or switch to Table or Kanban to add tasks inline.</EmptyState>
        ) : (
          <div className="view">
            {view === 'table' && <TableView />}
            {view === 'kanban' && <KanbanView />}
            {view === 'timeline' && <TimelineView />}
            {view === 'calendar' && <CalendarView />}
          </div>
        )}
      </div>
      {openTaskId != null && <TaskDrawer taskId={openTaskId} onClose={() => setParam('task', null)} />}
      {panel === 'settings' && <BoardSettings onClose={() => setPanel(null)} />}
      {panel === 'activity' && <ActivityPanel boardId={boardId} onClose={() => setPanel(null)} />}
      {panel === 'share' && <ShareModal boardId={boardId} onClose={() => setPanel(null)} />}
    </Ctx.Provider>
  );
}

function readStoredView(): ViewId {
  try {
    const v = localStorage.getItem('i8-view');
    return VIEWS.find((x) => x.id === v)?.id ?? 'kanban';
  } catch { return 'kanban'; }
}
function storeView(v: ViewId) {
  try { localStorage.setItem('i8-view', v); } catch { /* storage unavailable */ }
}
