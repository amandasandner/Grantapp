import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import GrantForm from '../components/GrantForm.jsx';
import { BudgetMeter, Empty, ErrorNote, StatusPill } from '../components/ui.jsx';
import { fmtDate, money } from '../format.js';

export default function GrantList() {
  const { canManage } = useAuth();
  const navigate = useNavigate();
  const [programs, setPrograms] = useState([]);
  const [grants, setGrants] = useState(null);
  const [filters, setFilters] = useState({ program_id: '', status: '', q: '' });
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { api.get('/programs').then(setPrograms).catch(setError); }, []);
  useEffect(() => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const t = setTimeout(() => api.get(`/grants?${qs}`).then(setGrants).catch(setError), filters.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [filters]);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Grants</h1>
          <p className="muted">Awards, approved budgets, and grant periods</p>
        </div>
        {canManage && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New grant</button>}
      </div>

      <div className="filters filters-bar">
        <input type="search" placeholder="Search name, award #, funder…" value={filters.q} onChange={set('q')} aria-label="Search grants" />
        {programs.length > 1 && (
          <select value={filters.program_id} onChange={set('program_id')} aria-label="Program">
            <option value="">All programs</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select value={filters.status} onChange={set('status')} aria-label="Status">
          <option value="">Any status</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <ErrorNote error={error} />
      {grants && grants.length === 0 && <Empty>No grants found.</Empty>}
      {grants && grants.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Grant</th><th>Program</th><th>Funder</th><th>Status</th><th>Period</th>
                <th className="num">Award</th><th className="num">Remaining</th><th style={{ minWidth: 120 }}>Spent</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id} className="clickable" onClick={() => navigate(`/grants/${g.id}`)}>
                  <td><Link to={`/grants/${g.id}`} onClick={(e) => e.stopPropagation()}>{g.name}</Link>
                    {g.award_number && <div className="muted small">{g.award_number}</div>}</td>
                  <td>{g.program_name}</td>
                  <td>{g.funder_name ?? '—'}</td>
                  <td><StatusPill status={g.status} /></td>
                  <td className="nowrap">{fmtDate(g.start_date)} – {fmtDate(g.end_date)}</td>
                  <td className="num">{money(g.award_amount)}</td>
                  <td className={`num ${g.remaining < 0 ? 'text-critical' : ''}`}>{money(g.remaining)}</td>
                  <td><BudgetMeter spent={g.spent} total={g.award_amount} compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <GrantForm onClose={() => setCreating(false)} onSaved={(g) => navigate(`/grants/${g.id}`)} />
      )}
    </div>
  );
}
