import { DEFAULT_GROUPS, DEFAULT_LABELS, DEFAULT_STATUSES } from './db.js';

/**
 * Creates a whole board (statuses, groups, labels, tasks, subtasks, comments) in two round trips:
 * the board row, then everything else as one atomic batch. Used by templates and imports, so it
 * stays fast against a remote database. Tasks refer to their group, status and labels by name.
 *
 * spec: { name, description, color, statuses?, groups?, labels?, tasks?, activity? }
 * task: { group, status?, title, description?, assignee_id?, priority?, start_date?, due_date?,
 *         labels?: string[], subtasks?: { title, done? }[], comments?: { body, user_id, created_at? }[] }
 */
export async function buildBoard(db, userId, spec) {
  const statuses = uniqueNames(spec.statuses?.length ? spec.statuses : DEFAULT_STATUSES);
  const groups = uniqueNames(spec.groups?.length ? spec.groups : DEFAULT_GROUPS);
  const labels = uniqueNames(spec.labels ?? DEFAULT_LABELS);

  const [{ lastInsertRowid: bid }] = await db.batch([
    ['INSERT INTO boards (name, description, color, created_by) VALUES (?, ?, ?, ?)',
      spec.name, spec.description ?? '', spec.color ?? '#8f52c4', userId],
    // Project ID, e.g. PRJ-0007: stable, shareable and searchable.
    ["UPDATE boards SET code = 'PRJ-' || printf('%04d', id) WHERE id = last_insert_rowid()"],
  ]);

  const stmts = [];
  statuses.forEach((s, i) => stmts.push([
    'INSERT INTO statuses (board_id, name, color, position, wip_limit, is_done) VALUES (?, ?, ?, ?, ?, ?)',
    bid, s.name, s.color, i + 1, s.wip_limit ?? null, s.is_done ? 1 : 0]));
  groups.forEach((g, i) => stmts.push([
    'INSERT INTO task_groups (board_id, name, color, position) VALUES (?, ?, ?, ?)', bid, g.name, g.color, i + 1]));
  labels.forEach((l) => stmts.push(['INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)', bid, l.name, l.color]));

  const doneStatuses = new Set(statuses.filter((s) => s.is_done).map((s) => s.name));
  const now = new Date().toISOString();
  // Inside the batch the newest task on this board is the one just inserted.
  const lastTask = '(SELECT MAX(id) FROM tasks WHERE board_id = ?)';
  (spec.tasks ?? []).forEach((t, i) => {
    const statusSql = t.status && statuses.some((s) => s.name === t.status)
      ? ['(SELECT id FROM statuses WHERE board_id = ? AND name = ?)', [bid, t.status]]
      : ['(SELECT id FROM statuses WHERE board_id = ? ORDER BY position LIMIT 1)', [bid]];
    const group = groups.some((g) => g.name === t.group) ? t.group : groups[0].name;
    stmts.push([`INSERT INTO tasks (board_id, status_id, group_id, title, description, assignee_id, priority,
        start_date, due_date, position, created_by, completed_at)
      VALUES (?, ${statusSql[0]}, (SELECT id FROM task_groups WHERE board_id = ? AND name = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      bid, ...statusSql[1], bid, group, t.title, t.description ?? '', t.assignee_id ?? null, t.priority ?? null,
      t.start_date ?? null, t.due_date ?? null, i + 1, userId, doneStatuses.has(t.status) ? now : null]);
    for (const label of t.labels ?? []) {
      stmts.push([`INSERT INTO task_labels (task_id, label_id) SELECT ${lastTask}, id FROM labels WHERE board_id = ? AND name = ?`,
        bid, bid, label]);
    }
    (t.subtasks ?? []).forEach((s, j) => stmts.push([
      `INSERT INTO subtasks (task_id, title, done, position) VALUES (${lastTask}, ?, ?, ?)`, bid, s.title, s.done ? 1 : 0, j + 1]));
    for (const c of t.comments ?? []) {
      stmts.push([`INSERT INTO comments (task_id, user_id, body, created_at) VALUES (${lastTask}, ?, ?, ?)`,
        bid, c.user_id ?? userId, c.body, c.created_at ?? now]);
    }
  });
  stmts.push(['INSERT INTO activity (board_id, user_id, action, detail) VALUES (?, ?, ?, ?)',
    bid, userId, 'board.created', JSON.stringify({ name: spec.name, ...(spec.activity ?? {}) })]);

  try {
    await db.batch(stmts);
  } catch (err) {
    await db.run('DELETE FROM boards WHERE id = ?', bid).catch(() => {});
    throw err;
  }
  return bid;
}

/** Names must be unique within a board's statuses, groups and labels: "Done", "Done (2)", … */
function uniqueNames(items) {
  const seen = new Map();
  return items.map((item) => {
    const base = item.name;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n === 1 ? item : { ...item, name: `${base} (${n})` };
  });
}
