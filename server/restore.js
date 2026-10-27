// Loads a JSON backup made by `npm run backup` into an EMPTY database (local file or Turso).
// Usage: npm run restore -- backups/planner-<timestamp>.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseConfig, openDatabase } from './db.js';
import { TABLES } from './backup.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run restore -- <backup.json>');
  process.exit(1);
}
const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = await openDatabase(databaseConfig(path.join(process.env.DATA_DIR || path.join(root, 'data'), 'planner.db')));

if ((await db.get('SELECT COUNT(*) AS n FROM users')).n > 0) {
  console.error('This database already has data. Restore only into an empty database.');
  process.exit(1);
}

await db.transaction(async (tx) => {
  for (const t of TABLES) {
    for (const row of dump.tables[t] ?? []) {
      const cols = Object.keys(row);
      await tx.run(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => row[c]));
    }
  }
});
console.log(`Restored ${TABLES.map((t) => `${t} ${(dump.tables[t] ?? []).length}`).join(', ')}`);
