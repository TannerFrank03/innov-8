import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { Field } from '../components/ui';
import type { User } from '../types';

type Mode = 'setup' | 'login' | 'register';
export interface InviteInfo { board_name: string; board_code: string; inviter: string | null; role: 'editor' | 'viewer'; email: string | null }

/** Sign in, create an account, or (first run) set up the studio. With an invite token, says who invited you to what. */
export default function AuthPage({ setup, inviteToken }: { setup: boolean; inviteToken?: string }) {
  const qc = useQueryClient();
  const invite = useQuery({
    queryKey: ['invite', inviteToken],
    queryFn: () => api<InviteInfo>(`/invites/${inviteToken}`),
    enabled: !!inviteToken,
    retry: false,
  });
  const [mode, setMode] = useState<Mode>(setup ? 'setup' : inviteToken ? 'register' : 'login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const email = form.email || (mode === 'register' ? invite.data?.email ?? '' : '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage('');
    try {
      const path = { setup: '/auth/setup', login: '/auth/login', register: '/auth/register' }[mode];
      const body = mode === 'login' ? { email, password: form.password } : { ...form, email };
      const { user } = await api<{ user: User }>(path, { method: 'POST', body });
      qc.setQueryData(['auth'], { needsSetup: false, user });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.errors ?? {});
        setMessage(err.message);
      } else setMessage('Could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  const switchTo = (m: Mode) => { setMode(m); setErrors({}); setMessage(''); };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const title = { setup: 'Set up your studio', login: 'Sign in', register: 'Create your account' }[mode];
  const intro = {
    setup: 'Create the owner account. You can add your designer next.',
    login: 'Welcome back. Pick up where you left off.',
    register: 'Use the email your invite was sent to. Projects shared with you will be waiting.',
  }[mode];

  return (
    <main className="auth">
      <section className="auth-brand" aria-hidden>
        <div className="logo logo-lg"><span>orchestr</span><b>-8</b></div>
        <p>Plan the work. Ship the work.</p>
        <span className="auth-by">A studio tool by <img src="/innov8-logo.png" alt="Innov8" /></span>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit} noValidate>
          {invite.data && (
            <div className="banner banner-info invite-banner">
              <b>{invite.data.inviter ?? 'The studio'}</b> invited you to <b>{invite.data.board_name}</b>
              <span className="muted small"> ({invite.data.board_code} · {invite.data.role === 'editor' ? 'can edit' : 'can view & comment'})</span>.
              {' '}{mode === 'register' ? 'Create an account to open it.' : 'Sign in to open it.'}
            </div>
          )}
          {invite.isError && <div className="banner banner-error">This invite link has expired or been switched off. Ask for a new one.</div>}
          <h1>{title}</h1>
          <p className="muted">{intro}</p>
          {message && <div className="banner banner-error" role="alert">{message}</div>}
          {mode !== 'login' && (
            <Field label="Your name" error={errors.name}>
              <input id="auth-name" autoComplete="name" value={form.name} onChange={set('name')} required />
            </Field>
          )}
          <Field label="Email" error={errors.email}>
            <input id="auth-email" type="email" autoComplete="email" value={email} onChange={set('email')} required />
          </Field>
          <Field label="Password" error={errors.password} hint={mode !== 'login' ? 'At least 8 characters.' : undefined}>
            <input id="auth-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={form.password} onChange={set('password')} required />
          </Field>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          {mode === 'login' && (
            <p className="auth-switch">New here? <button type="button" className="link-btn" onClick={() => switchTo('register')}>Create an account</button></p>
          )}
          {mode === 'register' && (
            <p className="auth-switch">Already have an account? <button type="button" className="link-btn" onClick={() => switchTo('login')}>Sign in</button></p>
          )}
        </form>
      </section>
    </main>
  );
}
