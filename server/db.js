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
  // 2: project IDs, guest accounts and per-board sharing.
  `
  ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE boards ADD COLUMN code TEXT;
  UPDATE boards SET code = 'PRJ-' || printf('%04d', id);
  CREATE UNIQUE INDEX idx_boards_code ON boards(code);

  CREATE TABLE board_members (
    board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('editor','viewer')),
    added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (board_id, user_id)
  );
  CREATE INDEX idx_board_members_user ON board_members(user_id);

  CREATE TABLE board_invites (
    id          INTEGER PRIMARY KEY,
    board_id    INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    email       TEXT COLLATE NOCASE,
    role        TEXT NOT NULL CHECK (role IN ('editor','viewer')),
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT ${NOW},
    accepted_at TEXT,
    accepted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    revoked     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_board_invites_board ON board_invites(board_id);
  CREATE INDEX idx_board_invites_email ON board_invites(email);
  `,
];

/**
 * Thin async wrapper over libSQL so routes read like plain SQL.
 * Works with a local file (file:data/planner.db) or a Turso database (libsql://…).
 */
class Db {
  constructor(conn) {
    this.conn = conn;
  }

  async all(sql, ...args) {
    const res = await this.conn.execute({ sql, args });
    return res.rows.map((row) => Object.fromEntries(res.columns.map((c, i) => [c, row[i]])));
  }

  async get(sql, ...args) {
    return (await this.all(sql, ...args))[0];
  }

  async run(sql, ...args) {
    const res = await this.conn.execute({ sql, args });
    return { lastInsertRowid: res.lastInsertRowid == null ? null : Number(res.lastInsertRowid), changes: res.rowsAffected };
  }

  exec(sql) {
    return this.conn.executeMultiple(sql);
  }

  /**
   * Runs [sql, ...args] statements in one round trip as a single write transaction.
   * Use for many inserts against a remote database. Returns one result per statement.
   */
  async batch(statements) {
    const results = await this.conn.batch(statements.map(([sql, ...args]) => ({ sql, args })), 'write');
    return results.map((r) => ({ lastInsertRowid: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) }));
  }

  /** Runs fn(tx) inside a write transaction; tx has the same methods as Db. */
  async transaction(fn) {
    const tx = await this.conn.transaction('write');
    try {
      const result = await fn(new Db(tx));
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    } finally {
      tx.close();
    }
  }
}

/**
 * Opens the database and applies any pending migrations.
 * `url` is "file:<path>" for a local file or "libsql://…" for Turso (with authToken).
 */
export async function openDatabase({ url, authToken } = {}) {
  const local = url.startsWith('file:');
  if (local) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
  // Remote databases use the pure-HTTP client, so serverless hosts need no native binary.
  const { createClient } = local ? await import('@libsql/client') : await import('@libsql/client/web');
  const db = new Db(createClient({ url, authToken }));
  if (local) await db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  await migrate(db);
  return db;
}

async function migrate(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((await db.all('SELECT version FROM _migrations')).map((r) => r.version));
  // Databases created before _migrations existed already have the v1 schema.
  if (!done.has(1) && (await db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'"))) {
    await db.run('INSERT INTO _migrations (version, applied_at) VALUES (1, ?)', new Date().toISOString());
    done.add(1);
  }
  for (let v = 1; v <= MIGRATIONS.length; v++) {
    if (done.has(v)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(MIGRATIONS[v - 1]);
      await tx.run('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)', v, new Date().toISOString());
    });
  }
}

/** Resolves the database location from the environment. */
export function databaseConfig(defaultFile) {
  if (process.env.TURSO_DATABASE_URL) {
    return { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN };
  }
  if (!defaultFile) {
    throw new Error('Database not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the environment.');
  }
  return { url: `file:${defaultFile}` };
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
