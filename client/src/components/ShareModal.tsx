import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import type { Invite, Sharing } from '../types';
import { Avatar, ConfirmButton, ErrorState, Field, Modal, Spinner, useToast } from './ui';

const ROLE_LABEL = { editor: 'Can edit', viewer: 'Can view & comment' } as const;
type Role = keyof typeof ROLE_LABEL;

const inviteUrl = (token: string) => `${window.location.origin}/join/${token}`;

/** Copies text, falling back to selecting it in `fallbackId` when the clipboard is unavailable. */
async function copy(text: string, toast: (t: string, tone?: 'ok' | 'error') => void, fallbackId?: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied');
  } catch {
    const el = fallbackId ? (document.getElementById(fallbackId) as HTMLInputElement | null) : null;
    el?.select();
    toast('Select the link and copy it', 'error');
  }
}

export default function ShareModal({ boardId, onClose }: { boardId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['sharing', boardId];
  // Always fresh: someone may have joined through a link since this was last opened.
  const sharing = useQuery({ queryKey: key, queryFn: () => api<Sharing>(`/boards/${boardId}/sharing`), staleTime: 0, refetchOnMount: 'always' });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [linkRole, setLinkRole] = useState<Role>('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState<Invite | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['board', boardId] });
  };
  const run = async (p: Promise<unknown>, ok?: string) => {
    try { await p; refresh(); if (ok) toast(ok); } catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong.', 'error'); }
  };

  async function inviteByEmail(e: FormEvent) {
    e.preventDefault();
    setError('');
    setJustCreated(null);
    if (!email.trim()) return setError('Enter their email address.');
    setBusy(true);
    try {
      const res = await api<{ added?: { name: string }; invite?: Invite }>(`/boards/${boardId}/invites`, { method: 'POST', body: { email, role } });
      if (res.added) toast(`${res.added.name} can now open this project`);
      if (res.invite) setJustCreated(res.invite);
      setEmail('');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the invite.');
    } finally {
      setBusy(false);
    }
  }

  async function createLink() {
    try {
      const res = await api<{ invite: Invite }>(`/boards/${boardId}/invites`, { method: 'POST', body: { role: linkRole } });
      refresh();
      await copy(inviteUrl(res.invite.token), toast);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create the link.', 'error');
    }
  }

  const data = sharing.data;
  const emailInvites = data?.invites.filter((i) => i.email) ?? [];
  const links = data?.invites.filter((i) => !i.email) ?? [];

  return (
    <Modal title="Share project" onClose={onClose} wide>
      {sharing.isPending && <Spinner />}
      {sharing.isError && <ErrorState error={sharing.error} onRetry={() => sharing.refetch()} />}
      {data && (
        <div className="stack share">
          <div className="share-id">
            <span className="muted small">Project ID</span>
            <b>{data.board.code}</b>
            <span className="muted small">People you share with can find the project by this ID.</span>
          </div>

          <form className="stack" onSubmit={inviteByEmail} noValidate>
            <h3>Invite by email</h3>
            <div className="share-row">
              <Field label="Email" error={error}>
                <input id="share-email" type="email" autoComplete="off" placeholder="name@company.com" value={email}
                  onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Access">
                <select id="share-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  <option value="editor">{ROLE_LABEL.editor}</option>
                  <option value="viewer">{ROLE_LABEL.viewer}</option>
                </select>
              </Field>
              <button className="btn btn-primary share-btn" disabled={busy}>{busy ? 'Inviting…' : 'Invite'}</button>
            </div>
            <p className="muted small">If they already have an account they get access straight away. If not, send them the invite link; it adds them when they sign up with that email.</p>
          </form>

          {justCreated && (
            <div className="banner banner-ok" role="status">
              <span><b>{justCreated.email}</b> doesn’t have an account yet. Send them this link:</span>
              <div className="link-row">
                <input id="new-invite-link" readOnly value={inviteUrl(justCreated.token)} onFocus={(e) => e.target.select()} />
                <button type="button" className="btn" onClick={() => copy(inviteUrl(justCreated.token), toast, 'new-invite-link')}>Copy link</button>
              </div>
            </div>
          )}

          <section className="stack">
            <h3>Invite link</h3>
            <p className="muted small">Anyone with the link can join after signing in or creating an account. Switch it off when you’re done.</p>
            {links.map((l) => (
              <div key={l.id} className="link-row">
                <input id={`link-${l.id}`} readOnly value={inviteUrl(l.token)} onFocus={(e) => e.target.select()} aria-label="Invite link" />
                <span className="tag">{ROLE_LABEL[l.role]}</span>
                <button type="button" className="btn" onClick={() => copy(inviteUrl(l.token), toast, `link-${l.id}`)}>Copy</button>
                <ConfirmButton className="btn btn-ghost text-danger" confirmText="Switch off?"
                  onConfirm={() => run(api(`/invites/${l.id}`, { method: 'DELETE' }), 'Link switched off')}>Switch off</ConfirmButton>
              </div>
            ))}
            <div className="row">
              <select id="link-role" aria-label="Access for the new link" value={linkRole} onChange={(e) => setLinkRole(e.target.value as Role)}>
                <option value="editor">{ROLE_LABEL.editor}</option>
                <option value="viewer">{ROLE_LABEL.viewer}</option>
              </select>
              <button type="button" className="btn" onClick={createLink}>Create link &amp; copy</button>
            </div>
          </section>

          <section className="stack">
            <h3>Who has access</h3>
            <ul className="people">
              {data.team.map((u) => (
                <li key={`t${u.id}`}>
                  <Avatar user={u} size={30} />
                  <div><b>{u.name}</b><br /><span className="muted small">{u.email}</span></div>
                  <span className="tag">Studio team</span>
                </li>
              ))}
              {data.members.map((m) => (
                <li key={`m${m.id}`}>
                  <Avatar user={m} size={30} />
                  <div><b>{m.name}</b><br /><span className="muted small">{m.email}</span></div>
                  <select id={`member-role-${m.id}`} aria-label={`Access for ${m.name}`} value={m.role} className="select-sm"
                    onChange={(e) => run(api(`/boards/${boardId}/members/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }), 'Access updated')}>
                    <option value="editor">{ROLE_LABEL.editor}</option>
                    <option value="viewer">{ROLE_LABEL.viewer}</option>
                  </select>
                  <ConfirmButton className="btn btn-ghost btn-sm text-danger" confirmText="Remove?"
                    onConfirm={() => run(api(`/boards/${boardId}/members/${m.id}`, { method: 'DELETE' }), `${m.name} removed`)}>Remove</ConfirmButton>
                </li>
              ))}
              {emailInvites.map((i) => (
                <li key={`i${i.id}`}>
                  <span className="avatar avatar-empty" style={{ width: 30, height: 30 }} aria-hidden />
                  <div><b>{i.email}</b><br /><span className="muted small">Invited · {ROLE_LABEL[i.role]} · hasn’t signed up yet</span></div>
                  <button type="button" className="btn btn-sm" onClick={() => copy(inviteUrl(i.token), toast)}>Copy link</button>
                  <ConfirmButton className="btn btn-ghost btn-sm text-danger" confirmText="Cancel invite?"
                    onConfirm={() => run(api(`/invites/${i.id}`, { method: 'DELETE' }), 'Invite cancelled')}>Cancel</ConfirmButton>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  );
}
