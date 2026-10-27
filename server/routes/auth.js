import { Router } from 'express';
import { z } from 'zod';
import {
  createSession, destroySession, hashPassword, publicUser, rateLimit, requireOwner, requireUser,
  setSessionCookie, verifyPassword, SESSION_COOKIE,
} from '../auth.js';
import { HttpError, badRequest, color, id, name, notFound, parse } from '../http.js';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(200);
const password = z.string().min(8, 'Use at least 8 characters').max(200);
const USER_COLORS = ['#5b5bd6', '#d6409f', '#12a594', '#f76b15', '#0090ff', '#e5484d'];

export function authRoutes(db) {
  const r = Router();
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  r.get('/auth/state', (req, res) => {
    res.json({ needsSetup: userCount() === 0, user: publicUser(req.user) });
  });

  // First run only: creates the owner account.
  r.post('/auth/setup', (req, res) => {
    if (userCount() > 0) throw new HttpError(409, 'Already set up', 'An owner account already exists. Sign in instead.');
    const body = parse(z.object({ name: name(80), email, password }), req.body);
    const { lastInsertRowid } = db
      .prepare("INSERT INTO users (name, email, password_hash, role, color) VALUES (?, ?, ?, 'owner', ?)")
      .run(body.name, body.email, hashPassword(body.password), USER_COLORS[0]);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
    setSessionCookie(req, res, createSession(db, user.id));
    res.status(201).json({ user: publicUser(user) });
  });

  r.post('/auth/login', rateLimit({ windowMs: 15 * 60_000, max: 10 }), (req, res) => {
    const body = parse(z.object({ email, password: z.string().min(1, 'Required') }), req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(body.email);
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      throw new HttpError(401, 'Sign-in failed', 'That email and password do not match.');
    }
    setSessionCookie(req, res, createSession(db, user.id));
    res.json({ user: publicUser(user) });
  });

  r.post('/auth/logout', (req, res) => {
    destroySession(db, req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  r.get('/users', requireUser, (_req, res) => {
    const users = db.prepare('SELECT * FROM users WHERE active = 1 ORDER BY id').all();
    res.json(users.map(publicUser));
  });

  r.post('/users', requireUser, requireOwner, (req, res) => {
    const body = parse(
      z.object({ name: name(80), email, password, role: z.enum(['owner', 'member']).default('member') }),
      req.body,
    );
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) {
      throw badRequest('That email is already in use.', { email: 'Already in use' });
    }
    const pick = USER_COLORS[userCount() % USER_COLORS.length];
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (name, email, password_hash, role, color) VALUES (?, ?, ?, ?, ?)')
      .run(body.name, body.email, hashPassword(body.password), body.role, pick);
    res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid)));
  });

  r.patch('/users/:id', requireUser, (req, res) => {
    const userId = id(req.params.id, 'User');
    const isSelf = userId === req.user.id;
    if (!isSelf && req.user.role !== 'owner') throw new HttpError(403, 'Forbidden', 'You can only edit your own profile.');
    const target = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(userId);
    if (!target) throw notFound('User');
    const body = parse(
      z.object({ name: name(80).optional(), color: color.optional(), role: z.enum(['owner', 'member']).optional() }),
      req.body,
    );
    if (body.role && req.user.role !== 'owner') throw new HttpError(403, 'Forbidden', 'Only the owner can change roles.');
    if (body.role === 'member' && target.role === 'owner') {
      const owners = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1").get().n;
      if (owners <= 1) throw badRequest('There must always be at least one owner.');
    }
    db.prepare('UPDATE users SET name = COALESCE(?, name), color = COALESCE(?, color), role = COALESCE(?, role) WHERE id = ?')
      .run(body.name ?? null, body.color ?? null, body.role ?? null, userId);
    res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)));
  });

  // Deactivates rather than deletes, so their name stays on old comments and activity.
  r.delete('/users/:id', requireUser, requireOwner, (req, res) => {
    const userId = id(req.params.id, 'User');
    if (userId === req.user.id) throw badRequest('You cannot remove your own account.');
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?').run(userId);
    res.status(204).end();
  });

  r.post('/me/password', requireUser, (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1, 'Required'), newPassword: password }), req.body);
    if (!verifyPassword(body.currentPassword, req.user.password_hash)) {
      throw badRequest('Your current password is not right.', { currentPassword: 'Incorrect password' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.newPassword), req.user.id);
    res.status(204).end();
  });

  return r;
}
