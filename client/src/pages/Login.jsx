import { useState } from 'react';
import { api } from '../api.js';
import { ErrorNote, Field, useSubmit } from '../components/ui.jsx';

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    await api.post('/auth/login', { email, password });
    await onSignedIn();
  });

  return (
    <div className="center-screen">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand brand-large">
          <span className="brand-mark" aria-hidden="true">$</span>
          <span>Grant Tracker</span>
        </div>
        <p className="muted">Sign in to manage grant awards, budgets, and expenses.</p>
        <ErrorNote error={error} />
        <Field label="Email">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
