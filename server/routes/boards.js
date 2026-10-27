import { Router } from 'express';
import { z } from 'zod';
import { requireOwner } from '../auth.js';
import { DEFAULT_GROUPS, DEFAULT_LABELS, DEFAULT_STATUSES, transaction } from '../db.js';
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

  const getBoard = (boardId) => {
    const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId);
    if (!board) throw notFound('Board');
    return board;
  };

  r.get('/boards', (req, res) => {
    const archived = req.query.archived === '1' ? 1 : 0;
    const boards = db.prepare(`
      SELECT b.*,
        (SELECT COUNT(*) FROM tasks t WHERE t.board_id = b.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.board_id = b.id AND s.is_done = 1) AS done_count,
        (SELECT COUNT(*) FROM tasks t JOIN statuses s ON s.id = t.status_id
           WHERE t.board_id = b.id AND s.is_done = 0 AND t.due_date < date('now')) AS overdue_count
      FROM boards b WHERE b.archived = ? ORDER BY b.updated_at DESC`).all(archived);
    res.json(boards);
  });

  r.post('/boards', (req, res) => {
    const body = parse(boardBody, req.body);
    const boardId = transaction(db, () => {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO boards (name, description, color, created_by) VALUES (?, ?, ?, ?)')
        .run(body.name, body.description, body.color, req.user.id);
      const addStatus = db.prepare(
        'INSERT INTO statuses (board_id, name, color, position, wip_limit, is_done) VALUES (?, ?, ?, ?, ?, ?)');
      DEFAULT_STATUSES.forEach((s, i) => addStatus.run(lastInsertRowid, s.name, s.color, i + 1, s.wip_limit ?? null, s.is_done));
      const addGroup = db.prepare('INSERT INTO task_groups (board_id, name, color, position) VALUES (?, ?, ?, ?)');
      DEFAULT_GROUPS.forEach((g, i) => addGroup.run(lastInsertRowid, g.name, g.color, i + 1));
      const addLabel = db.prepare('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)');
      DEFAULT_LABELS.forEach((l) => addLabel.run(lastInsertRowid, l.name, l.color));
      logActivity(db, { boardId: lastInsertRowid, userId: req.user.id, action: 'board.created', detail: { name: body.name } });
      return lastInsertRowid;
    });
    res.status(201).json(getBoard(boardId));
  });

  // Everything a board view needs in one round trip.
  r.get('/boards/:id', (req, res) => {
    const boardId = id(req.params.id, 'Board');
    const board = getBoard(boardId);
    const statuses = db.prepare('SELECT * FROM statuses WHERE board_id = ? ORDER BY position').all(boardId);
    const groups = db.prepare('SELECT * FROM task_groups WHERE board_id = ? ORDER BY position').all(boardId);
    const labels = db.prepare('SELECT * FROM labels WHERE board_id = ? ORDER BY name').all(boardId);
    const tasks = db.prepare(`
      SELECT t.*,
        (SELECT group_concat(label_id) FROM task_labels WHERE task_id = t.id) AS label_csv,
        (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id) AS subtask_count,
        (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id AND done = 1) AS subtask_done,
        (SELECT COUNT(*) FROM comments WHERE task_id = t.id) AS comment_count
      FROM tasks t WHERE t.board_id = ? ORDER BY t.position`).all(boardId);
    res.json({
      board, statuses, groups, labels,
      tasks: tasks.map(({ label_csv, ...t }) => ({
        ...t,
        label_ids: label_csv ? String(label_csv).split(',').map(Number) : [],
      })),
    });
  });

  r.patch('/boards/:id', (req, res) => {
    const boardId = id(req.params.id, 'Board');
    getBoard(boardId);
    const body = parse(boardBody.partial().extend({ archived: z.boolean().optional() }), req.body);
    db.prepare(`UPDATE boards SET name = COALESCE(?, name), description = COALESCE(?, description),
      color = COALESCE(?, color), archived = COALESCE(?, archived),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .run(body.name ?? null, body.description ?? null, body.color ?? null,
        body.archived === undefined ? null : Number(body.archived), boardId);
    if (body.archived !== undefined) {
      logActivity(db, { boardId, userId: req.user.id, action: body.archived ? 'board.archived' : 'board.restored' });
    }
    res.json(getBoard(boardId));
  });

  r.delete('/boards/:id', requireOwner, (req, res) => {
    const boardId = id(req.params.id, 'Board');
    const board = getBoard(boardId);
    if (!board.archived) throw badRequest('Archive the board before deleting it.');
    db.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
    res.status(204).end();
  });

  r.get('/boards/:id/activity', (req, res) => {
    const boardId = id(req.params.id, 'Board');
    getBoard(boardId);
    const rows = db.prepare(`
      SELECT a.*, u.name AS user_name, t.title AS task_title FROM activity a
      LEFT JOIN users u ON u.id = a.user_id LEFT JOIN tasks t ON t.id = a.task_id
      WHERE a.board_id = ? ORDER BY a.id DESC LIMIT 100`).all(boardId);
    res.json(rows.map((a) => ({ ...a, detail: JSON.parse(a.detail) })));
  });

  // ---- Statuses, groups and labels share the same CRUD shape ----
  const nextPosition = (table, boardId) =>
    (db.prepare(`SELECT MAX(position) AS p FROM ${table} WHERE board_id = ?`).get(boardId).p ?? 0) + 1;

  r.post('/boards/:id/statuses', (req, res) => {
    const boardId = id(req.params.id, 'Board');
    getBoard(boardId);
    const b = parse(statusBody, req.body);
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO statuses (board_id, name, color, position, wip_limit, is_done) VALUES (?, ?, ?, ?, ?, ?)')
      .run(boardId, b.name, b.color, b.position ?? nextPosition('statuses', boardId), b.wip_limit ?? null, Number(b.is_done ?? false));
    res.status(201).json(db.prepare('SELECT * FROM statuses WHERE id = ?').get(lastInsertRowid));
  });

  r.patch('/statuses/:id', (req, res) => {
    const statusId = id(req.params.id, 'Status');
    const current = db.prepare('SELECT * FROM statuses WHERE id = ?').get(statusId);
    if (!current) throw notFound('Status');
    const b = parse(statusBody.partial(), req.body);
    db.prepare(`UPDATE statuses SET name = ?, color = ?, position = ?, wip_limit = ?, is_done = ? WHERE id = ?`).run(
      b.name ?? current.name, b.color ?? current.color, b.position ?? current.position,
      b.wip_limit === undefined ? current.wip_limit : b.wip_limit,
      b.is_done === undefined ? current.is_done : Number(b.is_done), statusId);
    res.json(db.prepare('SELECT * FROM statuses WHERE id = ?').get(statusId));
  });

  r.post('/boards/:id/groups', (req, res) => {
    const boardId = id(req.params.id, 'Board');
    getBoard(boardId);
    const b = parse(groupBody, req.body);
    const { lastInsertRowid } = db.prepare('INSERT INTO task_groups (board_id, name, color, position) VALUES (?, ?, ?, ?)')
      .run(boardId, b.name, b.color, b.position ?? nextPosition('task_groups', boardId));
    res.status(201).json(db.prepare('SELECT * FROM task_groups WHERE id = ?').get(lastInsertRowid));
  });

  r.patch('/groups/:id', (req, res) => {
    const groupId = id(req.params.id, 'Group');
    const current = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(groupId);
    if (!current) throw notFound('Group');
    const b = parse(groupBody.partial(), req.body);
    db.prepare('UPDATE task_groups SET name = ?, color = ?, position = ? WHERE id = ?')
      .run(b.name ?? current.name, b.color ?? current.color, b.position ?? current.position, groupId);
    res.json(db.prepare('SELECT * FROM task_groups WHERE id = ?').get(groupId));
  });

  // Deleting a status or group moves its tasks to `moveTo` (another one on the same board).
  const deleteWithMove = (table, column, what) => (req, res) => {
    const rowId = id(req.params.id, what);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId);
    if (!row) throw notFound(what);
    const siblings = db.prepare(`SELECT id FROM ${table} WHERE board_id = ? AND id != ?`).all(row.board_id, rowId);
    if (siblings.length === 0) throw badRequest(`A board needs at least one ${what.toLowerCase()}.`);
    const moveTo = req.query.moveTo ? Number(req.query.moveTo) : siblings[0].id;
    if (!siblings.some((s) => s.id === moveTo)) throw badRequest(`Pick another ${what.toLowerCase()} on this board to move tasks to.`);
    transaction(db, () => {
      db.prepare(`UPDATE tasks SET ${column} = ? WHERE ${column} = ?`).run(moveTo, rowId);
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(rowId);
    });
    res.status(204).end();
  };
  r.delete('/statuses/:id', deleteWithMove('statuses', 'status_id', 'Status'));
  r.delete('/groups/:id', deleteWithMove('task_groups', 'group_id', 'Group'));

  r.post('/boards/:id/labels', (req, res) => {
    const boardId = id(req.params.id, 'Board');
    getBoard(boardId);
    const b = parse(labelBody, req.body);
    const { lastInsertRowid } = db.prepare('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)')
      .run(boardId, b.name, b.color);
    res.status(201).json(db.prepare('SELECT * FROM labels WHERE id = ?').get(lastInsertRowid));
  });

  r.patch('/labels/:id', (req, res) => {
    const labelId = id(req.params.id, 'Label');
    const current = db.prepare('SELECT * FROM labels WHERE id = ?').get(labelId);
    if (!current) throw notFound('Label');
    const b = parse(labelBody.partial(), req.body);
    db.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?').run(b.name ?? current.name, b.color ?? current.color, labelId);
    res.json(db.prepare('SELECT * FROM labels WHERE id = ?').get(labelId));
  });

  r.delete('/labels/:id', (req, res) => {
    db.prepare('DELETE FROM labels WHERE id = ?').run(id(req.params.id, 'Label'));
    res.status(204).end();
  });

  return r;
}
