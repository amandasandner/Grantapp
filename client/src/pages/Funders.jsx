import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { Empty, ErrorNote, Field, Modal, useSubmit } from '../components/ui.jsx';

export default function Funders() {
  const { user, canManage } = useAuth();
  const [funders, setFunders] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const load = () => api.get('/funders').then(setFunders).catch(setError);
  useEffect(() => { load(); }, []);

  const remove = async (f) => {
    if (!window.confirm(`Delete funder "${f.name}"? Grants from this funder will show no funder.`)) return;
    try { await api.del(`/funders/${f.id}`); load(); } catch (e) { setError(e); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Funders</h1><p className="muted">Foundations, agencies, and donors your programs receive grants from</p></div>
        {canManage && <button className="btn btn-primary" onClick={() => setEditing({})}>+ New funder</button>}
      </div>
      <ErrorNote error={error} />
      {funders && funders.length === 0 && <Empty>No funders yet.</Empty>}
      {funders && funders.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Funder</th><th>Contact</th><th>Website</th><th>Notes</th>{canManage && <th />}</tr></thead>
            <tbody>
              {funders.map((f) => (
                <tr key={f.id}>
                  <td><strong>{f.name}</strong></td>
                  <td>{f.contact_name || '—'}{f.contact_email && <div className="small"><a href={`mailto:${f.contact_email}`}>{f.contact_email}</a></div>}</td>
                  <td>{/^https?:\/\//.test(f.website) ? <a href={f.website} target="_blank" rel="noreferrer">{f.website.replace(/^https?:\/\//, '')}</a> : (f.website || '—')}</td>
                  <td className="muted small">{f.notes}</td>
                  {canManage && (
                    <td className="row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(f)}>Edit</button>
                      {user.isSuperuser && <button className="btn btn-ghost btn-sm" onClick={() => remove(f)}>Delete</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <FunderForm funder={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function FunderForm({ funder, onClose, onSaved }) {
  const [f, setF] = useState({
    name: funder?.name ?? '', contact_name: funder?.contact_name ?? '', contact_email: funder?.contact_email ?? '',
    website: funder?.website ?? '', notes: funder?.notes ?? '',
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const { busy, error, submit } = useSubmit(async () => {
    if (funder) await api.put(`/funders/${funder.id}`, f);
    else await api.post('/funders', f);
    onSaved();
  });
  return (
    <Modal title={funder ? 'Edit funder' : 'New funder'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <ErrorNote error={error} />
        <Field label="Name" span={2}><input value={f.name} onChange={set('name')} required /></Field>
        <Field label="Contact name"><input value={f.contact_name} onChange={set('contact_name')} /></Field>
        <Field label="Contact email"><input type="email" value={f.contact_email} onChange={set('contact_email')} /></Field>
        <Field label="Website" span={2}><input type="url" value={f.website} onChange={set('website')} placeholder="https://" /></Field>
        <Field label="Notes" span={2}><textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>
        <div className="form-actions span-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
