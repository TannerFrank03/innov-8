import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { isTeam, requireBoard, requireTeam } from '../access.js';
import { HttpError, badRequest, id, notFound, parse } from '../http.js';
import { logActivity } from '../activity.js';

const role = z.enum(['editor', 'viewer']);
const newToken = () => crypto.randomBytes(18).toString('base64url');

/** Adds or updates a guest's access to a board. The team already sees every board, so they're skipped. */
async function addMember(db, boardId, user, memberRole, addedBy) {
  if (isTeam(user)) return false;
  await db.run(`INSERT INTO board_members (board_id, user_id, role, added_by) VALUES (?, ?, ?, ?)
    ON CONFLICT (board_id, user_id) DO UPDATE SET role = excluded.role`, boardId, user.id, memberRole, addedBy);
  return true;
}

/** On sign-up: accept every open email invite for this address. Returns the boards joined. */
export async function acceptEmailInvites(db, user) {
  const invites = await db.all(`SELECT * FROM board_invites
    WHERE email = ? AND revoked = 0 AND accepted_at IS NULL`, user.email);
  for (const inv of invites) {
    await addMember(db, inv.board_id, user, inv.role, inv.created_by);
    await db.run('UPDATE board_invites SET accepted_at = ?, accepted_by = ? WHERE id = ?', new Date().toISOString(), user.id, inv.id);
    await logActivity(db, { boardId: inv.board_id, userId: user.id, action: 'board.joined', detail: { role: inv.role } });
  }
  return invites.map((i) => i.board_id);
}

/** An invite that can still be used: not revoked, and (for an email invite) not yet accepted. */
async function openInvite(db, token) {
  const inv = await db.get(`SELECT i.*, b.name AS board_name, b.code AS board_code, b.archived, u.name AS inviter
    FROM board_invites i JOIN boards b ON b.id = i.board_id LEFT JOIN users u ON u.id = i.created_by
    WHERE i.token = ?`, String(token));
  if (!inv || inv.revoked || inv.archived || (inv.email && inv.accepted_at)) {
    throw new HttpError(404, 'Invite not found', 'This invite link has expired or been switched off. Ask for a new one.');
  }
  return inv;
}

/** No sign-in needed: lets the join page say who invited you to what. */
export function publicInviteRoutes(db) {
  const r = Router();
  r.get('/invites/:token', async (req, res) => {
    const inv = await openInvite(db, req.params.token);
    res.json({ board_name: inv.board_name, board_code: inv.board_code, inviter: inv.inviter, role: inv.role, email: inv.email });
  });
  return r;
}

