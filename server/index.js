import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const port = Number(process.env.PORT || 3000);

const db = openDatabase(path.join(dataDir, 'planner.db'));
const app = createApp(db, {
  staticDir: path.join(root, 'dist'),
  trustProxy: process.env.TRUST_PROXY, // e.g. "1" when behind Caddy/Nginx so HTTPS cookies are marked Secure
});

const server = app.listen(port, () => {
  console.log(`Innov-8 Planner running on http://localhost:${port}`);
  console.log(`Database: ${path.join(dataDir, 'planner.db')}`);
});

const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
