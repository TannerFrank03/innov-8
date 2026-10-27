// Fills an empty database with two example users and a sample board so you can try every view.
// Usage: npm run seed  (refuses to run if any users already exist)
// Works on the local file, or on Turso when TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are set.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseConfig, openDatabase, DEFAULT_GROUPS, DEFAULT_LABELS, DEFAULT_STATUSES } from './db.js';
import { hashPassword } from './auth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = await openDatabase(databaseConfig(path.join(process.env.DATA_DIR || path.join(root, 'data'), 'planner.db')));

if ((await db.get('SELECT COUNT(*) AS n FROM users')).n > 0) {
  console.log('Database already has users. Seed skipped.');
  process.exit(0);
}

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

await db.transaction(async (tx) => {
  const addUser = (...a) => tx.run('INSERT INTO users (name, email, password_hash, role, color) VALUES (?, ?, ?, ?, ?)', ...a);
  const owner = (await addUser('Tanner', 'owner@example.com', hashPassword('changeme123'), 'owner', '#5b5bd6')).lastInsertRowid;
  const designer = (await addUser('Designer', 'designer@example.com', hashPassword('changeme123'), 'member', '#d6409f')).lastInsertRowid;

  const board = (await tx.run('INSERT INTO boards (name, description, color, created_by) VALUES (?, ?, ?, ?)',
    'Client projects', 'Example board. Rename or archive it once your real work is in.', '#5b5bd6', owner)).lastInsertRowid;
  const statuses = [];
  for (const [i, s] of DEFAULT_STATUSES.entries()) {
    statuses.push((await tx.run('INSERT INTO statuses (board_id, name, color, position, wip_limit, is_done) VALUES (?, ?, ?, ?, ?, ?)',
      board, s.name, s.color, i + 1, s.wip_limit ?? null, s.is_done)).lastInsertRowid);
  }
  const groups = [];
  for (const [i, g] of DEFAULT_GROUPS.entries()) {
    groups.push((await tx.run('INSERT INTO task_groups (board_id, name, color, position) VALUES (?, ?, ?, ?)',
      board, g.name, g.color, i + 1)).lastInsertRowid);
  }
  const labels = [];
  for (const l of DEFAULT_LABELS) {
    labels.push((await tx.run('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)', board, l.name, l.color)).lastInsertRowid);
  }

  const tasks = [
    ['Example: logo concepts for coffee shop', 1, 0, designer, 'high', -3, 2, [0]],
    ['Example: homepage wireframe', 1, 0, owner, 'medium', -1, 4, [1]],
    ['Example: client feedback on brand guide', 2, 0, owner, 'urgent', -5, 0, [0]],
    ['Example: Instagram launch posts (x6)', 0, 0, designer, 'medium', 1, 6, [2]],
    ['Example: send invoice for October', 0, 0, owner, 'low', null, 3, [3]],
    ['Example: business card print files', 3, 0, designer, 'medium', -10, -6, [0]],
    ['Example: landing page build', 0, 1, owner, 'high', 7, 18, [1]],
    ['Example: photo shoot shot list', 0, 1, designer, null, 10, 12, [2]],
  ];
  let first = null;
  for (const [i, [title, s, g, who, prio, start, due, ls]] of tasks.entries()) {
    const t = (await tx.run(`INSERT INTO tasks (board_id, status_id, group_id, title, assignee_id, priority, start_date, due_date, position, created_by, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      board, statuses[s], groups[g], title, who, prio, start == null ? null : day(start), day(due), i + 1, owner,
      DEFAULT_STATUSES[s].is_done ? new Date().toISOString() : null)).lastInsertRowid;
    first ??= t;
    for (const l of ls) await tx.run('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)', t, labels[l]);
  }
  for (const [i, title] of ['Three directions: wordmark, monogram, badge', 'Share in client folder'].entries()) {
    await tx.run('INSERT INTO subtasks (task_id, title, done, position) VALUES (?, ?, ?, ?)', first, title, i === 0 ? 1 : 0, i + 1);
  }
  await tx.run('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)', first, owner, 'Client prefers warmer colours. Keep it simple.');
});

console.log('Seeded. Sign in as owner@example.com / changeme123 (change this password in Settings).');
