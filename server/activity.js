export function logActivity(db, { boardId, taskId = null, userId, action, detail = {} }) {
  db.prepare('INSERT INTO activity (board_id, task_id, user_id, action, detail) VALUES (?, ?, ?, ?, ?)')
    .run(boardId, taskId, userId, action, JSON.stringify(detail));
}
