import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { fromCents, toCents } from '../format.js';
import { ErrorNote, Field, Modal, useSubmit } from './ui.jsx';

const NEW_FUNDER = '__new__';

export default function GrantForm({ grant, onClose, onSaved }) {
  const { user } = useAuth();
  const [programs, setPrograms] = useState([]);
  const [funders, setFunders] = useState([]);
  const [newFunder, setNewFunder] = useState('');
  const [f, setF] = useState(() => ({
    program_id: grant?.program_id ?? '',
    funder_id: grant?.funder_id ?? '',
    name: grant?.name ?? '',
    award_number: grant?.award_number ?? '',
    status: grant?.status ?? 'active',
    award_amount: fromCents(grant?.award_amount),
    award_date: grant?.award_date ?? '',
    start_date: grant?.start_date ?? '',
    end_date: grant?.end_date ?? '',
    restrictions: grant?.restrictions ?? '',
    notes: grant?.notes ?? '',
  }));
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  useEffect(() => {
    api.get('/programs').then((all) => {
      const editable = user.isSuperuser ? all : all.filter((p) => user.programs.some((m) => m.id === p.id && m.access === 'manager'));
      setPrograms(editable);
      if (!grant && editable.length === 1) setF((prev) => ({ ...prev, program_id: editable[0].id }));
    });
    api.get('/funders').then(setFunders);
  }, [user, grant]);

  const { busy, error, submit, setError } = useSubmit(async () => {
    const award = toCents(f.award_amount);
    if (Number.isNaN(award)) return setError(new Error('Award amount must be a dollar amount'));
    let funderId = f.funder_id;
    if (funderId === NEW_FUNDER) {
      if (!newFunder.trim()) return setError(new Error('Enter the new funder name'));
      funderId = (await api.post('/funders', { name: newFunder })).id;
    }
    const body = { ...f, funder_id: funderId || null, award_amount: award };
    const saved = grant ? await api.put(`/grants/${grant.id}`, body) : await api.post('/grants', body);
    onSaved(saved);
  });

  return (
    <Modal title={grant ? 'Edit grant' : 'New grant award'} onClose={onClose} wide>
      <form onSubmit={submit} className="form-grid">
        <ErrorNote error={error} />
        <Field label="Grant name" span={2}>
          <input value={f.name} onChange={set('name')} required />
        </Field>
        <Field label="Mission program">
          <select value={f.program_id} onChange={set('program_id')} required>
            <option value="" disabled>Select a program</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Funder">
          <select value={f.funder_id ?? ''} onChange={set('funder_id')}>
            <option value="">— None —</option>
            {funders.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            <option value={NEW_FUNDER}>+ Add new funder…</option>
          </select>
        </Field>
        {f.funder_id === NEW_FUNDER && (
          <Field label="New funder name" span={2}>
            <input value={newFunder} onChange={(e) => setNewFunder(e.target.value)} />
          </Field>
        )}
        <Field label="Award / grant number">
          <input value={f.award_number} onChange={set('award_number')} />
        </Field>
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
        <Field label="Award amount ($)">
          <input inputMode="decimal" value={f.award_amount} onChange={set('award_amount')} placeholder="0.00" required />
        </Field>
        <Field label="Award date">
          <input type="date" value={f.award_date ?? ''} onChange={set('award_date')} />
        </Field>
        <Field label="Grant period start">
          <input type="date" value={f.start_date} onChange={set('start_date')} required />
        </Field>
        <Field label="Grant period end">
          <input type="date" value={f.end_date} onChange={set('end_date')} min={f.start_date || undefined} required />
        </Field>
        <Field label="Restrictions / allowable costs" span={2}>
          <textarea rows={2} value={f.restrictions} onChange={set('restrictions')} />
        </Field>
        <Field label="Notes" span={2}>
          <textarea rows={2} value={f.notes} onChange={set('notes')} />
        </Field>
        <div className="form-actions span-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : grant ? 'Save changes' : 'Create grant'}</button>
        </div>
      </form>
    </Modal>
  );
}
