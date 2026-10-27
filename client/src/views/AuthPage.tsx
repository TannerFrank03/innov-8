import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { Field } from '../components/ui';
import type { User } from '../types';

export default function AuthPage({ setup }: { setup: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage('');
    try {
      const body = setup ? form : { email: form.email, password: form.password };
      const { user } = await api<{ user: User }>(setup ? '/auth/setup' : '/auth/login', { method: 'POST', body });
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

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <main className="auth">
      <section className="auth-brand" aria-hidden>
        <div className="logo logo-lg"><span>orchestr</span><b>-8</b></div>
        <p>Plan the work. Ship the work.</p>
        <span className="auth-by">An innov-8 studio tool</span>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit} noValidate>
          <h1>{setup ? 'Set up your studio' : 'Sign in'}</h1>
          <p className="muted">
            {setup ? 'Create the owner account. You can add your designer next.' : 'Welcome back. Pick up where you left off.'}
          </p>
          {message && <div className="banner banner-error" role="alert">{message}</div>}
          {setup && (
            <Field label="Your name" error={errors.name}>
              <input id="auth-name" autoComplete="name" value={form.name} onChange={set('name')} required />
            </Field>
          )}
          <Field label="Email" error={errors.email}>
            <input id="auth-email" type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
          </Field>
          <Field label="Password" error={errors.password} hint={setup ? 'At least 8 characters.' : undefined}>
            <input id="auth-password" type="password" autoComplete={setup ? 'new-password' : 'current-password'}
              value={form.password} onChange={set('password')} required />
          </Field>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : setup ? 'Create account' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
