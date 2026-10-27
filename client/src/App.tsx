import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './api';
import { ErrorState, Spinner } from './components/ui';
import Shell from './components/Shell';
import AuthPage from './views/AuthPage';
import HomePage from './views/HomePage';
import { JoinPage, ProjectLink } from './views/JoinPage';

const BoardPage = lazy(() => import('./views/BoardPage'));
const SettingsPage = lazy(() => import('./views/SettingsPage'));

export default function App() {
  const auth = useAuth();
  const location = useLocation();
  const inviteToken = location.pathname.match(/^\/join\/([\w-]+)/)?.[1];
  if (auth.isPending) return <Spinner />;
  if (auth.isError) return <ErrorState error={auth.error} onRetry={() => auth.refetch()} />;
  if (!auth.data.user) return <AuthPage setup={auth.data.needsSetup} inviteToken={inviteToken} />;

  return (
    <Shell user={auth.data.user}>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<HomePage user={auth.data.user} />} />
          <Route path="/boards/:boardId" element={<BoardPage />} />
          <Route path="/settings" element={<SettingsPage user={auth.data.user} />} />
          <Route path="/join/:token" element={<JoinPage />} />
          <Route path="/p/:code" element={<ProjectLink />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
