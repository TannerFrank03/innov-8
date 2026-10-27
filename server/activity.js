export function logActivity(db, { boardId, taskId = null, userId, action, detail = {} }) {
  return db.run('INSERT INTO activity (board_id, task_id, user_id, action, detail) VALUES (?, ?, ?, ?, ?)',
    boardId, taskId, userId, action, JSON.stringify(detail));
}
