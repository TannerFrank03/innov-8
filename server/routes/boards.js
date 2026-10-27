import { Router } from 'express';
import { z } from 'zod';
import { requireOwner } from '../auth.js';
import { badRequest, color, id, isoDate, name, notFound, parse } from '../http.js';
import { logActivity } from '../activity.js';
import { TEMPLATES, offsetDate } from '../templates.js';
import { buildBoard } from '../boardBuilder.js';
import { boardPeople, requireBoard, requireTeam, visibleBoards } from '../access.js';
import { publicUser } from '../auth.js';

const boardBody = z.object({
  name: name(80),
  description: z.string().trim().max(500).default(''),
  color: color.default('#5b5bd6'),
});
const createBoardBody = boardBody.extend({
  template: z.enum(Object.keys(TEMPLATES)).optional(),
  start_date: isoDate.optional(),
});

// A board read from a Monday.com export in the browser (see client/src/import/monday.ts).
const importBody = z.object({
  name: name(80),
  description: z.string().trim().max(500).default(''),
  color: color.default('#8f52c4'),
  statuses: z.array(z.object({ name: name(40), color, is_done: z.boolean() })).min(1).max(30),
  groups: z.array(z.object({ name: name(60), color })).min(1).max(100),
  tasks: z.array(z.object({
    group: name(60),
    status: name(40).nullable(),
    title: name(200),
    description: z.string().max(20000).default(''),
    assignee_id: z.number().int().positive().nullable(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).nullable(),
    start_date: isoDate.nullable(),
    due_date: isoDate.nullable(),
    subtasks: z.array(z.object({ title: name(200), done: z.boolean() })).max(200).default([]),
    comments: z.array(z.object({
      body: z.string().trim().min(1).max(5000),
      user_id: z.number().int().positive().nullable(),
      created_at: z.string().datetime().nullable(),
    })).max(200).default([]),
  })).max(1500),
});

const statusBody = z.object({
  name: name(40),
  color,
  wip_limit: z.number().int().positive().max(999).nullable().optional(),
  is_done: z.boolean().optional(),
  position: z.number().finite().optional(),
});
const groupBody = z.object({ name: name(60), color, position: z.number().finite().optional() });
const labelBody = z.object({ name: name(30), color });

