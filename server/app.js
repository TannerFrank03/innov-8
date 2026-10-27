import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { loadUser, requireAppHeader, requireUser } from './auth.js';
import { errorHandler, notFound } from './http.js';
import { authRoutes } from './routes/auth.js';
import { boardRoutes } from './routes/boards.js';
import { taskRoutes } from './routes/tasks.js';

export function createApp(db, { staticDir, trustProxy } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '200kb' }));
  api.use(cookieParser());
  api.use(requireAppHeader);
  api.use(loadUser(db));
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use(authRoutes(db));
  api.use(requireUser);
  api.use(boardRoutes(db));
  api.use(taskRoutes(db));
  api.use((_req, _res, next) => next(notFound('Endpoint')));
  api.use(errorHandler);
  app.use('/api', api);

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }
  return app;
}