export function sharingRoutes(db) {
  const r = Router();

  const inviteJson = (i) => ({ id: i.id, token: i.token, email: i.email, role: i.role, created_at: i.created_at });

  r.get('/boards/:id/sharing', requireTeam, async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    const board = await db.get('SELECT id, name, code FROM boards WHERE id = ?', boardId);
    if (!board) throw notFound('Board');
    const [team, members, invites] = await Promise.all([
      db.all('SELECT id, name, email, color, role FROM users WHERE active = 1 AND is_guest = 0 ORDER BY id'),
      db.all(`SELECT u.id, u.name, u.email, u.color, m.role FROM board_members m JOIN users u ON u.id = m.user_id
        WHERE m.board_id = ? AND u.active = 1 ORDER BY m.created_at`, boardId),
      db.all(`SELECT * FROM board_invites WHERE board_id = ? AND revoked = 0 AND (email IS NULL OR accepted_at IS NULL)
        ORDER BY id DESC`, boardId),
    ]);
    res.json({ board, team, members, invites: invites.map(inviteJson) });
  });

  // With an email: adds an existing account straight away, otherwise creates an invite for that address.
  // Without an email: creates a link anyone with an account can use.
  r.post('/boards/:id/invites', requireTeam, async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    if (!(await db.get('SELECT 1 FROM boards WHERE id = ?', boardId))) throw notFound('Board');
    const body = parse(z.object({
      email: z.string().trim().toLowerCase().email('Enter a valid email address').max(200).optional(),
      role: role.default('editor'),
    }), req.body);

    if (body.email) {
      const user = await db.get('SELECT * FROM users WHERE email = ? AND active = 1', body.email);
      if (user) {
        if (isTeam(user)) throw badRequest(`${user.name} is on the studio team and can already see every project.`, { email: 'Already has access' });
        await addMember(db, boardId, user, body.role, req.user.id);
        await logActivity(db, { boardId, userId: req.user.id, action: 'board.shared', detail: { to: user.name, role: body.role } });
        return res.status(201).json({ added: { id: user.id, name: user.name, email: user.email, role: body.role } });
      }
      const existing = await db.get(`SELECT * FROM board_invites WHERE board_id = ? AND email = ? AND revoked = 0 AND accepted_at IS NULL`,
        boardId, body.email);
      if (existing) {
        await db.run('UPDATE board_invites SET role = ? WHERE id = ?', body.role, existing.id);
        return res.status(201).json({ invite: inviteJson({ ...existing, role: body.role }) });
      }
    }
    const { lastInsertRowid } = await db.run('INSERT INTO board_invites (board_id, token, email, role, created_by) VALUES (?, ?, ?, ?, ?)',
      boardId, newToken(), body.email ?? null, body.role, req.user.id);
    res.status(201).json({ invite: inviteJson(await db.get('SELECT * FROM board_invites WHERE id = ?', lastInsertRowid)) });
  });

  r.delete('/invites/:inviteId', requireTeam, async (req, res) => {
    await db.run('UPDATE board_invites SET revoked = 1 WHERE id = ?', id(req.params.inviteId, 'Invite'));
    res.status(204).end();
  });

  r.patch('/boards/:id/members/:userId', requireTeam, async (req, res) => {
    const body = parse(z.object({ role }), req.body);
    const { changes } = await db.run('UPDATE board_members SET role = ? WHERE board_id = ? AND user_id = ?',
      body.role, id(req.params.id, 'Board'), id(req.params.userId, 'Person'));
    if (!changes) throw notFound('Person');
    res.status(204).end();
  });

  // The team removes people; a guest may remove themselves ("Leave project").
  r.delete('/boards/:id/members/:userId', async (req, res) => {
    const boardId = id(req.params.id, 'Board');
    const userId = id(req.params.userId, 'Person');
    if (!isTeam(req.user) && req.user.id !== userId) throw new HttpError(403, 'Forbidden', 'Only the studio team can do that.');
    await db.batch([
      ['DELETE FROM board_members WHERE board_id = ? AND user_id = ?', boardId, userId],
      // Their cards on this board become unassigned.
      ['UPDATE tasks SET assignee_id = NULL WHERE board_id = ? AND assignee_id = ?', boardId, userId],
    ]);
    res.status(204).end();
  });

  r.post('/invites/:token/accept', async (req, res) => {
    const inv = await openInvite(db, req.params.token);
    if (inv.email && inv.email.toLowerCase() !== req.user.email.toLowerCase()) {
      throw new HttpError(403, 'Wrong account', `This invite is for ${inv.email}. Sign in with that email to accept it.`);
    }
    const access = isTeam(req.user) ? 'team' : null;
    if (!access) {
      const current = await db.get('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?', inv.board_id, req.user.id);
      // Never downgrade: an editor who opens a view-only link stays an editor.
      if (!(current?.role === 'editor' && inv.role === 'viewer')) await addMember(db, inv.board_id, req.user, inv.role, inv.created_by);
      if (!current) await logActivity(db, { boardId: inv.board_id, userId: req.user.id, action: 'board.joined', detail: { role: inv.role } });
    }
    if (inv.email) await db.run('UPDATE board_invites SET accepted_at = ?, accepted_by = ? WHERE id = ?', new Date().toISOString(), req.user.id, inv.id);
    await requireBoard(db, req.user, inv.board_id, 'view');
    res.json({ board_id: inv.board_id });
  });

  return r;
}
