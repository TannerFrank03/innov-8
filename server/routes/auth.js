import { Router } from 'express';
import { z } from 'zod';
import {
  createSession, destroySession, hashPassword, publicUser, rateLimit, requireOwner, requireUser,
  setSessionCookie, verifyPassword, SESSION_COOKIE,
} from '../auth.js';
import { HttpError, badRequest, color, id, name, notFound, parse } from '../http.js';
import { isTeam } from '../access.js';
import { acceptEmailInvites } from './sharing.js';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(200);
const password = z.string().min(8, 'Use at least 8 characters').max(200);
const USER_COLORS = ['#5b5bd6', '#d6409f', '#12a594', '#f76b15', '#0090ff', '#e5484d'];

const teamOnly = (req, _res, next) =>
  next(isTeam(req.user) ? undefined : new HttpError(403, 'Forbidden', 'Only the studio team can do that.'));

export function authRoutes(db) {
  const r = Router();
  const userCount = async () => (await db.get('SELECT COUNT(*) AS n FROM users')).n;
  const getUser = (userId) => db.get('SELECT * FROM users WHERE id = ?', userId);

  r.get('/auth/state', async (req, res) => {
    res.json({ needsSetup: (await userCount()) === 0, user: publicUser(req.user) });
  });

  // First run only: creates the owner account.
  r.post('/auth/setup', async (req, res) => {
    const body = parse(z.object({ name: name(80), email, password }), req.body);
    const user = await db.transaction(async (tx) => {
      if ((await tx.get('SELECT COUNT(*) AS n FROM users')).n > 0) {
        throw new HttpError(409, 'Already set up', 'An owner account already exists. Sign in instead.');
      }
      const { lastInsertRowid } = await tx.run(
        "INSERT INTO users (name, email, password_hash, role, color) VALUES (?, ?, ?, 'owner', ?)",
        body.name, body.email, hashPassword(body.password), USER_COLORS[0]);
      return tx.get('SELECT * FROM users WHERE id = ?', lastInsertRowid);
    });
    setSessionCookie(req, res, await createSession(db, user.id));
    res.status(201).json({ user: publicUser(user) });
  });

  // Anyone can create an account. New accounts are guests: they see only projects shared with them,
  // and any pending email invites for their address are accepted straight away.
  r.post('/auth/register', rateLimit({ windowMs: 15 * 60_000, max: 10 }), async (req, res) => {
    if ((await userCount()) === 0) throw badRequest('Set up the studio owner account first.');
    const body = parse(z.object({ name: name(80), email, password }), req.body);
    if (await db.get('SELECT 1 FROM users WHERE email = ?', body.email)) {
      throw badRequest('An account with that email already exists. Sign in instead.', { email: 'Already registered' });
    }
    const pick = USER_COLORS[(await userCount()) % USER_COLORS.length];
    const { lastInsertRowid } = await db.run(
      "INSERT INTO users (name, email, password_hash, role, color, is_guest) VALUES (?, ?, ?, 'member', ?, 1)",
      body.name, body.email, hashPassword(body.password), pick);
    const user = await getUser(lastInsertRowid);
    const joined = await acceptEmailInvites(db, user);
    setSessionCookie(req, res, await createSession(db, user.id));
    res.status(201).json({ user: publicUser(user), joined });
  });

  r.post('/auth/login', rateLimit({ windowMs: 15 * 60_000, max: 10 }), async (req, res) => {
    const body = parse(z.object({ email, password: z.string().min(1, 'Required') }), req.body);
    const user = await db.get('SELECT * FROM users WHERE email = ? AND active = 1', body.email);
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      throw new HttpError(401, 'Sign-in failed', 'That email and password do not match.');
    }
    setSessionCookie(req, res, await createSession(db, user.id));
    res.json({ user: publicUser(user) });
  });

  r.post('/auth/logout', async (req, res) => {
    await destroySession(db, req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  // The team sees everyone; a guest sees the people on projects shared with them.
  r.get('/users', requireUser, async (req, res) => {
    const users = isTeam(req.user)
      ? await db.all('SELECT * FROM users WHERE active = 1 ORDER BY is_guest, id')
      : await db.all(`SELECT * FROM users u WHERE u.active = 1 AND (u.id = ? OR u.is_guest = 0 OR u.id IN (
          SELECT m2.user_id FROM board_members m1 JOIN board_members m2 ON m2.board_id = m1.board_id WHERE m1.user_id = ?))
          ORDER BY u.is_guest, u.id`, req.user.id, req.user.id);
    res.json(users.map(publicUser));
  });

  r.post('/users', requireUser, requireOwner, teamOnly, async (req, res) => {
    const body = parse(
      z.object({ name: name(80), email, password, role: z.enum(['owner', 'member']).default('member') }),
      req.body,
    );
    if (await db.get('SELECT 1 FROM users WHERE email = ?', body.email)) {
      throw badRequest('That email is already in use.', { email: 'Already in use' });
    }
    const pick = USER_COLORS[(await userCount()) % USER_COLORS.length];
    const { lastInsertRowid } = await db.run(
      'INSERT INTO users (name, email, password_hash, role, color) VALUES (?, ?, ?, ?, ?)',
      body.name, body.email, hashPassword(body.password), body.role, pick);
    res.status(201).json(publicUser(await getUser(lastInsertRowid)));
  });

  r.patch('/users/:id', requireUser, async (req, res) => {
    const userId = id(req.params.id, 'User');
    const isSelf = userId === req.user.id;
    if (!isSelf && req.user.role !== 'owner') throw new HttpError(403, 'Forbidden', 'You can only edit your own profile.');
    const target = await db.get('SELECT * FROM users WHERE id = ? AND active = 1', userId);
    if (!target) throw notFound('User');
    const body = parse(
      z.object({
        name: name(80).optional(), color: color.optional(), role: z.enum(['owner', 'member']).optional(),
        guest: z.literal(false).optional(), // promote a guest to the studio team
      }),
      req.body,
    );
    const ownerOnly = body.role !== undefined || body.guest !== undefined;
    if (ownerOnly && (req.user.role !== 'owner' || !isTeam(req.user))) {
      throw new HttpError(403, 'Forbidden', 'Only the owner can change roles.');
    }
    if (body.role === 'member' && target.role === 'owner') {
      const owners = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1")).n;
      if (owners <= 1) throw badRequest('There must always be at least one owner.');
    }
    await db.run('UPDATE users SET name = COALESCE(?, name), color = COALESCE(?, color), role = COALESCE(?, role) WHERE id = ?',
      body.name ?? null, body.color ?? null, body.role ?? null, userId);
    if (body.guest === false && target.is_guest) {
      await db.batch([
        ['UPDATE users SET is_guest = 0 WHERE id = ?', userId],
        ['DELETE FROM board_members WHERE user_id = ?', userId], // the team sees every board anyway
      ]);
    }
    res.json(publicUser(await getUser(userId)));
  });

  // Deactivates rather than deletes, so their name stays on old comments and activity.
  r.delete('/users/:id', requireUser, requireOwner, teamOnly, async (req, res) => {
    const userId = id(req.params.id, 'User');
    if (userId === req.user.id) throw badRequest('You cannot remove your own account.');
    await db.transaction(async (tx) => {
      await tx.run('UPDATE users SET active = 0 WHERE id = ?', userId);
      await tx.run('DELETE FROM sessions WHERE user_id = ?', userId);
      await tx.run('DELETE FROM board_members WHERE user_id = ?', userId);
      await tx.run('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?', userId);
    });
    res.status(204).end();
  });

  r.post('/me/password', requireUser, async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1, 'Required'), newPassword: password }), req.body);
    if (!verifyPassword(body.currentPassword, req.user.password_hash)) {
      throw badRequest('Your current password is not right.', { currentPassword: 'Incorrect password' });
    }
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(body.newPassword), req.user.id);
    res.status(204).end();
  });

  return r;
}
