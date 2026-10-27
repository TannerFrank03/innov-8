import { HttpError, notFound } from './http.js';

/**
 * Who can do what on a board.
 *   team   – studio accounts (owner/member, not guests): every board, everything
 *   editor – a guest the board was shared with to edit: tasks and board columns
 *   viewer – a guest the board was shared with to view: read and comment only
 * Guests get a 404 for boards not shared with them, so board IDs don't leak.
 */
export const isTeam = (user) => !!user && !user.is_guest;

const LEVEL = { viewer: 1, editor: 2, team: 3 };
const NEED = { view: 1, comment: 1, edit: 2, manage: 3 };

export async function boardAccess(db, user, boardId) {
  if (isTeam(user)) return 'team';
  const m = await db.get('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?', boardId, user.id);
  return m?.role ?? null;
}

/** Throws unless the user can `need` ('view' | 'comment' | 'edit' | 'manage') the board; returns their access. */
export async function requireBoard(db, user, boardId, need = 'view') {
  const access = await boardAccess(db, user, boardId);
  if (!access) throw notFound('Board');
  if (LEVEL[access] < NEED[need]) {
    throw new HttpError(403, 'Forbidden', need === 'manage'
      ? 'Only the studio team can do that.'
      : 'You can view this project but not change it.');
  }
  return access;
}

/** SQL condition (and its args) limiting `alias`.id to boards the user can see. */
export function visibleBoards(user, alias = 'b') {
  if (isTeam(user)) return ['1 = 1', []];
  return [`${alias}.id IN (SELECT board_id FROM board_members WHERE user_id = ?)`, [user.id]];
}

/** Everyone who can work on a board: the studio team plus the guests it's shared with. */
export function boardPeople(db, boardId) {
  return db.all(`SELECT u.*, bm.role AS board_role FROM users u
    LEFT JOIN board_members bm ON bm.user_id = u.id AND bm.board_id = ?
    WHERE u.active = 1 AND (u.is_guest = 0 OR bm.user_id IS NOT NULL) ORDER BY u.is_guest, u.id`, boardId);
}

export function requireTeam(req, _res, next) {
  if (!isTeam(req.user)) return next(new HttpError(403, 'Forbidden', 'Only the studio team can do that.'));
  next();
}

export const projectCode = (id) => `PRJ-${String(id).padStart(4, '0')}`;
