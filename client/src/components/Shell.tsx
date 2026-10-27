import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, useBoards, useSearch } from '../api';
import type { Board, User } from '../types';
import { Avatar, Pill } from './ui';
import NewBoardModal from './NewBoardModal';

export default function Shell({ user, children }: { user: User; children: ReactNode }) {
  const boards = useBoards();
  const qc = useQueryClient();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    qc.clear();
    qc.setQueryData(['auth'], { needsSetup: false, user: null });
  }

  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className="sidebar" aria-label="Main navigation">
        <Link to="/" className="logo"><span>orchestr</span><b>-8</b></Link>
        <SearchBox />
        <nav className="side-nav">
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/settings">Settings &amp; team</NavLink>
        </nav>
        <div className="side-section">
          <span className="side-title">{user.guest ? 'Shared with you' : 'Boards'}</span>
          {!user.guest && <button className="side-add" onClick={() => setCreating(true)} aria-label="New board">+</button>}
        </div>
        <nav className="side-boards">
          {boards.data?.map((b: Board) => (
            <NavLink key={b.id} to={`/boards/${b.id}`}>
              <span className="dot" style={{ background: b.color }} />{b.name}
            </NavLink>
          ))}
          {boards.data?.length === 0 && <span className="side-empty">{user.guest ? 'Nothing shared yet' : 'No boards yet'}</span>}
        </nav>
        <div className="side-foot">
          <Avatar user={user} />
          <span className="side-user">{user.name}</span>
          <button className="side-link" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setMenuOpen(false)} />
      <div className="main-col">
        <header className="topbar-mobile">
          <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">☰</button>
          <Link to="/" className="logo logo-sm"><span>orchestr</span><b>-8</b></Link>
        </header>
        <main id="main" className="main">{children}</main>
      </div>
      {creating && <NewBoardModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function SearchBox() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const hits = useSearch(q);
  const navigate = useNavigate();
  return (
    <div className="search" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <input id="global-search" type="search" placeholder="Search or PRJ-0001…" aria-label="Search tasks and projects"
        value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && q.trim().length >= 2 && (
        <div className="search-results">
          {hits.isPending && <span className="muted">Searching…</span>}
          {hits.data?.length === 0 && <span className="muted">No tasks match “{q}”.</span>}
          {hits.data?.map((h) => h.kind === 'board' ? (
            <button key={`b${h.board_id}`} onClick={() => { navigate(`/boards/${h.board_id}`); setOpen(false); setQ(''); }}>
              <span className="search-title"><span className="dot" style={{ background: h.board_color }} /> {h.title}</span>
              <span className="search-meta">Project · {h.board_code}</span>
            </button>
          ) : (
            <button key={h.id} onClick={() => { navigate(`/boards/${h.board_id}?task=${h.id}`); setOpen(false); setQ(''); }}>
              <span className="search-title">{h.title}</span>
              <span className="search-meta">{h.board_name} · {h.board_code} · <Pill color={h.status_color}>{h.status_name}</Pill></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
