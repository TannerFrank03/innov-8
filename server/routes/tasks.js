import { Router } from 'express';
import { z } from 'zod';
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

const COMMENT_SELECT = `SELECT c.*, u.name AS user_name, u.color AS user_color FROM comments c
  LEFT JOIN users u ON u.id = c.user_id`;

export function taskRoutes(db) {
  const r = Router();
  const now = () => new Date().toISOString();

  const getTask = async (taskId) => {
    const task = await db.get('SELECT * FROM tasks WHERE id = ?', taskId);
    if (!task) throw notFound('Task');
    return task;
  };
  const statusOf = (boardId, statusId) => db.get('SELECT * FROM statuses WHERE id = ? AND board_id = ?', statusId, boardId);
  const groupOf = (boardId, groupId) => db.get('SELECT * FROM task_groups WHERE id = ? AND board_id = ?', groupId, boardId);

  async function assertRefs(boardId, b) {
    if (b.status_id != null && !(await statusOf(boardId, b.status_id))) throw badRequest('Unknown status for this board.', { status_id: 'Unknown status' });
    if (b.group_id != null && !(await groupOf(boardId, b.group_id))) throw badRequest('Unknown group for this board.', { group_id: 'Unknown group' });
    if (b.assignee_id != null && !(await db.get('SELECT 1 FROM users WHERE id = ? AND active = 1', b.assignee_id))) {
      throw badRequest('That person is not on the team.', { assignee_id: 'Unknown person' });
    }
    if (b.label_ids?.length) {
      const unique = [...new Set(b.label_ids)];
      const { n } = await db.get(`SELECT COUNT(*) AS n FROM labels WHERE board_id = ? AND id IN (${unique.map(() => '?').join(',')})`,
        boardId, ...unique);
      if (n !== unique.length) throw badRequest('Unknown label for this board.', { label_ids: 'Unknown label' });
    }
  }

  const setLabels = async (tx, taskId, labelIds) => {
    await tx.run('DELETE FROM task_labels WHERE task_id = ?', taskId);
    for (const l of new Set(labelIds)) await tx.run('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)', taskId, l);
  };

  const touchBoard = (tx, boardId) =>
    tx.run("UPDATE boards SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", boardId);

  const taskWithMeta = async (taskId) => {
    const task = await getTask(taskId);
    const labels = await db.all('SELECT label_id FROM task_labels WHERE task_id = ?', taskId);
    const counts = await db.get(`SELECT
      (SELECT COUNT(*) FROM subtasks WHERE task_id = ?) AS subtask_count,
      (SELECT COUNT(*) FROM subtasks WHERE task_id = ? AND done = 1) AS subtask_done,
      (SELECT COUNT(*) FROM comments WHERE task_id = ?) AS comment_count`, taskId, taskId, taskId);
    return { ...task, ...counts, label_ids: labels.map((x) => x.label_id) };
  };

  r.post('/boards/:id/tasks', async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    if (!(await db.get('SELECT 1 FROM boards WHERE id = ?', boardId))) throw notFound('Board');
    const b = parse(createBody, req.body);
    await assertRefs(boardId, b);
    const dateError = checkDateRange(b.start_date, b.due_date);
    if (dateError) throw badRequest(dateError, { start_date: dateError });

    const statusId = b.status_id ?? (await db.get('SELECT id FROM statuses WHERE board_id = ? ORDER BY position LIMIT 1', boardId)).id;
    const groupId = b.group_id ?? (await db.get('SELECT id FROM task_groups WHERE board_id = ? ORDER BY position LIMIT 1', boardId)).id;
    const position = b.position ?? ((await db.get('SELECT MAX(position) AS p FROM tasks WHERE board_id = ?', boardId)).p ?? 0) + 1;
    const done = (await statusOf(boardId, statusId)).is_done;

    const taskId = await db.transaction(async (tx) => {
      const { lastInsertRowid } = await tx.run(`INSERT INTO tasks
        (board_id, status_id, group_id, title, description, assignee_id, priority, start_date, due_date, position, created_by, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        boardId, statusId, groupId, b.title, b.description ?? '', b.assignee_id ?? null, b.priority ?? null,
        b.start_date ?? null, b.due_date ?? null, position, req.user.id, done ? now() : null);
      if (b.label_ids) await setLabels(tx, lastInsertRowid, b.label_ids);
      await logActivity(tx, { boardId, taskId: lastInsertRowid, userId: req.user.id, action: 'task.created', detail: { title: b.title } });
      await touchBoard(tx, boardId);
      return lastInsertRowid;
    });
    res.status(201).json(await taskWithMeta(taskId));
  });

  r.get('/tasks/:id', async (req, res) => {
    const taskId = id(req.params.id, 'Task');
    const [task, subtasks, comments, activity] = await Promise.all([
      taskWithMeta(taskId),
      db.all('SELECT * FROM subtasks WHERE task_id = ? ORDER BY position', taskId),
      db.all(`${COMMENT_SELECT} WHERE c.task_id = ? ORDER BY c.id`, taskId),
      db.all(`SELECT a.*, u.name AS user_name FROM activity a
        LEFT JOIN users u ON u.id = a.user_id WHERE a.task_id = ? ORDER BY a.id DESC LIMIT 50`, taskId),
    ]);
    res.json({ task, subtasks, comments, activity: activity.map((a) => ({ ...a, detail: JSON.parse(a.detail) })) });
  });

  r.patch('/tasks/:id', async (req, res) => {
    const taskId = id(req.params.id, 'Task');
    const current = await getTask(taskId);
    const b = parse(updateBody, req.body);
    await assertRefs(current.board_id, b);
    const start = b.start_date !== undefined ? b.start_date : current.start_date;
    const due = b.due_date !== undefined ? b.due_date : current.due_date;
    const dateError = checkDateRange(start, due);
    if (dateError) throw badRequest(dateError, { [b.start_date !== undefined ? 'start_date' : 'due_date']: dateError });

    const pick = (k) => (b[k] !== undefined ? b[k] : current[k]);
    const fromStatus = await statusOf(current.board_id, current.status_id);
    const toStatus = await statusOf(current.board_id, pick('status_id'));
    const completedAt = nextCompletedAt({
      wasDone: !!fromStatus.is_done, isDone: !!toStatus.is_done, current: current.completed_at, now: now(),
    });
    const assigneeName = b.assignee_id ? (await db.get('SELECT name FROM users WHERE id = ?', b.assignee_id)).name : null;

    await db.transaction(async (tx) => {
      await tx.run(`UPDATE tasks SET title = ?, description = ?, status_id = ?, group_id = ?, assignee_id = ?, priority = ?,
        start_date = ?, due_date = ?, position = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
        pick('title'), pick('description'), pick('status_id'), pick('group_id'), pick('assignee_id'), pick('priority'),
        start, due, pick('position'), completedAt, now(), taskId);
      if (b.label_ids) await setLabels(tx, taskId, b.label_ids);

      const log = (action, detail) => logActivity(tx, { boardId: current.board_id, taskId, userId: req.user.id, action, detail });
      if (toStatus.id !== fromStatus.id) await log('task.status', { from: fromStatus.name, to: toStatus.name });
      if (b.assignee_id !== undefined && b.assignee_id !== current.assignee_id) await log('task.assigned', { to: assigneeName });
      if (b.due_date !== undefined && b.due_date !== current.due_date) await log('task.due', { to: b.due_date });
      if (b.title !== undefined && b.title !== current.title) await log('task.renamed', { from: current.title, to: b.title });
      await touchBoard(tx, current.board_id);
    });
    res.json(await taskWithMeta(taskId));
  });

  // Children are deleted explicitly so this does not depend on foreign-key enforcement.
  r.delete('/tasks/:id', async (req, res) => {
    const taskId = id(req.params.id, 'Task');
    const task = await getTask(taskId);
    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM task_labels WHERE task_id = ?', taskId);
      await tx.run('DELETE FROM subtasks WHERE task_id = ?', taskId);
      await tx.run('DELETE FROM comments WHERE task_id = ?', taskId);
      await tx.run('UPDATE activity SET task_id = NULL WHERE task_id = ?', taskId);
      await tx.run('DELETE FROM tasks WHERE id = ?', taskId);
      await logActivity(tx, { boardId: task.board_id, userId: req.user.id, action: 'task.deleted', detail: { title: task.title } });
    });
    res.status(204).end();
  });

  // ---- Subtasks ----
  r.post('/tasks/:id/subtasks', async (req, res) => {
    const taskId = id(req.params.id, 'Task');
    await getTask(taskId);
    const b = parse(z.object({ title: name(200) }), req.body);
    const pos = ((await db.get('SELECT MAX(position) AS p FROM subtasks WHERE task_id = ?', taskId)).p ?? 0) + 1;
    const { lastInsertRowid } = await db.run('INSERT INTO subtasks (task_id, title, position) VALUES (?, ?, ?)', taskId, b.title, pos);
    res.status(201).json(await db.get('SELECT * FROM subtasks WHERE id = ?', lastInsertRowid));
  });

  r.patch('/subtasks/:id', async (req, res) => {
    const subId = id(req.params.id, 'Subtask');
    const cur = await db.get('SELECT * FROM subtasks WHERE id = ?', subId);
    if (!cur) throw notFound('Subtask');
    const b = parse(z.object({ title: name(200).optional(), done: z.boolean().optional() }), req.body);
    await db.run('UPDATE subtasks SET title = ?, done = ? WHERE id = ?',
      b.title ?? cur.title, b.done === undefined ? cur.done : Number(b.done), subId);
    res.json(await db.get('SELECT * FROM subtasks WHERE id = ?', subId));
  });

  r.delete('/subtasks/:id', async (req, res) => {
    await db.run('DELETE FROM subtasks WHERE id = ?', id(req.params.id, 'Subtask'));
    res.status(204).end();
  });

  // ---- Comments ----
  r.post('/tasks/:id/comments', async (req, res) => {
    const taskId = id(req.params.id, 'Task');
    const task = await getTask(taskId);
    const b = parse(z.object({ body: z.string().trim().min(1, 'Write something first').max(5000) }), req.body);
    const commentId = await db.transaction(async (tx) => {
      const { lastInsertRowid } = await tx.run('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)', taskId, req.user.id, b.body);
      await logActivity(tx, { boardId: task.board_id, taskId, userId: req.user.id, action: 'task.commented' });
      return lastInsertRowid;
    });
    res.status(201).json(await db.get(`${COMMENT_SELECT} WHERE c.id = ?`, commentId));
  });

  r.delete('/comments/:id', async (req, res) => {
    const commentId = id(req.params.id, 'Comment');
    const c = await db.get('SELECT * FROM comments WHERE id = ?', commentId);
    if (!c) throw notFound('Comment');
    if (c.user_id !== req.user.id && req.user.role !== 'owner') throw forbidden('You can only delete your own comments.');
    await db.run('DELETE FROM comments WHERE id = ?', commentId);
    res.status(204).end();
  });

  // ---- Cross-board views ----
  r.get('/my-tasks', async (req, res) => {
    res.json(await db.all(`
      SELECT t.*, b.name AS board_name, b.color AS board_color, s.name AS status_name, s.color AS status_color
      FROM tasks t JOIN boards b ON b.id = t.board_id JOIN statuses s ON s.id = t.status_id
      WHERE t.assignee_id = ? AND s.is_done = 0 AND b.archived = 0
      ORDER BY t.due_date IS NULL, t.due_date, t.position`, req.user.id));
  });

  r.get('/search', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    res.json(await db.all(`
      SELECT t.id, t.title, t.board_id, b.name AS board_name, s.name AS status_name, s.color AS status_color
      FROM tasks t JOIN boards b ON b.id = t.board_id JOIN statuses s ON s.id = t.status_id
      WHERE b.archived = 0 AND (t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')
      ORDER BY t.updated_at DESC LIMIT 20`, like, like));
  });

  return r;
}
