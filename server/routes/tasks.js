import { Router } from 'express';
import { z } from 'zod';
import { transaction } from '../db.js';
import { badRequest, id, isoDate, name, notFound, parse, forbidden } from '../http.js';
import { logActivity } from '../activity.js';
import { checkDateRange, nextCompletedAt } from '../rules.js';

const priority = z.enum(['low', 'medium', 'high', 'urgent']).nullable();
const taskFields = {
  title: name(200),
  description: z.string().max(20000),
  status_id: z.number().int().positive(),
  group_id: z.number().int().positive(),
  assignee_id: z.number().int().positive().nullable(),
  priority,
  start_date: isoDate.nullable(),
  due_date: isoDate.nullable(),
  position: z.number().finite(),
  label_ids: z.array(z.number().int().positive()).max(20),
};
const createBody = z.object(taskFields).partial().required({ title: true });
const updateBody = z.object(taskFields).partial();

export function taskRoutes(db) {
  const r = Router();
  const now = () => new Date().toISOString();

  const getTask = (taskId) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) throw notFound('Task');
    return task;
  };
  const statusOf = (boardId, statusId) => db.prepare('SELECT * FROM statuses WHERE id = ? AND board_id = ?').get(statusId, boardId);
  const groupOf = (boardId, groupId) => db.prepare('SELECT * FROM task_groups WHERE id = ? AND board_id = ?').get(groupId, boardId);

  function assertRefs(boardId, b) {
    if (b.status_id != null && !statusOf(boardId, b.status_id)) throw badRequest('Unknown status for this board.', { status_id: 'Unknown status' });
    if (b.group_id != null && !groupOf(boardId, b.group_id)) throw badRequest('Unknown group for this board.', { group_id: 'Unknown group' });
    if (b.assignee_id != null && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(b.assignee_id)) {
      throw badRequest('That person is not on the team.', { assignee_id: 'Unknown person' });
    }
    if (b.label_ids?.length) {
      const ok = db.prepare(`SELECT COUNT(*) AS n FROM labels WHERE board_id = ? AND id IN (${b.label_ids.map(() => '?').join(',')})`)
        .get(boardId, ...b.label_ids).n;
      if (ok !== new Set(b.label_ids).size) throw badRequest('Unknown label for this board.', { label_ids: 'Unknown label' });
    }
  }

  const setLabels = (taskId, labelIds) => {
    db.prepare('DELETE FROM task_labels WHERE task_id = ?').run(taskId);
    const add = db.prepare('INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)');
    for (const l of labelIds) add.run(taskId, l);
  };

  const touchBoard = (boardId) =>
    db.prepare("UPDATE boards SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(boardId);

  const taskWithMeta = (taskId) => {
    const task = getTask(taskId);
    const label_ids = db.prepare('SELECT label_id FROM task_labels WHERE task_id = ?').all(taskId).map((x) => x.label_id);
    const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM subtasks WHERE task_id = ?) AS subtask_count,
      (SELECT COUNT(*) FROM subtasks WHERE task_id = ? AND done = 1) AS subtask_done,
      (SELECT COUNT(*) FROM comments WHERE task_id = ?) AS comment_count`).get(taskId, taskId, taskId);
    return { ...task, ...counts, label_ids };
  };

  r.post('/boards/:id/tasks', (req, res) => {
    const boardId = id(req.params.id, 'Board');
    if (!db.prepare('SELECT 1 FROM boards WHERE id = ?').get(boardId)) throw notFound('Board');
    const b = parse(createBody, req.body);
    assertRefs(boardId, b);
    const dateError = checkDateRange(b.start_date, b.due_date);
    if (dateError) throw badRequest(dateError, { start_date: dateError });

    const statusId = b.status_id ?? db.prepare('SELECT id FROM statuses WHERE board_id = ? ORDER BY position LIMIT 1').get(boardId).id;
    const groupId = b.group_id ?? db.prepare('SELECT id FROM task_groups WHERE board_id = ? ORDER BY position LIMIT 1').get(boardId).id;
    const position = b.position ?? (db.prepare('SELECT MAX(position) AS p FROM tasks WHERE board_id = ?').get(boardId).p ?? 0) + 1;
    const done = statusOf(boardId, statusId).is_done;

    const taskId = transaction(db, () => {
      const { lastInsertRowid } = db.prepare(`INSERT INTO tasks
        (board_id, status_id, group_id, title, description, assignee_id, priority, start_date, due_date, position, created_by, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        boardId, statusId, groupId, b.title, b.description ?? '', b.assignee_id ?? null, b.priority ?? null,
        b.start_date ?? null, b.due_date ?? null, position, req.user.id, done ? now() : null);
      if (b.label_ids) setLabels(lastInsertRowid, b.label_ids);
      logActivity(db, { boardId, taskId: lastInsertRowid, userId: req.user.id, action: 'task.created', detail: { title: b.title } });
      touchBoard(boardId);
      return lastInsertRowid;
    });
    res.status(201).json(taskWithMeta(taskId));
  });

  r.get('/tasks/:id', (req, res) => {
    const taskId = id(req.params.id, 'Task');
    const task = taskWithMeta(taskId);
    const subtasks = db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY position').all(taskId);
    const comments = db.prepare(`SELECT c.*, u.name AS user_name, u.color AS user_color FROM comments c
      LEFT JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.id`).all(taskId);
    const activity = db.prepare(`SELECT a.*, u.name AS user_name FROM activity a
      LEFT JOIN users u ON u.id = a.user_id WHERE a.task_id = ? ORDER BY a.id DESC LIMIT 50`).all(taskId)
      .map((a) => ({ ...a, detail: JSON.parse(a.detail) }));
    res.json({ task, subtasks, comments, activity });
  });

  r.patch('/tasks/:id', (req, res) => {
    const taskId = id(req.params.id, 'Task');
    const current = getTask(taskId);
    const b = parse(updateBody, req.body);
    assertRefs(current.board_id, b);
    const start = b.start_date !== undefined ? b.start_date : current.start_date;
    const due = b.due_date !== undefined ? b.due_date : current.due_date;
    const dateError = checkDateRange(start, due);
    if (dateError) throw badRequest(dateError, { [b.start_date !== undefined ? 'start_date' : 'due_date']: dateError });

    const pick = (k) => (b[k] !== undefined ? b[k] : current[k]);
    const fromStatus = statusOf(current.board_id, current.status_id);
    const toStatus = statusOf(current.board_id, pick('status_id'));
    const completedAt = nextCompletedAt({
      wasDone: !!fromStatus.is_done, isDone: !!toStatus.is_done, current: current.completed_at, now: now(),
    });

    transaction(db, () => {
      db.prepare(`UPDATE tasks SET title = ?, description = ?, status_id = ?, group_id = ?, assignee_id = ?, priority = ?,
        start_date = ?, due_date = ?, position = ?, completed_at = ?, updated_at = ? WHERE id = ?`).run(
        pick('title'), pick('description'), pick('status_id'), pick('group_id'), pick('assignee_id'), pick('priority'),
        start, due, pick('position'), completedAt, now(), taskId);
      if (b.label_ids) setLabels(taskId, b.label_ids);

      const log = (action, detail) => logActivity(db, { boardId: current.board_id, taskId, userId: req.user.id, action, detail });
      if (toStatus.id !== fromStatus.id) log('task.status', { from: fromStatus.name, to: toStatus.name });
      if (b.assignee_id !== undefined && b.assignee_id !== current.assignee_id) {
        const who = b.assignee_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(b.assignee_id).name : null;
        log('task.assigned', { to: who });
      }
      if (b.due_date !== undefined && b.due_date !== current.due_date) log('task.due', { to: b.due_date });
      if (b.title !== undefined && b.title !== current.title) log('task.renamed', { from: current.title, to: b.title });
      touchBoard(current.board_id);
    });
    res.json(taskWithMeta(taskId));
  });

  r.delete('/tasks/:id', (req, res) => {
    const taskId = id(req.params.id, 'Task');
    const task = getTask(taskId);
    transaction(db, () => {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
      logActivity(db, { boardId: task.board_id, userId: req.user.id, action: 'task.deleted', detail: { title: task.title } });
    });
    res.status(204).end();
  });

  // ---- Subtasks ----
  r.post('/tasks/:id/subtasks', (req, res) => {
    const taskId = id(req.params.id, 'Task');
    getTask(taskId);
    const b = parse(z.object({ title: name(200) }), req.body);
    const pos = (db.prepare('SELECT MAX(position) AS p FROM subtasks WHERE task_id = ?').get(taskId).p ?? 0) + 1;
    const { lastInsertRowid } = db.prepare('INSERT INTO subtasks (task_id, title, position) VALUES (?, ?, ?)').run(taskId, b.title, pos);
    res.status(201).json(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(lastInsertRowid));
  });

  r.patch('/subtasks/:id', (req, res) => {
    const subId = id(req.params.id, 'Subtask');
    const cur = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(subId);
    if (!cur) throw notFound('Subtask');
    const b = parse(z.object({ title: name(200).optional(), done: z.boolean().optional() }), req.body);
    db.prepare('UPDATE subtasks SET title = ?, done = ? WHERE id = ?')
      .run(b.title ?? cur.title, b.done === undefined ? cur.done : Number(b.done), subId);
    res.json(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(subId));
  });

  r.delete('/subtasks/:id', (req, res) => {
    db.prepare('DELETE FROM subtasks WHERE id = ?').run(id(req.params.id, 'Subtask'));
    res.status(204).end();
  });

  // ---- Comments ----
  r.post('/tasks/:id/comments', (req, res) => {
    const taskId = id(req.params.id, 'Task');
    const task = getTask(taskId);
    const b = parse(z.object({ body: z.string().trim().min(1, 'Write something first').max(5000) }), req.body);
    const { lastInsertRowid } = transaction(db, () => {
      const result = db.prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)').run(taskId, req.user.id, b.body);
      logActivity(db, { boardId: task.board_id, taskId, userId: req.user.id, action: 'task.commented' });
      return result;
    });
    res.status(201).json(db.prepare(`SELECT c.*, u.name AS user_name, u.color AS user_color FROM comments c
      LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(lastInsertRowid));
  });

  r.delete('/comments/:id', (req, res) => {
    const commentId = id(req.params.id, 'Comment');
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
    if (!c) throw notFound('Comment');
    if (c.user_id !== req.user.id && req.user.role !== 'owner') throw forbidden('You can only delete your own comments.');
    db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
    res.status(204).end();
  });

  // ---- Cross-board views ----
  r.get('/my-tasks', (req, res) => {
    const rows = db.prepare(`
      SELECT t.*, b.name AS board_name, b.color AS board_color, s.name AS status_name, s.color AS status_color
      FROM tasks t JOIN boards b ON b.id = t.board_id JOIN statuses s ON s.id = t.status_id
      WHERE t.assignee_id = ? AND s.is_done = 0 AND b.archived = 0
      ORDER BY t.due_date IS NULL, t.due_date, t.position`).all(req.user.id);
    res.json(rows);
  });

  r.get('/search', (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const rows = db.prepare(`
      SELECT t.id, t.title, t.board_id, b.name AS board_name, s.name AS status_name, s.color AS status_color
      FROM tasks t JOIN boards b ON b.id = t.board_id JOIN statuses s ON s.id = t.status_id
      WHERE b.archived = 0 AND (t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')
      ORDER BY t.updated_at DESC LIMIT 20`).all(like, like);
    res.json(rows);
  });

  return r;
}
