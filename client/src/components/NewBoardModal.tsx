import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import type { Board } from '../types';
import { SWATCHES, addDays, isoDay } from '../util';
import { ColorPicker, Field, Modal } from './ui';
import ImportMonday from './ImportMonday';

interface Template { id: string; name: string; description: string; tasks: number }

/** The coming Monday (or today if it is Monday): template dates count from the start day. */
function nextMonday(): string {
  const d = new Date();
  return isoDay(addDays(d, (8 - d.getDay()) % 7));
}

export default function NewBoardModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [template, setTemplate] = useState('');
  const [startDate, setStartDate] = useState(nextMonday);
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api<Template[]>('/templates'), staleTime: Infinity });
  const chosen = templates.data?.find((t) => t.id === template);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the board a name.');
    setBusy(true);
    try {
      const body = template ? { name, description, color, template, start_date: startDate } : { name, description, color };
      const board = await api<Board>('/boards', { method: 'POST', body });
      qc.invalidateQueries({ queryKey: ['boards'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
      onClose();
      navigate(`/boards/${board.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the board.');
      setBusy(false);
    }
  }

  return (
    <Modal title={template === 'monday' ? 'Import from Monday.com' : 'New board'} onClose={onClose}>
      <Field label="Start from">
        <select id="board-template" value={template} onChange={(e) => setTemplate(e.target.value)}>
          <option value="">Blank board</option>
          {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          <option value="monday">Import from Monday.com</option>
        </select>
      </Field>
      {template === 'monday' ? <div className="modal-gap"><ImportMonday onClose={onClose} /></div> : (
      <form onSubmit={submit} className="stack modal-gap">
        {chosen && (
          <Field label="Project start date" hint={`${chosen.tasks} tasks across Discovery, Design, Build, Review and Launch, dated from this day. Assigned to you and your designer.`}>
            <input id="board-start" type="date" value={startDate} required onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        )}
        <Field label="Board name" error={error}>
          <input id="board-name" value={name} onChange={(e) => setName(e.target.value)}
            placeholder={template ? 'e.g. Website – Client name' : 'e.g. Client projects'} maxLength={80} />
        </Field>
        <Field label="Description (optional)">
          <textarea id="board-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Colour"><ColorPicker value={color} onChange={setColor} colors={SWATCHES} /></Field>
        {!chosen && <p className="muted small">Starts with statuses To do, In progress, Client review and Done. You can change them later.</p>}
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create board'}</button>
        </div>
      </form>
      )}
    </Modal>
  );
}
