import { useState, type FormEvent } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Status, Task } from '../types';
import TaskCard from '../components/TaskCard';
import { useToast } from '../components/ui';
import { useBoardCtx } from './BoardPage';

// Kept in sync with server/rules.js
const positionBetween = (a?: number, b?: number) =>
  a == null && b == null ? 1 : a == null ? b! - 1 : b == null ? a + 1 : (a + b) / 2;

export default function KanbanView() {
  const { data, tasks, update } = useBoardCtx();
  const [activeId, setActiveId] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byStatus = (sid: number) => tasks.filter((t) => t.status_id === sid).sort((a, b) => a.position - b.position);
  const active = activeId != null ? tasks.find((t) => t.id === activeId) : null;

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const task = tasks.find((t) => t.id === active.id);
    if (!task) return;
    const overId = String(over.id);
    let statusId: number;
    let index: number;
    if (overId.startsWith('col-')) {
      statusId = Number(overId.slice(4));
      index = byStatus(statusId).filter((t) => t.id !== task.id).length;
    } else {
      const overTask = tasks.find((t) => t.id === Number(overId));
      if (!overTask) return;
      statusId = overTask.status_id;
      const col = byStatus(statusId);
      const overIndex = col.findIndex((t) => t.id === overTask.id);
      const fromIndex = col.findIndex((t) => t.id === task.id);
      // Dragging downward within the same column lands after the hovered card.
      index = fromIndex !== -1 && fromIndex < overIndex ? overIndex + 1 : overIndex;
    }
    const col = byStatus(statusId);
    const before = col.slice(0, index).filter((t) => t.id !== task.id).at(-1);
    const after = col.slice(index).filter((t) => t.id !== task.id)[0];
    const position = positionBetween(before?.position, after?.position);
    if (statusId === task.status_id && position === task.position) return;
    if (statusId === task.status_id && before?.id === prevOf(col, task)?.id && after?.id === nextOf(col, task)?.id) return;
    update(task.id, { status_id: statusId, position });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners}
      onDragStart={(e: DragStartEvent) => setActiveId(Number(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="kanban">
        {data.statuses.map((s) => <Column key={s.id} status={s} tasks={byStatus(s.id)} />)}
      </div>
      <DragOverlay>{active ? <div className="card-drag"><TaskCard task={active} done={false} /></div> : null}</DragOverlay>
    </DndContext>
  );
}

const prevOf = (col: Task[], t: Task) => col[col.findIndex((x) => x.id === t.id) - 1];
const nextOf = (col: Task[], t: Task) => col[col.findIndex((x) => x.id === t.id) + 1];

function Column({ status, tasks }: { status: Status; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${status.id}` });
  const { create } = useBoardCtx();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const over = status.wip_limit != null && tasks.length > status.wip_limit;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setAdding(false);
    try {
      await create({ title: title.trim(), status_id: status.id });
      setTitle('');
    } catch {
      toast('Could not add the task. Try again.', 'error');
    }
  }

  return (
    <section className={`column${isOver ? ' is-over' : ''}${over ? ' is-wip' : ''}`} aria-label={status.name}>
      <header className="column-head" style={{ ['--c' as string]: status.color }}>
        <span className="column-name">{status.name}</span>
        <span className="column-count" title={status.wip_limit ? `WIP limit ${status.wip_limit}` : undefined}>
          {tasks.length}{status.wip_limit ? ` / ${status.wip_limit}` : ''}
        </span>
      </header>
      {over && <div className="wip-warn" role="status">Over the WIP limit. Finish something before starting more.</div>}
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="column-body" ref={setNodeRef}>
          {tasks.map((t) => <SortableCard key={t.id} task={t} done={!!status.is_done} />)}
          {tasks.length === 0 && <div className="column-empty">Drop tasks here</div>}
        </div>
      </SortableContext>
      {adding ? (
        <form onSubmit={add} className="quick-add">
          <input id={`quick-add-${status.id}`} autoFocus value={title} placeholder="Task name, then Enter"
            aria-label={`New task in ${status.name}`} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => !title && setAdding(false)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
        </form>
      ) : (
        <button className="add-row" onClick={() => setAdding(true)}>+ Add task</button>
      )}
    </section>
  );
}

function SortableCard({ task, done }: { task: Task; done: boolean }) {
  const { openTask } = useBoardCtx();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes} {...listeners} role="button" aria-label={`${task.title}. Press space to drag, enter to open.`}
      onClick={() => openTask(task.id)} onKeyDown={(e) => {
        if (e.key === 'Enter') openTask(task.id);
        else listeners?.onKeyDown?.(e);
      }}>
      <TaskCard task={task} done={done} />
    </div>
  );
}
