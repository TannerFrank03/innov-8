import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { Spinner } from '../components/ui';

/** /join/:token after signing in: accepts the invite and opens the project. */
export function JoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in development
    started.current = true;
    api<{ board_id: number }>(`/invites/${token}/accept`, { method: 'POST' })
      .then(({ board_id }) => {
        qc.invalidateQueries({ queryKey: ['boards'] });
        navigate(`/boards/${board_id}`, { replace: true });
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not open this invite.'));
  }, [token, navigate, qc]);

  if (!error) return <Spinner label="Opening the project" />;
  return (
    <div className="page page-narrow">
      <div className="state state-error" role="alert">
        <strong>Couldn’t join the project</strong>
        <span>{error}</span>
        <Link className="btn" to="/">Go to Home</Link>
      </div>
    </div>
  );
}

/** /p/PRJ-0007: opens a project by its ID. */
export function ProjectLink() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ id: number }>(`/boards/code/${encodeURIComponent(code ?? '')}`)
      .then(({ id }) => navigate(`/boards/${id}`, { replace: true }))
      .catch(() => setError(`No project ${code} that you can open.`));
  }, [code, navigate]);
  if (!error) return <Spinner label={`Opening ${code}`} />;
  return (
    <div className="page page-narrow">
      <div className="state state-error" role="alert"><strong>Project not found</strong><span>{error}</span><Link className="btn" to="/">Go to Home</Link></div>
    </div>
  );
}
