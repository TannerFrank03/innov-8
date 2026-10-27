// Fills an empty database with two example users and a sample board so you can try every view.
// Usage: npm run seed  (refuses to run if any users already exist)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, DEFAULT_GROUPS, DEFAULT_LABELS, DEFAULT_STATUSES, transaction } from './db.js';
import { hashPassword } from './auth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = openDatabase(path.join(process.env.DATA_DIR || path.join(root, 'data'), 'planner.db'));

if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
  console.log('Database already has users. Seed skipped.');
  process.exit(0);
}

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

transaction(db, () => {
  const addUser = db.prepare('INSERT INTO users (name, email, password_hash, role, color) VALUES (?, ?, ?, ?, ?)');
  const owner = addUser.run('Tanner', 'owner@example.com', hashPassword('changeme123'), 'owner', '#5b5bd6').lastInsertRowid;
  const designer = addUser.run('Designer', 'designer@example.com', hashPassword('changeme123'), 'member', '#d6409f').lastInsertRowid;

  const board = db.prepare('INSERT INTO boards (name, description, color, created_by) VALUES (?, ?, ?, ?)')
    .run('Client projects', 'Example board. Rename or archive it once your real work is in.', '#5b5bd6', owner).lastInsertRowid;
  const statuses = DEFAULT_STATUSES.map((s, i) => db.prepare(
    'INSERT INTO statuses (board_id, name, color, position, wip_limit, is_done) VALUES (?, ?, ?, ?, ?, ?)')
    .run(board, s.name, s.color, i + 1, s.wip_limit ?? null, s.is_done).lastInsertRowid);
  const groups = DEFAULT_GROUPS.map((g, i) => db.prepare(
    'INSERT INTO task_groups (board_id, name, color, position) VALUES (?, ?, ?, ?)').run(board, g.name, g.color, i + 1).lastInsertRowid);
  const labels = DEFAULT_LABELS.map((l) => db.prepare(
    'INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)').run(board, l.name, l.color).lastInsertRowid);

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
  const addTask = db.prepare(`INSERT INTO tasks (board_id, status_id, group_id, title, assignee_id, priority, start_date, due_date, position, created_by, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const addLabel = db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)');
  tasks.forEach(([title, s, g, who, prio, start, due, ls], i) => {
    const t = addTask.run(board, statuses[s], groups[g], title, who, prio, start == null ? null : day(start), day(due), i + 1, owner,
      DEFAULT_STATUSES[s].is_done ? new Date().toISOString() : null).lastInsertRowid;
    ls.forEach((l) => addLabel.run(t, labels[l]));
  });
  const first = db.prepare('SELECT id FROM tasks ORDER BY id LIMIT 1').get().id;
  ['Three directions: wordmark, monogram, badge', 'Share in client folder'].forEach((title, i) =>
    db.prepare('INSERT INTO subtasks (task_id, title, done, position) VALUES (?, ?, ?, ?)').run(first, title, i === 0 ? 1 : 0, i + 1));
  db.prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)').run(first, owner, 'Client prefers warmer colours. Keep it simple.');
});

console.log('Seeded. Sign in as owner@example.com / changeme123 (change this password in Settings).');
