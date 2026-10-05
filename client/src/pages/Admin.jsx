import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { ErrorNote, Field, Modal, useSubmit } from '../components/ui.jsx';

export default function Admin() {
  const { user: me, refresh } = useAuth();
  const [programs, setPrograms] = useState([]);
  const [users, setUsers] = useState([]);
  const [editingUser, setEditingUser] = useState(null);
  const [editingProgram, setEditingProgram] = useState(null);
  const [error, setError] = useState(null);

  const load = () => Promise.all([api.get('/programs'), api.get('/users')])
    .then(([p, u]) => { setPrograms(p); setUsers(u); }).catch(setError);
  useEffect(() => { load(); }, []);

  const removeProgram = async (p) => {
    if (!window.confirm(`Delete program "${p.name}"?`)) return;
    try { await api.del(`/programs/${p.id}`); load(); } catch (e) { setError(e); }
  };
  const removeUser = async (u) => {
    if (!window.confirm(`Delete user ${u.name}? Consider deactivating instead to keep history.`)) return;
    try { await api.del(`/users/${u.id}`); load(); } catch (e) { setError(e); }
  };

  return (
    <div className="page">
      <div className="page-head"><div><h1>Administration</h1><p className="muted">Mission programs, users, and who can see what</p></div></div>
      <ErrorNote error={error} />

      <section className="card">
        <div className="card-head">
          <h2>Mission programs</h2>
          <button className="btn btn-primary" onClick={() => setEditingProgram({})}>+ New program</button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Program</th><th>Description</th><th>Members</th><th /></tr></thead>
            <tbody>
              {programs.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td className="muted">{p.description}</td>
                  <td>{users.filter((u) => u.programs.some((m) => m.id === p.id)).length}</td>
                  <td className="row-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingProgram(p)}>Edit</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => removeProgram(p)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Users & permissions</h2>
          <button className="btn btn-primary" onClick={() => setEditingUser({})}>+ New user</button>
        </div>
        <p className="muted small">
          <strong>Superusers</strong> see and manage every program. Other users only see the programs they are assigned to —
          as a <strong>manager</strong> (can add and edit grants, budgets, expenses) or a <strong>viewer</strong> (read-only).
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Status</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong></td>
                  <td>{u.email}</td>
                  <td>
                    {u.is_superuser ? <span className="pill pill-super">Superuser · all programs</span>
                      : u.programs.length === 0 ? <span className="muted">No programs</span>
                        : u.programs.map((p) => <span key={p.id} className="pill pill-member">{p.name} · {p.access}</span>)}
                  </td>
                  <td>{u.active ? 'Active' : <span className="muted">Deactivated</span>}</td>
                  <td className="row-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingUser(u)}>Edit</button>
                    {u.id !== me.id && <button className="btn btn-ghost btn-sm" onClick={() => removeUser(u)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editingProgram && (
        <ProgramForm program={editingProgram.id ? editingProgram : null} onClose={() => setEditingProgram(null)}
          onSaved={() => { setEditingProgram(null); load(); refresh(); }} />
      )}
      {editingUser && (
        <UserForm user={editingUser.id ? editingUser : null} programs={programs} isSelf={editingUser.id === me.id}
          onClose={() => setEditingUser(null)} onSaved={() => { setEditingUser(null); load(); refresh(); }} />
      )}
    </div>
  );
}

function ProgramForm({ program, onClose, onSaved }) {
  const [f, setF] = useState({ name: program?.name ?? '', description: program?.description ?? '' });
  const { busy, error, submit } = useSubmit(async () => {
    if (program) await api.put(`/programs/${program.id}`, f);
    else await api.post('/programs', f);
    onSaved();
  });
  return (
    <Modal title={program ? 'Edit program' : 'New mission program'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <ErrorNote error={error} />
        <Field label="Name" span={2}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Description" span={2}><textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="form-actions span-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function UserForm({ user, programs, isSelf, onClose, onSaved }) {
  const [f, setF] = useState({
    name: user?.name ?? '', email: user?.email ?? '', password: '',
    is_superuser: user?.is_superuser ?? false, active: user?.active ?? true,
  });
  const [access, setAccess] = useState(() => Object.fromEntries((user?.programs ?? []).map((p) => [p.id, p.access])));
  const { busy, error, submit } = useSubmit(async () => {
    const body = {
      ...f,
      password: f.password || undefined,
      programs: Object.entries(access).filter(([, a]) => a).map(([id, a]) => ({ id: Number(id), access: a })),
    };
    if (user) await api.put(`/users/${user.id}`, body);
    else await api.post('/users', body);
    onSaved();
  });
  return (
    <Modal title={user ? `Edit ${user.name}` : 'New user'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <ErrorNote error={error} />
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label={user ? 'Reset password' : 'Temporary password'} hint="At least 8 characters" span={2}>
          <input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })}
            required={!user} minLength={8} placeholder={user ? 'Leave blank to keep current password' : ''} />
        </Field>
        <label className="check span-2">
          <input type="checkbox" checked={f.is_superuser} disabled={isSelf} onChange={(e) => setF({ ...f, is_superuser: e.target.checked })} />
          Superuser — can see and manage all programs, users, and settings
        </label>
        {!f.is_superuser && (
          <fieldset className="span-2 access-grid">
            <legend>Program access</legend>
            {programs.map((p) => (
              <div key={p.id} className="access-row">
                <span>{p.name}</span>
                <select value={access[p.id] ?? ''} onChange={(e) => setAccess({ ...access, [p.id]: e.target.value })} aria-label={`Access to ${p.name}`}>
                  <option value="">No access</option>
                  <option value="viewer">Viewer (read-only)</option>
                  <option value="manager">Manager (can edit)</option>
                </select>
              </div>
            ))}
          </fieldset>
        )}
        {user && !isSelf && (
          <label className="check span-2">
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Account active
          </label>
        )}
        <div className="form-actions span-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save user'}</button>
        </div>
      </form>
    </Modal>
  );
}
