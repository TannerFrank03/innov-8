// Exports every table to backups/planner-<timestamp>.json (or BACKUP_DIR), keeping the newest 30.
// Works on the local file and on Turso (set TURSO_DATABASE_URL / TURSO_AUTH_TOKEN to back up the live data).
// Restore into an empty database with: npm run restore -- backups/planner-<timestamp>.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseConfig, openDatabase } from './db.js';

export const TABLES = ['users', 'boards', 'statuses', 'task_groups', 'labels', 'tasks', 'task_labels', 'subtasks', 'comments', 'activity', 'board_members', 'board_invites'];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function backup() {
  const backupDir = process.env.BACKUP_DIR || path.join(root, 'backups');
  const keep = Number(process.env.BACKUP_KEEP || 30);
  const db = await openDatabase(databaseConfig(path.join(process.env.DATA_DIR || path.join(root, 'data'), 'planner.db')));

  const dump = { version: 1, created_at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) dump.tables[t] = await db.all(`SELECT * FROM ${t}`);

  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, `planner-${dump.created_at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(target, JSON.stringify(dump));
  const counts = TABLES.map((t) => `${t} ${dump.tables[t].length}`).join(', ');
  console.log(`Backup written: ${target}\n  ${counts}`);

  const old = fs.readdirSync(backupDir).filter((f) => /^planner-.*\.json$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) fs.unlinkSync(path.join(backupDir, f));
  if (old.length) console.log(`Removed ${old.length} old backup(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await backup();
