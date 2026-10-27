import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, useBoards, useUsers } from '../api';
import { Avatar, ColorPicker, ConfirmButton, ErrorState, Field, Spinner, useToast } from '../components/ui';
import type { User } from '../types';

const PEOPLE_COLORS = ['#5b5bd6', '#d6409f', '#12a594', '#f76b15', '#0090ff', '#e5484d', '#8e4ec6', '#30a46c'];

export default function SettingsPage({ user }: { user: User }) {
  return (
    <div className="page page-narrow">
      <header className="page-head"><h1>Settings &amp; team</h1></header>
      <Profile user={user} />
      <Appearance />
      <Team user={user} />
      <Password />
      <Archived />
    </div>
  );
}

function Profile({ user }: { user: User }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [color, setColor] = useState(user.color);
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const u = await api<User>(`/users/${user.id}`, { method: 'PATCH', body: { name, color } });
      qc.setQueryData(['auth'], { needsSetup: false, user: u });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast('Profile saved');
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not save.', 'error'); }
  }
  return (
    <section className="panel stack">
      <h2>Your profile</h2>
      <form className="stack" onSubmit={save}>
        <div className="row"><Avatar user={{ name, color }} size={40} /><span className="muted">{user.email} · {user.role === 'owner' ? 'Owner' : 'Member'}</span></div>
        <Field label="Display name"><input id="profile-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Avatar colour"><ColorPicker value={color} onChange={setColor} colors={PEOPLE_COLORS} /></Field>
        <div className="row-end"><button className="btn btn-primary">Save profile</button></div>
      </form>
    </section>
  );
}

function Appearance() {
  const read = () => { try { return localStorage.getItem('i8-theme') ?? 'system'; } catch { return 'system'; } };
  const [theme, setTheme] = useState(read);
  function choose(t: string) {
    setTheme(t);
    try { if (t === 'system') localStorage.removeItem('i8-theme'); else localStorage.setItem('i8-theme', t); } catch { /* ignore */ }
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  }
  return (
    <section className="panel stack">
      <h2>Appearance</h2>
      <div className="seg" role="radiogroup" aria-label="Theme">
        {['system', 'light', 'dark'].map((t) => (
          <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? 'is-on' : ''} onClick={() => choose(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
    </section>
  );
}

function Team({ user }: { user: User }) {
  const users = useUsers();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isOwner = user.role === 'owner';

  async function add(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    try {
      await api('/users', { method: 'POST', body: form });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast(`${form.name} added. Share the email and password with them.`);
      setForm({ name: '', email: '', password: '', role: 'member' });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.errors ?? { _: err.message });
    }
  }
  async function remove(u: User) {
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast(`${u.name} removed`);
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not remove.', 'error'); }
  }

  return (
    <section className="panel stack">
      <h2>Team</h2>
      {users.isPending && <Spinner />}
      {users.isError && <ErrorState error={users.error} onRetry={() => users.refetch()} />}
      <ul className="people">
        {users.data?.map((u) => (
          <li key={u.id}>
            <Avatar user={u} size={32} />
            <div><b>{u.name}</b>{u.id === user.id && <span className="muted"> (you)</span>}<br /><span className="muted small">{u.email}</span></div>
            <span className="tag">{u.role === 'owner' ? 'Owner' : 'Member'}</span>
            {isOwner && u.id !== user.id && <ConfirmButton className="btn btn-ghost btn-sm text-danger" onConfirm={() => remove(u)}>Remove</ConfirmButton>}
          </li>
        ))}
      </ul>
      {isOwner ? (
        <form className="stack" onSubmit={add} noValidate>
          <h3>Add a team member</h3>
          {errors._ && <div className="banner banner-error">{errors._}</div>}
          <div className="grid-2">
            <Field label="Name" error={errors.name}><input id="tm-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email" error={errors.email}><input id="tm-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Temporary password" error={errors.password} hint="At least 8 characters. Ask them to change it.">
              <input id="tm-password" type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Role">
              <select id="tm-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="member">Member: can edit all boards</option>
                <option value="owner">Owner: also manages team</option>
              </select>
            </Field>
          </div>
          <div className="row-end"><button className="btn btn-primary">Add member</button></div>
        </form>
      ) : <p className="muted small">Only the owner can add or remove people.</p>}
    </section>
  );
}

function Password() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function save(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    try {
      await api('/me/password', { method: 'POST', body: form });
      setForm({ currentPassword: '', newPassword: '' });
      toast('Password changed');
    } catch (err) { if (err instanceof ApiError) setErrors(err.errors ?? { newPassword: err.message }); }
  }
  return (
    <section className="panel">
      <h2>Change password</h2>
      <form className="stack" onSubmit={save} noValidate>
        <div className="grid-2">
          <Field label="Current password" error={errors.currentPassword}>
            <input id="pw-current" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
          </Field>
          <Field label="New password" error={errors.newPassword} hint="At least 8 characters.">
            <input id="pw-new" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          </Field>
        </div>
        <div className="row-end"><button className="btn btn-primary">Change password</button></div>
      </form>
    </section>
  );
}

function Archived() {
  const boards = useBoards(true);
  return (
    <section className="panel">
      <h2>Archived boards</h2>
      {boards.data?.length === 0 && <p className="muted small">No archived boards.</p>}
      <ul className="people">
        {boards.data?.map((b) => (
          <li key={b.id}><span className="dot" style={{ background: b.color }} /><Link to={`/boards/${b.id}`}>{b.name}</Link>
            <span className="muted small">{b.task_count} tasks</span></li>
        ))}
      </ul>
    </section>
  );
}
