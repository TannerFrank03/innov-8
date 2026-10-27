import { Router } from 'express';
import { z } from 'zod';
import { requireOwner } from '../auth.js';
import { DEFAULT_GROUPS, DEFAULT_LABELS, DEFAULT_STATUSES } from '../db.js';
import { badRequest, color, id, name, notFound, parse } from '../http.js';
import { logActivity } from '../activity.js';

const boardBody = z.object({
  name: name(80),
  description: z.string().trim().max(500).default(''),
  color: color.default('#5b5bd6'),
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

  r.get('/boards', async (req, res) => {
    const archived = req.query.archived === '1' ? 1 : 0;
    const boards = await db.all(`
      SELECT b.*,
        (SELECT COUNT(*) FROM tasks t WHERE t.board_id = b.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.board_id = b.id AND s.is_done = 1) AS done_count,
        (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.board_id = b.id AND s.is_done = 0 AND t.due_date < date('now')) AS overdue_count
      FROM boards b WHERE b.archived = ? ORDER BY b.updated_at DESC`, archived);
    res.json(boards);
  });

  r.post('/boards', async (req, res) => {
    const body = parse(boardBody, req.body);
    const boardId = await db.transaction(async (tx) => {
      const { lastInsertRowid: bid } = await tx.run(
        'INSERT INTO boards (name, description, color, created_by) VALUES (?, ?, ?, ?)',
        body.name, body.description, body.color, req.user.id);
      for (const [i, s] of DEFAULT_STATUSES.entries()) {
        await tx.run('INSERT INTO statuses (board_id, name, color, position, wip_limit, is_done) VALUES (?, ?, ?, ?, ?, ?)',
          bid, s.name, s.color, i + 1, s.wip_limit ?? null, s.is_done);
      }
      for (const [i, g] of DEFAULT_GROUPS.entries()) {
        await tx.run('INSERT INTO task_groups (board_id, name, color, position) VALUES (?, ?, ?, ?)', bid, g.name, g.color, i + 1);
      }
      for (const l of DEFAULT_LABELS) {
        await tx.run('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)', bid, l.name, l.color);
      }
      await logActivity(tx, { boardId: bid, userId: req.user.id, action: 'board.created', detail: { name: body.name } });
      return bid;
    });
    res.status(201).json(await getBoard(boardId));
  });

  // Everything a board view needs in one round trip.
  r.get('/boards/:id', async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    const [board, statuses, groups, labels, tasks] = await Promise.all([
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
    ]);
    res.json({
      board, statuses, groups, labels,
      tasks: tasks.map(({ label_csv, ...t }) => ({
        ...t,
        label_ids: label_csv ? String(label_csv).split(',').map(Number) : [],
      })),
    });
  });

  r.patch('/boards/:id', async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    await getBoard(boardId);
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
  r.delete('/boards/:id', requireOwner, async (req, res) => {
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
      await tx.run('DELETE FROM boards WHERE id = ?', boardId);
    });
    res.status(204).end();
  });

  r.get('/boards/:id/activity', async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    await getBoard(boardId);
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
    await getBoard(boardId);
    const b = parse(statusBody, req.body);
    const { lastInsertRowid } = await db.run(
      'INSERT INTO statuses (board_id, name, color, position, wip_limit, is_done) VALUES (?, ?, ?, ?, ?, ?)',
      boardId, b.name, b.color, b.position ?? (await nextPosition('statuses', boardId)), b.wip_limit ?? null, Number(b.is_done ?? false));
    res.status(201).json(await db.get('SELECT * FROM statuses WHERE id = ?', lastInsertRowid));
  });

  r.patch('/statuses/:id', async (req, res) => {
    const statusId = id(req.params.id, 'Status');
    const current = await db.get('SELECT * FROM statuses WHERE id = ?', statusId);
    if (!current) throw notFound('Status');
    const b = parse(statusBody.partial(), req.body);
    await db.run('UPDATE statuses SET name = ?, color = ?, position = ?, wip_limit = ?, is_done = ? WHERE id = ?',
      b.name ?? current.name, b.color ?? current.color, b.position ?? current.position,
      b.wip_limit === undefined ? current.wip_limit : b.wip_limit,
      b.is_done === undefined ? current.is_done : Number(b.is_done), statusId);
    res.json(await db.get('SELECT * FROM statuses WHERE id = ?', statusId));
  });

  r.post('/boards/:id/groups', async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    await getBoard(boardId);
    const b = parse(groupBody, req.body);
    const { lastInsertRowid } = await db.run('INSERT INTO task_groups (board_id, name, color, position) VALUES (?, ?, ?, ?)',
      boardId, b.name, b.color, b.position ?? (await nextPosition('task_groups', boardId)));
    res.status(201).json(await db.get('SELECT * FROM task_groups WHERE id = ?', lastInsertRowid));
  });

  r.patch('/groups/:id', async (req, res) => {
    const groupId = id(req.params.id, 'Group');
    const current = await db.get('SELECT * FROM task_groups WHERE id = ?', groupId);
    if (!current) throw notFound('Group');
    const b = parse(groupBody.partial(), req.body);
    await db.run('UPDATE task_groups SET name = ?, color = ?, position = ? WHERE id = ?',
      b.name ?? current.name, b.color ?? current.color, b.position ?? current.position, groupId);
    res.json(await db.get('SELECT * FROM task_groups WHERE id = ?', groupId));
  });

  // Deleting a status or group moves its tasks to `moveTo` (another one on the same board).
  const deleteWithMove = (table, column, what) => async (req, res) => {
    const rowId = id(req.params.id, what);
    const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, rowId);
    if (!row) throw notFound(what);
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
    await getBoard(boardId);
    const b = parse(labelBody, req.body);
    const { lastInsertRowid } = await db.run('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)', boardId, b.name, b.color);
    res.status(201).json(await db.get('SELECT * FROM labels WHERE id = ?', lastInsertRowid));
  });

  r.patch('/labels/:id', async (req, res) => {
    const labelId = id(req.params.id, 'Label');
    const current = await db.get('SELECT * FROM labels WHERE id = ?', labelId);
    if (!current) throw notFound('Label');
    const b = parse(labelBody.partial(), req.body);
    await db.run('UPDATE labels SET name = ?, color = ? WHERE id = ?', b.name ?? current.name, b.color ?? current.color, labelId);
    res.json(await db.get('SELECT * FROM labels WHERE id = ?', labelId));
  });

  r.delete('/labels/:id', async (req, res) => {
    const labelId = id(req.params.id, 'Label');
    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM task_labels WHERE label_id = ?', labelId);
      await tx.run('DELETE FROM labels WHERE id = ?', labelId);
    });
    res.status(204).end();
  });

  return r;
}
