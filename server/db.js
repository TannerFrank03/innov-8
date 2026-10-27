import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

// Each migration runs once, in order. Append new ones; never edit old ones.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
    color         TEXT NOT NULL DEFAULT '#5b5bd6',
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE boards (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT '#5b5bd6',
    archived    INTEGER NOT NULL DEFAULT 0,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT ${NOW},
    updated_at  TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE statuses (
    id        INTEGER PRIMARY KEY,
    board_id  INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    color     TEXT NOT NULL,
    position  REAL NOT NULL,
    wip_limit INTEGER CHECK (wip_limit IS NULL OR wip_limit > 0),
    is_done   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_statuses_board ON statuses(board_id);

  CREATE TABLE task_groups (
    id       INTEGER PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    color    TEXT NOT NULL,
    position REAL NOT NULL
  );
  CREATE INDEX idx_groups_board ON task_groups(board_id);

  CREATE TABLE labels (
    id       INTEGER PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    color    TEXT NOT NULL
  );
  CREATE INDEX idx_labels_board ON labels(board_id);

  CREATE TABLE tasks (
    id           INTEGER PRIMARY KEY,
    board_id     INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    status_id    INTEGER NOT NULL REFERENCES statuses(id),
    group_id     INTEGER NOT NULL REFERENCES task_groups(id),
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    assignee_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    priority     TEXT CHECK (priority IS NULL OR priority IN ('low','medium','high','urgent')),
    start_date   TEXT,
    due_date     TEXT,
    position     REAL NOT NULL,
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT ${NOW},
    updated_at   TEXT NOT NULL DEFAULT ${NOW},
    completed_at TEXT
  );
  CREATE INDEX idx_tasks_board ON tasks(board_id);
  CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
  CREATE INDEX idx_tasks_due ON tasks(due_date);

  CREATE TABLE task_labels (
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
  );

  CREATE TABLE subtasks (
    id       INTEGER PRIMARY KEY,
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title    TEXT NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL
  );
  CREATE INDEX idx_subtasks_task ON subtasks(task_id);

  CREATE TABLE comments (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_comments_task ON comments(task_id);

  CREATE TABLE activity (
    id         INTEGER PRIMARY KEY,
    board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX idx_activity_board ON activity(board_id, created_at);
  CREATE INDEX idx_activity_task ON activity(task_id);
  `,
];

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const DEFAULT_STATUSES = [
  { name: 'To do', color: '#8b8d98', is_done: 0 },
  { name: 'In progress', color: '#f5a524', is_done: 0, wip_limit: 4 },
  { name: 'Client review', color: '#5b5bd6', is_done: 0 },
  { name: 'Done', color: '#30a46c', is_done: 1 },
];

export const DEFAULT_GROUPS = [
  { name: 'This week', color: '#5b5bd6' },
  { name: 'Next up', color: '#8b8d98' },
];

export const DEFAULT_LABELS = [
  { name: 'Branding', color: '#e5484d' },
  { name: 'Web', color: '#0090ff' },
  { name: 'Social', color: '#d6409f' },
  { name: 'Admin', color: '#8b8d98' },
];
