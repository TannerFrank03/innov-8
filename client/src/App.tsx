import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './api';
import { ErrorState, Spinner } from './components/ui';
import Shell from './components/Shell';
import AuthPage from './views/AuthPage';
import HomePage from './views/HomePage';

const BoardPage = lazy(() => import('./views/BoardPage'));
const SettingsPage = lazy(() => import('./views/SettingsPage'));

export default function App() {
  const auth = useAuth();
  if (auth.isPending) return <Spinner />;
  if (auth.isError) return <ErrorState error={auth.error} onRetry={() => auth.refetch()} />;
  if (!auth.data.user) return <AuthPage setup={auth.data.needsSetup} />;

  return (
    <Shell user={auth.data.user}>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<HomePage user={auth.data.user} />} />
          <Route path="/boards/:boardId" element={<BoardPage />} />
          <Route path="/settings" element={<SettingsPage user={auth.data.user} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
