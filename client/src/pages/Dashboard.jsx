import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { BudgetMeter, Empty, ErrorNote, PaceBadge, StatTile } from '../components/ui.jsx';
import MonthlyChart from '../components/MonthlyChart.jsx';
import { fmtDate, money, moneyShort, pct } from '../format.js';

export default function Dashboard() {
  const { user } = useAuth();
  const [programs, setPrograms] = useState([]);
  const [programId, setProgramId] = useState('');
  const [status, setStatus] = useState('active');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.get('/programs').then(setPrograms).catch(setError); }, []);
  useEffect(() => {
    const qs = new URLSearchParams({ status, ...(programId ? { program_id: programId } : {}) });
    api.get(`/dashboard?${qs}`).then(setData).catch(setError);
  }, [programId, status]);

  const scope = programId ? programs.find((p) => String(p.id) === programId)?.name
    : user.isSuperuser ? 'All programs' : programs.map((p) => p.name).join(', ');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">{scope}{data ? ` · as of ${fmtDate(data.as_of)}` : ''}</p>
        </div>
        <div className="filters">
          {programs.length > 1 && (
            <select value={programId} onChange={(e) => setProgramId(e.target.value)} aria-label="Program">
              <option value="">All programs</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Grant status">
            <option value="active">Active grants</option>
            <option value="pending">Pending grants</option>
            <option value="closed">Closed grants</option>
            <option value="all">All grants</option>
          </select>
        </div>
      </div>

      <ErrorNote error={error} />
      {!data ? <div className="muted">Loading…</div> : <DashboardBody data={data} showPrograms={!programId && data.programs.length > 1} />}
    </div>
  );
}

function DashboardBody({ data, showPrograms }) {
  const t = data.totals;
  if (!t.grant_count) return <Empty>No grants match these filters yet. Add one from the <Link to="/grants">Grants</Link> page.</Empty>;

  const alerts = data.upcoming_reports.length + data.over_budget_lines.length + data.ending_soon.length;

  return (
    <>
      <section className="stats">
        <StatTile label="Remaining funds" value={money(t.remaining)} sub={`${pct(t.remaining, t.award)} of awards unspent`} emphasis />
        <StatTile label="Total awarded" value={money(t.award)} sub={`${t.grant_count} grant${t.grant_count === 1 ? '' : 's'}`} />
        <StatTile label="Spent to date" value={money(t.spent)} sub={`${pct(t.spent, t.award)} of awards`} />
        <StatTile label="Unbudgeted" value={money(t.award - t.budgeted)} sub="Award not yet assigned to budget lines" />
      </section>

      <div className="grid-2">
        {showPrograms && (
          <section className="card">
            <h2>Remaining funds by program</h2>
            <div className="legend"><span className="key key-spent" /> Spent <span className="key key-remaining" /> Remaining</div>
            <div className="rows">
              {data.programs.map((p) => (
                <div key={p.program_id} className="row-meter">
                  <div className="row-meter-head">
                    <strong>{p.program_name}</strong>
                    <span className="num">{money(p.remaining)} <span className="muted">left of {moneyShort(p.award)}</span></span>
                  </div>
                  <BudgetMeter spent={p.spent} total={p.award} />
                  <div className="muted small">{p.grants} grant{p.grants === 1 ? '' : 's'} · {pct(p.spent, p.award)} spent</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="card">
          <h2>Monthly spending</h2>
          <p className="muted small">Expenses recorded over the last 12 months</p>
          <MonthlyChart data={data.monthly_spending} />
        </section>

        {!showPrograms && <CategoryCard rows={data.by_category} />}
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Grants</h2>
          <div className="legend small">
            <span className="key key-spent" /> Spent <span className="key key-tick" /> Time elapsed in grant period
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Grant</th><th>Program</th><th>Ends</th>
                <th className="num">Award</th><th className="num">Spent</th><th className="num">Remaining</th>
                <th style={{ minWidth: 140 }}>Burn vs. time</th><th>Pace</th>
              </tr>
            </thead>
            <tbody>
              {data.grants.map((g) => (
                <tr key={g.id}>
                  <td><Link to={`/grants/${g.id}`}>{g.name}</Link><div className="muted small">{g.funder_name ?? 'No funder'}</div></td>
                  <td>{g.program_name}</td>
                  <td>{fmtDate(g.end_date)}<div className="muted small">{g.days_remaining >= 0 ? `${g.days_remaining} days left` : 'Ended'}</div></td>
                  <td className="num">{money(g.award_amount)}</td>
                  <td className="num">{money(g.spent)}</td>
                  <td className={`num ${g.remaining < 0 ? 'text-critical' : ''}`}><strong>{money(g.remaining)}</strong></td>
                  <td><BudgetMeter spent={g.spent} total={g.award_amount} timeElapsed={g.status === 'active' ? g.time_elapsed : null} compact /></td>
                  <td><PaceBadge pace={g.pace} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td className="num">{money(t.award)}</td><td className="num">{money(t.spent)}</td>
                <td className="num"><strong>{money(t.remaining)}</strong></td><td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Needs attention {alerts > 0 && <span className="count">{alerts}</span>}</h2>
          {alerts === 0 && <p className="muted">Nothing needs attention right now.</p>}
          <ul className="alerts">
            {data.upcoming_reports.map((r) => (
              <li key={`r${r.id}`} className={r.overdue ? 'alert-critical' : 'alert-warning'}>
                <span className="alert-icon" aria-hidden="true">{r.overdue ? '⚠' : '◷'}</span>
                <div>
                  <strong>{r.overdue ? 'Overdue' : 'Due'} {fmtDate(r.due_date)}:</strong> {r.title}
                  <div className="muted small"><Link to={`/grants/${r.grant_id}?tab=reports`}>{r.grant_name}</Link> · {r.program_name}</div>
                </div>
              </li>
            ))}
            {data.over_budget_lines.map((l) => (
              <li key={`l${l.id}`} className="alert-critical">
                <span className="alert-icon" aria-hidden="true">⚠</span>
                <div>
                  <strong>Over budget by {money(l.spent - l.approved_amount)}:</strong> {l.name}
                  <div className="muted small"><Link to={`/grants/${l.grant_id}`}>{l.grant_name}</Link> · {money(l.spent)} of {money(l.approved_amount)}</div>
                </div>
              </li>
            ))}
            {data.ending_soon.map((g) => (
              <li key={`g${g.id}`} className="alert-warning">
                <span className="alert-icon" aria-hidden="true">◷</span>
                <div>
                  <strong>Ends in {g.days_remaining} days:</strong> <Link to={`/grants/${g.id}`}>{g.name}</Link>
                  <div className="muted small">{money(g.remaining)} still unspent</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
        {showPrograms && <CategoryCard rows={data.by_category} />}
      </div>
    </>
  );
}

function CategoryCard({ rows }) {
  return (
    <section className="card">
      <h2>Budget by category</h2>
      <div className="legend"><span className="key key-spent" /> Spent <span className="key key-remaining" /> Remaining of approved</div>
      {rows.length === 0 ? <p className="muted">No budget lines yet.</p> : (
        <div className="rows">
          {rows.map((c) => (
            <div key={c.category} className="row-meter">
              <div className="row-meter-head">
                <span>{c.category}</span>
                <span className="num small">{money(c.spent)} <span className="muted">of {money(c.approved)}</span></span>
              </div>
              <BudgetMeter spent={c.spent} total={c.approved} compact />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
