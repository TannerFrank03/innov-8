// Vercel serverless entry: every /api/* request is rewritten here (see vercel.json).
// The built client in dist/ is served by Vercel's CDN, not by this function.
import { createApp } from '../server/app.js';
import { databaseConfig, openDatabase } from '../server/db.js';

let appPromise = null;

function getApp() {
  // Opened once per warm instance; migrations run on the first cold start after a deploy.
  appPromise ??= openDatabase(databaseConfig())
    .then((db) => createApp(db, { trustProxy: true }))
    .catch((err) => {
      appPromise = null;
      throw err;
    });
  return appPromise;
}

export default async function handler(req, res) {
  let app;
  try {
    app = await getApp();
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/problem+json');
    res.end(JSON.stringify({
      type: 'about:blank', title: 'Database unavailable', status: 500,
      detail: process.env.TURSO_DATABASE_URL
        ? 'Could not connect to the database. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel.'
        : 'The database is not set up yet. Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel, then redeploy.',
    }));
    return;
  }
  return app(req, res);
}
