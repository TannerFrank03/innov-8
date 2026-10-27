import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { Activity } from '../types';
import { timeAgo } from '../util';
import { describeActivity } from './TaskDrawer';
import { EmptyState, ErrorState, Modal, Spinner } from './ui';

export default function ActivityPanel({ boardId, onClose }: { boardId: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ['activity', boardId], queryFn: () => api<Activity[]>(`/boards/${boardId}/activity`) });
  return (
    <Modal title="Board activity" onClose={onClose}>
      {q.isPending && <Spinner />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <EmptyState title="Nothing yet" />}
      <ul className="activity">
        {q.data?.map((a) => (
          <li key={a.id}><b>{a.user_name ?? 'Someone'}</b> {describeActivity(a)} <span className="muted small">{timeAgo(a.created_at)}</span></li>
        ))}
      </ul>
    </Modal>
  );
}
