import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import type { Board } from '../types';
import { SWATCHES } from '../util';
import { ColorPicker, Field, Modal } from './ui';

export default function NewBoardModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the board a name.');
    setBusy(true);
    try {
      const board = await api<Board>('/boards', { method: 'POST', body: { name, description, color } });
      qc.invalidateQueries({ queryKey: ['boards'] });
      onClose();
      navigate(`/boards/${board.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the board.');
      setBusy(false);
    }
  }

  return (
    <Modal title="New board" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Field label="Board name" error={error}>
          <input id="board-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Client projects" maxLength={80} />
        </Field>
        <Field label="Description (optional)">
          <textarea id="board-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Colour"><ColorPicker value={color} onChange={setColor} colors={SWATCHES} /></Field>
        <p className="muted small">Starts with statuses To do, In progress, Client review and Done. You can change them later.</p>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create board'}</button>
        </div>
      </form>
    </Modal>
  );
}