export function boardRoutes(db) {
  const r = Router();

  const getBoard = async (boardId) => {
    const board = await db.get('SELECT * FROM boards WHERE id = ?', boardId);
    if (!board) throw notFound('Board');
    return board;
  };
  /** The board, after checking the signed-in user may `need` it (view / comment / edit / manage). */
  const boardFor = async (req, boardId, need = 'view') => {
    await requireBoard(db, req.user, boardId, need);
    return getBoard(boardId);
  };
  /** Board id of a status / group / label row, after the same check. */
  const rowFor = async (req, table, rowId, what, need = 'edit') => {
    const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, rowId);
    if (!row) throw notFound(what);
    await requireBoard(db, req.user, row.board_id, need);
    return row;
  };

  r.get('/boards', async (req, res) => {
    const archived = req.query.archived === '1' ? 1 : 0;
    const [visible, args] = visibleBoards(req.user);
    const boards = await db.all(`
      SELECT b.*,
        (SELECT COUNT(*) FROM tasks t WHERE t.board_id = b.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.board_id = b.id AND s.is_done = 1) AS done_count,
        (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.board_id = b.id AND s.is_done = 0 AND t.due_date < date('now')) AS overdue_count
      FROM boards b WHERE b.archived = ? AND ${visible} ORDER BY b.updated_at DESC`, archived, ...args);
    res.json(boards);
  });

  // Open a project by its ID, e.g. /p/PRJ-0007 in the app.
  r.get('/boards/code/:code', async (req, res) => {
    const board = await db.get('SELECT id FROM boards WHERE code = ? COLLATE NOCASE', String(req.params.code).trim());
    if (!board) throw notFound('Project');
    await requireBoard(db, req.user, board.id, 'view');
    res.json({ id: board.id });
  });

  r.get('/templates', (_req, res) => {
    res.json(Object.entries(TEMPLATES).map(([key, t]) => ({ id: key, name: t.name, description: t.description, tasks: t.tasks.length })));
  });

  r.post('/boards', requireTeam, async (req, res) => {
    const body = parse(createBoardBody, req.body);
    const tpl = body.template ? TEMPLATES[body.template] : null;
    let tasks = [];
    if (tpl) {
      const start = body.start_date ?? new Date().toISOString().slice(0, 10);
      const team = await db.all('SELECT id, role FROM users WHERE active = 1 AND is_guest = 0 ORDER BY id');
      const ownerId = req.user.role === 'owner' ? req.user.id : team.find((u) => u.role === 'owner')?.id ?? null;
      // The designer is the other team member (a Member if there is one).
      const others = team.filter((u) => u.id !== ownerId);
      const designerId = (others.find((u) => u.role === 'member') ?? others[0])?.id ?? null;
      tasks = tpl.tasks.map((t) => ({
        ...t,
        assignee_id: t.who === 'designer' ? designerId : ownerId,
        start_date: offsetDate(start, t.start),
        due_date: offsetDate(start, t.due),
        subtasks: t.subtasks.map((title) => ({ title })),
      }));
    }
    const bid = await buildBoard(db, req.user.id, {
      name: body.name,
      description: body.description || tpl?.description || '',
      color: body.color,
      groups: tpl?.groups,
      tasks,
      activity: { template: body.template ?? null },
    });
    res.status(201).json(await getBoard(bid));
  });

  r.post('/boards/import', requireTeam, async (req, res) => {
    const body = parse(importBody, req.body);
    const userIds = new Set((await db.all('SELECT id FROM users WHERE active = 1 AND is_guest = 0')).map((u) => u.id));
    for (const t of body.tasks) {
      if (t.assignee_id != null && !userIds.has(t.assignee_id)) throw badRequest(`Unknown person on “${t.title}”.`);
      if (t.start_date && t.due_date && t.start_date > t.due_date) [t.start_date, t.due_date] = [t.due_date, t.start_date];
      for (const c of t.comments) if (c.user_id != null && !userIds.has(c.user_id)) c.user_id = null;
    }
    const bid = await buildBoard(db, req.user.id, {
      name: body.name,
      description: body.description,
      color: body.color,
      statuses: body.statuses,
      groups: body.groups,
      tasks: body.tasks,
      activity: { imported: 'monday.com', tasks: body.tasks.length },
    });
    res.status(201).json(await getBoard(bid));
  });

  // Everything a board view needs in one round trip.
  r.get('/boards/:id', async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    const access = await requireBoard(db, req.user, boardId, 'view');
    const [board, statuses, groups, labels, tasks, people] = await Promise.all([
      getBoard(boardId),
      db.all('SELECT * FROM statuses WHERE board_id = ? ORDER BY position', boardId),
      db.all('SELECT * FROM task_groups WHERE board_id = ? ORDER BY position', boardId),
      db.all('SELECT * FROM labels WHERE board_id = ? ORDER BY name', boardId),
      db.all(`
        SELECT t.*,
          (SELECT group_concat(label_id) FROM task_labels WHERE task_id = t.id) AS label_csv,
          (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id) AS subtask_count,
          (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id AND done = 1) AS subtask_done,
          (SELECT COUNT(*) FROM comments WHERE task_id = t.id) AS comment_count
        FROM tasks t WHERE t.board_id = ? ORDER BY t.position`, boardId),
      boardPeople(db, boardId),
    ]);
    res.json({
      board, statuses, groups, labels, access,
      people: people.map((u) => ({ ...publicUser(u), board_role: u.board_role ?? 'team' })),
      tasks: tasks.map(({ label_csv, ...t }) => ({
        ...t,
        label_ids: label_csv ? String(label_csv).split(',').map(Number) : [],
      })),
    });
  });

  r.patch('/boards/:id', async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    await boardFor(req, boardId, 'manage');
    const body = parse(boardBody.partial().extend({ archived: z.boolean().optional() }), req.body);
    await db.run(`UPDATE boards SET name = COALESCE(?, name), description = COALESCE(?, description),
      color = COALESCE(?, color), archived = COALESCE(?, archived),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      body.name ?? null, body.description ?? null, body.color ?? null,
      body.archived === undefined ? null : Number(body.archived), boardId);
    if (body.archived !== undefined) {
      await logActivity(db, { boardId, userId: req.user.id, action: body.archived ? 'board.archived' : 'board.restored' });
    }
    res.json(await getBoard(boardId));
  });

  // Children are deleted explicitly so this does not depend on foreign-key enforcement.
  r.delete('/boards/:id', requireTeam, requireOwner, async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    const board = await getBoard(boardId);
    if (!board.archived) throw badRequest('Archive the board before deleting it.');
    const tasksOf = 'SELECT id FROM tasks WHERE board_id = ?';
    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM activity WHERE board_id = ?', boardId);
      await tx.run(`DELETE FROM task_labels WHERE task_id IN (${tasksOf})`, boardId);
      await tx.run(`DELETE FROM subtasks WHERE task_id IN (${tasksOf})`, boardId);
      await tx.run(`DELETE FROM comments WHERE task_id IN (${tasksOf})`, boardId);
      await tx.run('DELETE FROM tasks WHERE board_id = ?', boardId);
      await tx.run('DELETE FROM labels WHERE board_id = ?', boardId);
      await tx.run('DELETE FROM statuses WHERE board_id = ?', boardId);
      await tx.run('DELETE FROM task_groups WHERE board_id = ?', boardId);
      await tx.run('DELETE FROM board_members WHERE board_id = ?', boardId);
      await tx.run('DELETE FROM board_invites WHERE board_id = ?', boardId);
      await tx.run('DELETE FROM boards WHERE id = ?', boardId);
    });
    res.status(204).end();
  });

  r.get('/boards/:id/activity', async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    await boardFor(req, boardId, 'view');
    const rows = await db.all(`
      SELECT a.*, u.name AS user_name, t.title AS task_title FROM activity a
      LEFT JOIN users u ON u.id = a.user_id LEFT JOIN tasks t ON t.id = a.task_id
      WHERE a.board_id = ? ORDER BY a.id DESC LIMIT 100`, boardId);
    res.json(rows.map((a) => ({ ...a, detail: JSON.parse(a.detail) })));
  });

  // ---- Statuses, groups and labels share the same CRUD shape ----
  const nextPosition = async (table, boardId) =>
    ((await db.get(`SELECT MAX(position) AS p FROM ${table} WHERE board_id = ?`, boardId)).p ?? 0) + 1;

  r.post('/boards/:id/statuses', async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    await boardFor(req, boardId, 'edit');
    const b = parse(statusBody, req.body);
    const { lastInsertRowid } = await db.run(
      'INSERT INTO statuses (board_id, name, color, position, wip_limit, is_done) VALUES (?, ?, ?, ?, ?, ?)',
      boardId, b.name, b.color, b.position ?? (await nextPosition('statuses', boardId)), b.wip_limit ?? null, Number(b.is_done ?? false));
    res.status(201).json(await db.get('SELECT * FROM statuses WHERE id = ?', lastInsertRowid));
  });

  r.patch('/statuses/:id', async (req, res) => {
    const statusId = id(req.params.id, 'Status');
    const current = await rowFor(req, 'statuses', statusId, 'Status');
    const b = parse(statusBody.partial(), req.body);
    await db.run('UPDATE statuses SET name = ?, color = ?, position = ?, wip_limit = ?, is_done = ? WHERE id = ?',
      b.name ?? current.name, b.color ?? current.color, b.position ?? current.position,
      b.wip_limit === undefined ? current.wip_limit : b.wip_limit,
      b.is_done === undefined ? current.is_done : Number(b.is_done), statusId);
    res.json(await db.get('SELECT * FROM statuses WHERE id = ?', statusId));
  });

  r.post('/boards/:id/groups', async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    await boardFor(req, boardId, 'edit');
    const b = parse(groupBody, req.body);
    const { lastInsertRowid } = await db.run('INSERT INTO task_groups (board_id, name, color, position) VALUES (?, ?, ?, ?)',
      boardId, b.name, b.color, b.position ?? (await nextPosition('task_groups', boardId)));
    res.status(201).json(await db.get('SELECT * FROM task_groups WHERE id = ?', lastInsertRowid));
  });

  r.patch('/groups/:id', async (req, res) => {
    const groupId = id(req.params.id, 'Group');
    const current = await rowFor(req, 'task_groups', groupId, 'Group');
    const b = parse(groupBody.partial(), req.body);
    await db.run('UPDATE task_groups SET name = ?, color = ?, position = ? WHERE id = ?',
      b.name ?? current.name, b.color ?? current.color, b.position ?? current.position, groupId);
    res.json(await db.get('SELECT * FROM task_groups WHERE id = ?', groupId));
  });

  // Deleting a status or group moves its tasks to `moveTo` (another one on the same board).
  const deleteWithMove = (table, column, what) => async (req, res) => {
    const rowId = id(req.params.id, what);
    const row = await rowFor(req, table, rowId, what);
    const siblings = await db.all(`SELECT id FROM ${table} WHERE board_id = ? AND id != ?`, row.board_id, rowId);
    if (siblings.length === 0) throw badRequest(`A board needs at least one ${what.toLowerCase()}.`);
    const moveTo = req.query.moveTo ? Number(req.query.moveTo) : siblings[0].id;
    if (!siblings.some((s) => s.id === moveTo)) throw badRequest(`Pick another ${what.toLowerCase()} on this board to move tasks to.`);
    await db.transaction(async (tx) => {
      await tx.run(`UPDATE tasks SET ${column} = ? WHERE ${column} = ?`, moveTo, rowId);
      await tx.run(`DELETE FROM ${table} WHERE id = ?`, rowId);
    });
    res.status(204).end();
  };
  r.delete('/statuses/:id', deleteWithMove('statuses', 'status_id', 'Status'));
  r.delete('/groups/:id', deleteWithMove('task_groups', 'group_id', 'Group'));

  r.post('/boards/:id/labels', async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    await boardFor(req, boardId, 'edit');
    const b = parse(labelBody, req.body);
    const { lastInsertRowid } = await db.run('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)', boardId, b.name, b.color);
    res.status(201).json(await db.get('SELECT * FROM labels WHERE id = ?', lastInsertRowid));
  });

  r.patch('/labels/:id', async (req, res) => {
    const labelId = id(req.params.id, 'Label');
    const current = await rowFor(req, 'labels', labelId, 'Label');
    const b = parse(labelBody.partial(), req.body);
    await db.run('UPDATE labels SET name = ?, color = ? WHERE id = ?', b.name ?? current.name, b.color ?? current.color, labelId);
    res.json(await db.get('SELECT * FROM labels WHERE id = ?', labelId));
  });

  r.delete('/labels/:id', async (req, res) => {
    const labelId = id(req.params.id, 'Label');
    await rowFor(req, 'labels', labelId, 'Label');
    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM task_labels WHERE label_id = ?', labelId);
      await tx.run('DELETE FROM labels WHERE id = ?', labelId);
    });
    res.status(204).end();
  });

  return r;
}
