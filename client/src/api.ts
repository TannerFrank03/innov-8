import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Board, BoardData, Comment, Group, Label, MyTask, SearchHit, Status, Subtask, Task, TaskDetail, TaskPatch, User,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public errors?: Record<string, string>) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'innov8', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') queryClient.setQueryData(['auth'], (s: AuthState | undefined) => s && { ...s, user: null });
    throw new ApiError(res.status, data.detail || data.title || 'Something went wrong.', data.errors);
  }
  return data as T;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 },
  },
});

export interface AuthState { needsSetup: boolean; user: User | null }
export const useAuth = () => useQuery({ queryKey: ['auth'], queryFn: () => api<AuthState>('/auth/state') });
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
export const useBoards = (archived = false) =>
  useQuery({ queryKey: ['boards', archived], queryFn: () => api<Board[]>(`/boards${archived ? '?archived=1' : ''}`) });
export const useBoard = (id: number) => useQuery({ queryKey: ['board', id], queryFn: () => api<BoardData>(`/boards/${id}`) });
export const useTask = (id: number | null) =>
  useQuery({ queryKey: ['task', id], queryFn: () => api<TaskDetail>(`/tasks/${id}`), enabled: id != null });
export const useMyTasks = () => useQuery({ queryKey: ['my-tasks'], queryFn: () => api<MyTask[]>('/my-tasks') });
export const useSearch = (q: string) =>
  useQuery({ queryKey: ['search', q], queryFn: () => api<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 });

/** Optimistically patches a task in the board cache so drag-and-drop feels instant. */
export function useUpdateTask(boardId: number) {
  const qc = useQueryClient();
  const mutationKey = ['task-update', boardId];
  // While another edit is still saving, a server reply can predate it, so only the last reply is applied.
  const othersPending = () => qc.isMutating({ mutationKey }) > 1;
  return useMutation({
    mutationKey,
    mutationFn: ({ id, patch }: { id: number; patch: TaskPatch }) => api<Task>(`/tasks/${id}`, { method: 'PATCH', body: patch }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['board', boardId] });
      const prev = qc.getQueryData<BoardData>(['board', boardId]);
      if (prev) qc.setQueryData<BoardData>(['board', boardId], { ...prev, tasks: prev.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (!othersPending() && ctx?.prev) qc.setQueryData(['board', boardId], ctx.prev);
      qc.invalidateQueries({ queryKey: ['board', boardId] });
    },
    onSuccess: (task) => {
      if (othersPending()) return;
      qc.setQueryData<BoardData>(['board', boardId], (d) => d && { ...d, tasks: d.tasks.map((t) => (t.id === task.id ? task : t)) });
      qc.invalidateQueries({ queryKey: ['task', task.id] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
      qc.invalidateQueries({ queryKey: ['boards'] });
    },
  });
}

export function useCreateTask(boardId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskPatch & { title: string }) => api<Task>(`/boards/${boardId}/tasks`, { method: 'POST', body }),
    onSuccess: (task) => {
      qc.setQueryData<BoardData>(['board', boardId], (d) => d && { ...d, tasks: [...d.tasks, task] });
      qc.invalidateQueries({ queryKey: ['boards'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}

/** Generic mutation that refreshes the given query keys afterwards. */
export function useApiMutation<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  invalidate: (vars: TVars) => unknown[][],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_r, vars) => invalidate(vars).forEach((key) => qc.invalidateQueries({ queryKey: key })),
  });
}

export type { Status, Group, Label, Subtask, Comment };
