import crypto from 'node:crypto';
import { HttpError, forbidden } from './http.js';

export const SESSION_COOKIE = 'i8_session';
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token), userId, expires.toISOString(),
  );
  return { token, expires };
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
}

export function setSessionCookie(req, res, { token, expires }) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    expires,
    path: '/',
  });
}

export const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role, color: u.color };

/** Attaches req.user when a valid session cookie is present. */
export function loadUser(db) {
  const find = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`);
  return (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    req.user = token ? find.get(sha256(token), new Date().toISOString()) ?? null : null;
    next();
  };
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Signed out', 'Please sign in again.'));
  next();
}

export function requireOwner(req, _res, next) {
  if (req.user?.role !== 'owner') return next(forbidden('Only the account owner can do that.'));
  next();
}

/**
 * Blocks cross-site form posts: every state-changing request must carry a custom
 * header, which browsers will not attach cross-origin without a CORS preflight.
 */
export function requireAppHeader(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'innov8') {
    return next(new HttpError(403, 'Forbidden', 'Missing app header.'));
  }
  next();
}

/** Small in-memory limiter for sign-in attempts. */
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, _res, next) => {
    const key = `${req.ip}|${String(req.body?.email ?? '').toLowerCase()}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
    } else if (++entry.count > max) {
      const mins = Math.ceil((entry.reset - now) / 60000);
      return next(new HttpError(429, 'Too many attempts', `Too many sign-in attempts. Try again in ${mins} min.`));
    }
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}
