export type Role = 'owner' | 'member';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface User { id: number; name: string; email: string; role: Role; color: string }

export interface Board {
  id: number; name: string; description: string; color: string; archived: number;
  created_at: string; updated_at: string;
  task_count?: number; done_count?: number; overdue_count?: number;
}
export interface Status { id: number; board_id: number; name: string; color: string; position: number; wip_limit: number | null; is_done: number }
export interface Group { id: number; board_id: number; name: string; color: string; position: number }
export interface Label { id: number; board_id: number; name: string; color: string }

export interface Task {
  id: number; board_id: number; status_id: number; group_id: number;
  title: string; description: string; assignee_id: number | null; priority: Priority | null;
  start_date: string | null; due_date: string | null; position: number;
  created_at: string; updated_at: string; completed_at: string | null;
  label_ids: number[]; subtask_count: number; subtask_done: number; comment_count: number;
}
export interface BoardData { board: Board; statuses: Status[]; groups: Group[]; labels: Label[]; tasks: Task[] }

export interface Subtask { id: number; task_id: number; title: string; done: number; position: number }
export interface Comment { id: number; task_id: number; user_id: number | null; body: string; created_at: string; user_name: string | null; user_color: string | null }
export interface Activity { id: number; action: string; detail: Record<string, string | null>; created_at: string; user_name: string | null; task_title?: string | null }
export interface TaskDetail { task: Task; subtasks: Subtask[]; comments: Comment[]; activity: Activity[] }

export interface MyTask extends Omit<Task, 'label_ids' | 'subtask_count' | 'subtask_done' | 'comment_count'> {
  board_name: string; board_color: string; status_name: string; status_color: string;
}
export interface SearchHit { id: number; title: string; board_id: number; board_name: string; status_name: string; status_color: string }

export type TaskPatch = Partial<Pick<Task,
  'title' | 'description' | 'status_id' | 'group_id' | 'assignee_id' | 'priority' | 'start_date' | 'due_date' | 'position' | 'label_ids'>>;
