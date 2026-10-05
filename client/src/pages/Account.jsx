import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { ErrorNote, Field, useSubmit } from '../components/ui.jsx';

export default function Account() {
  const { user } = useAuth();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const [done, setDone] = useState(false);
  const { busy, error, submit, setError } = useSubmit(async () => {
    if (f.new_password !== f.confirm) return setError(new Error('New passwords do not match'));
    await api.post('/auth/password', f);
    setF({ current_password: '', new_password: '', confirm: '' });
    setDone(true);
  });
  const set = (k) => (e) => { setDone(false); setF({ ...f, [k]: e.target.value }); };

  return (
    <div className="page narrow">
      <h1>My account</h1>
      <section className="card">
        <dl className="details">
          <div><dt>Name</dt><dd>{user.name}</dd></div>
          <div><dt>Email</dt><dd>{user.email}</dd></div>
          <div><dt>Access</dt><dd>{user.isSuperuser ? 'Superuser — all programs'
            : user.programs.map((p) => `${p.name} (${p.access})`).join(', ') || 'No programs assigned'}</dd></div>
        </dl>
      </section>
      <section className="card">
        <h2>Change password</h2>
        <form onSubmit={submit} className="form-grid">
          <ErrorNote error={error} />
          {done && <div className="note note-good span-2" role="status">✓ Password updated.</div>}
          <Field label="Current password" span={2}><input type="password" autoComplete="current-password" value={f.current_password} onChange={set('current_password')} required /></Field>
          <Field label="New password"><input type="password" autoComplete="new-password" minLength={8} value={f.new_password} onChange={set('new_password')} required /></Field>
          <Field label="Confirm new password"><input type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} required /></Field>
          <div className="form-actions span-2"><button className="btn btn-primary" disabled={busy}>Update password</button></div>
        </form>
      </section>
    </div>
  );
}
