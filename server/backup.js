// Writes a consistent copy of the database to ./backups (or BACKUP_DIR), keeping the newest 30.
// Safe to run while the app is running. Schedule it daily with cron or Task Scheduler.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const backupDir = process.env.BACKUP_DIR || path.join(root, 'backups');
const keep = Number(process.env.BACKUP_KEEP || 30);

fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(backupDir, `planner-${stamp}.db`);

const db = new DatabaseSync(path.join(dataDir, 'planner.db'));
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
console.log(`Backup written: ${target}`);

const old = fs.readdirSync(backupDir).filter((f) => /^planner-.*\.db$/.test(f)).sort().reverse().slice(keep);
for (const f of old) fs.unlinkSync(path.join(backupDir, f));
if (old.length) console.log(`Removed ${old.length} old backup(s).`);
