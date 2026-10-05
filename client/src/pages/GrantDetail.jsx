import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import GrantForm from '../components/GrantForm.jsx';
import {
  BudgetMeter, Empty, ErrorNote, Field, Modal, PaceBadge, StatTile, StatusPill, useSubmit,
} from '../components/ui.jsx';
import { fmtDate, fromCents, money, pct, toCents, todayIso } from '../format.js';

const CATEGORIES = ['Personnel', 'Fringe', 'Travel', 'Equipment', 'Supplies', 'Contractual', 'Direct assistance', 'Indirect', 'Other'];
const TABS = [['budget', 'Budget'], ['expenses', 'Expenses'], ['reports', 'Reports & deadlines'], ['details', 'Details']];

export default function GrantDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'budget';
  const [grant, setGrant] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const [g, ex] = await Promise.all([api.get(`/grants/${id}`), api.get(`/grants/${id}/expenses`)]);
      setGrant(g);
      setExpenses(ex);
    } catch (e) {
      setError(e);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error && !grant) return <div className="page"><ErrorNote error={error} /><Link to="/grants">← Back to grants</Link></div>;
  if (!grant) return <div className="page muted">Loading…</div>;

  const del = async () => {
    if (!window.confirm(`Delete "${grant.name}" and all of its budget lines, expenses, and reports? This cannot be undone.`)) return;
    try {
      await api.del(`/grants/${grant.id}`);
      navigate('/grants');
    } catch (e) { setError(e); }
  };

  return (
    <div className="page">
      <Link to="/grants" className="back">← Grants</Link>
      <div className="page-head">
        <div>
          <h1>{grant.name} <StatusPill status={grant.status} /></h1>
          <p className="muted">
            {grant.program_name} · {grant.funder_name ?? 'No funder'}{grant.award_number && ` · ${grant.award_number}`}
            {' · '}{fmtDate(grant.start_date)} – {fmtDate(grant.end_date)}
          </p>
        </div>
        {grant.can_edit && (
          <div className="actions">
            <button className="btn" onClick={() => setEditing(true)}>Edit grant</button>
            <button className="btn btn-danger-ghost" onClick={del}>Delete</button>
          </div>
        )}
      </div>

      <ErrorNote error={error} />
      {notice && <div className="note note-warning" role="status"><span aria-hidden="true">⚠</span> {notice}
        <button className="btn btn-ghost btn-icon" onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}

      <section className="stats">
        <StatTile label="Remaining" value={money(grant.remaining)} sub={`${pct(grant.remaining, grant.award_amount)} of award`} emphasis />
        <StatTile label="Award" value={money(grant.award_amount)} sub={grant.award_date ? `Awarded ${fmtDate(grant.award_date)}` : null} />
        <StatTile label="Spent" value={money(grant.spent)} sub={`${expenses.length} expense${expenses.length === 1 ? '' : 's'}`} />
        <StatTile label="Time elapsed" value={`${Math.round(grant.time_elapsed * 100)}%`}
          sub={grant.days_remaining >= 0 ? `${grant.days_remaining} days remaining` : 'Grant period ended'} />
      </section>
      <div className="card burn">
        <div className="row-meter-head">
          <span>Spending vs. grant period</span>
          <PaceBadge pace={grant.pace} />
        </div>
        <BudgetMeter spent={grant.spent} total={grant.award_amount} timeElapsed={grant.time_elapsed} />
        <div className="legend small"><span className="key key-spent" /> {pct(grant.spent, grant.award_amount)} spent <span className="key key-tick" /> {Math.round(grant.time_elapsed * 100)}% of period elapsed</div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''}
            onClick={() => setParams(key === 'budget' ? {} : { tab: key }, { replace: true })}>
            {label}
            {key === 'reports' && grant.reports.some((r) => r.status === 'upcoming' && r.due_date < todayIso()) && <span className="dot" aria-label="overdue" />}
          </button>
        ))}
      </div>

      {tab === 'budget' && <BudgetTab grant={grant} reload={load} />}
      {tab === 'expenses' && <ExpensesTab grant={grant} expenses={expenses} reload={load} onWarning={setNotice} />}
      {tab === 'reports' && <ReportsTab grant={grant} reload={load} />}
      {tab === 'details' && <DetailsTab grant={grant} />}

      {editing && <GrantForm grant={grant} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
    </div>
  );
}

// --- Budget ---------------------------------------------------------------

function BudgetTab({ grant, reload }) {
  const [editing, setEditing] = useState(null); // null | {} (new) | line
  const [error, setError] = useState(null);
  const lines = grant.budget_lines;
  const unbudgeted = grant.award_amount - grant.budgeted;

  const remove = async (line) => {
    if (!window.confirm(`Delete budget line "${line.name}"?`)) return;
    try { await api.del(`/budget-lines/${line.id}`); reload(); } catch (e) { setError(e); }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Approved budget</h2>
        <div className="actions">
          <a className="btn btn-ghost" href={`/api/grants/${grant.id}/export/budget.csv`}>Export budget vs. actual</a>
          {grant.can_edit && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Add line item</button>}
        </div>
      </div>
      <ErrorNote error={error} />
      {unbudgeted !== 0 && (
        <div className="note note-warning"><span aria-hidden="true">ⓘ</span> {money(unbudgeted)} of the award is not yet assigned to a budget line.</div>
      )}
      {lines.length === 0 ? <Empty>No budget lines yet. Add the line items from the approved budget.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Category</th><th>Line item</th><th className="num">Approved</th><th className="num">Spent</th>
                <th className="num">Remaining</th><th style={{ minWidth: 120 }}>% spent</th>{grant.can_edit && <th />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="muted">{l.category}</td>
                  <td>{l.name}{l.notes && <div className="muted small">{l.notes}</div>}</td>
                  <td className="num">{money(l.approved_amount)}</td>
                  <td className="num"><Link to={`?tab=expenses&line=${l.id}`}>{money(l.spent)}</Link></td>
                  <td className={`num ${l.remaining < 0 ? 'text-critical' : ''}`}>
                    {l.remaining < 0 && <span aria-hidden="true">⚠ </span>}{money(l.remaining)}
                  </td>
                  <td><div className="meter-cell"><BudgetMeter spent={l.spent} total={l.approved_amount} compact /><span className="small">{pct(l.spent, l.approved_amount)}</span></div></td>
                  {grant.can_edit && (
                    <td className="row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(l)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => remove(l)} disabled={l.expense_count > 0}
                        title={l.expense_count > 0 ? 'Lines with expenses cannot be deleted' : 'Delete line'}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="num">{money(grant.budgeted)}</td><td className="num">{money(grant.spent)}</td>
                <td className="num">{money(grant.budgeted - grant.spent)}</td><td>{pct(grant.spent, grant.budgeted)}</td>
                {grant.can_edit && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {editing && <LineForm grant={grant} line={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </section>
  );
}

function LineForm({ grant, line, onClose, onSaved }) {
  const [f, setF] = useState({
    category: line?.category ?? 'Personnel', name: line?.name ?? '',
    approved_amount: fromCents(line?.approved_amount), notes: line?.notes ?? '',
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const available = grant.award_amount - grant.budgeted + (line?.approved_amount ?? 0);
  const { busy, error, submit, setError } = useSubmit(async () => {
    const amount = toCents(f.approved_amount);
    if (Number.isNaN(amount)) return setError(new Error('Approved amount must be a dollar amount'));
    const body = { ...f, approved_amount: amount, sort_order: line?.sort_order ?? grant.budget_lines.length };
    if (line) await api.put(`/budget-lines/${line.id}`, body);
    else await api.post(`/grants/${grant.id}/budget-lines`, body);
    onSaved();
  });
  return (
    <Modal title={line ? 'Edit budget line' : 'Add budget line'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <ErrorNote error={error} />
        <Field label="Category">
          <input list="categories" value={f.category} onChange={set('category')} required />
          <datalist id="categories">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Approved amount ($)" hint={`Up to ${money(available)} available in the award`}>
          <input inputMode="decimal" value={f.approved_amount} onChange={set('approved_amount')} required />
        </Field>
        <Field label="Line item" span={2}><input value={f.name} onChange={set('name')} required /></Field>
        <Field label="Notes" span={2}><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
        <div className="form-actions span-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

// --- Expenses -------------------------------------------------------------

function ExpensesTab({ grant, expenses, reload, onWarning }) {
  const [params, setParams] = useSearchParams();
  const lineFilter = params.get('line') || '';
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const shown = lineFilter ? expenses.filter((e) => String(e.budget_line_id) === lineFilter) : expenses;
  const total = shown.reduce((s, e) => s + e.amount, 0);
  const canAdd = grant.can_edit && grant.status !== 'closed' && grant.budget_lines.length > 0;

  const remove = async (e) => {
    if (!window.confirm(`Delete expense "${e.description}" (${money(e.amount)})?`)) return;
    try { await api.del(`/expenses/${e.id}`); reload(); } catch (err) { setError(err); }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Expenses</h2>
        <div className="actions">
          <select value={lineFilter} aria-label="Filter by budget line"
            onChange={(e) => setParams(e.target.value ? { tab: 'expenses', line: e.target.value } : { tab: 'expenses' }, { replace: true })}>
            <option value="">All budget lines</option>
            {grant.budget_lines.map((l) => <option key={l.id} value={l.id}>{l.category} — {l.name}</option>)}
          </select>
          <a className="btn btn-ghost" href={`/api/grants/${grant.id}/export/expenses.csv`}>Export CSV</a>
          {canAdd && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Record expense</button>}
        </div>
      </div>
      <ErrorNote error={error} />
      {grant.status === 'closed' && <div className="note"><span aria-hidden="true">ⓘ</span> This grant is closed. Reopen it (Edit grant → Status) to change expenses.</div>}
      {grant.budget_lines.length === 0 && <Empty>Add budget lines before recording expenses.</Empty>}
      {grant.budget_lines.length > 0 && shown.length === 0 && <Empty>No expenses recorded{lineFilter ? ' for this line' : ''}.</Empty>}
      {shown.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Budget line</th><th>Vendor</th><th>Description</th><th>Ref #</th><th className="num">Amount</th>{grant.can_edit && <th />}</tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{fmtDate(e.expense_date)}</td>
                  <td>{e.budget_line_name}<div className="muted small">{e.category}</div></td>
                  <td>{e.vendor || '—'}</td>
                  <td>{e.description}{e.created_by_name && <div className="muted small">Entered by {e.created_by_name}</div>}</td>
                  <td className="muted">{e.reference || '—'}</td>
                  <td className="num">{money(e.amount)}</td>
                  {grant.can_edit && (
                    <td className="row-actions">
                      {grant.status !== 'closed' && <>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(e)}>Edit</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => remove(e)}>Delete</button>
                      </>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={5}>Total{lineFilter ? ' (filtered)' : ''}</td><td className="num">{money(total)}</td>{grant.can_edit && <td />}</tr>
            </tfoot>
          </table>
        </div>
      )}
      {editing && (
        <ExpenseForm grant={grant} expense={editing.id ? editing : null} defaultLine={lineFilter}
          onClose={() => setEditing(null)}
          onSaved={(saved) => { setEditing(null); onWarning(saved.warning); reload(); }} />
      )}
    </section>
  );
}

function ExpenseForm({ grant, expense, defaultLine, onClose, onSaved }) {
  const clampToday = () => {
    const t = todayIso();
    return t < grant.start_date ? grant.start_date : t > grant.end_date ? grant.end_date : t;
  };
  const [f, setF] = useState({
    budget_line_id: expense?.budget_line_id ?? (defaultLine || grant.budget_lines[0]?.id),
    expense_date: expense?.expense_date ?? clampToday(),
    vendor: expense?.vendor ?? '', description: expense?.description ?? '',
    amount: fromCents(expense?.amount), reference: expense?.reference ?? '',
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const line = grant.budget_lines.find((l) => String(l.id) === String(f.budget_line_id));
  const { busy, error, submit, setError } = useSubmit(async () => {
    const amount = toCents(f.amount);
    if (Number.isNaN(amount)) return setError(new Error('Amount must be a dollar amount'));
    const body = { ...f, amount };
    const saved = expense ? await api.put(`/expenses/${expense.id}`, body) : await api.post(`/grants/${grant.id}/expenses`, body);
    onSaved(saved);
  });
  return (
    <Modal title={expense ? 'Edit expense' : 'Record expense'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <ErrorNote error={error} />
        <Field label="Budget line" span={2}
          hint={line && `${money(line.remaining)} remaining of ${money(line.approved_amount)} approved`}>
          <select value={f.budget_line_id} onChange={set('budget_line_id')} required>
            {grant.budget_lines.map((l) => <option key={l.id} value={l.id}>{l.category} — {l.name}</option>)}
          </select>
        </Field>
        <Field label="Date" hint={`Within ${fmtDate(grant.start_date)} – ${fmtDate(grant.end_date)}`}>
          <input type="date" value={f.expense_date} min={grant.start_date} max={grant.end_date} onChange={set('expense_date')} required />
        </Field>
        <Field label="Amount ($)" hint="Use a negative amount for refunds">
          <input inputMode="decimal" value={f.amount} onChange={set('amount')} required />
        </Field>
        <Field label="Vendor / payee"><input value={f.vendor} onChange={set('vendor')} /></Field>
        <Field label="Invoice / reference #"><input value={f.reference} onChange={set('reference')} /></Field>
        <Field label="Description" span={2}><input value={f.description} onChange={set('description')} required /></Field>
        <div className="form-actions span-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save expense'}</button>
        </div>
      </form>
    </Modal>
  );
}

// --- Reports --------------------------------------------------------------

function ReportsTab({ grant, reload }) {
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  const today = todayIso();
  const remove = async (r) => {
    if (!window.confirm(`Delete "${r.title}"?`)) return;
    try { await api.del(`/reports/${r.id}`); reload(); } catch (e) { setError(e); }
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>Reporting requirements</h2>
        {grant.can_edit && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Add requirement</button>}
      </div>
      <ErrorNote error={error} />
      {grant.reports.length === 0 ? <Empty>No reports or deliverables tracked for this grant.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Due</th><th>Requirement</th><th>Type</th><th>Status</th><th>Submitted</th>{grant.can_edit && <th />}</tr></thead>
            <tbody>
              {grant.reports.map((r) => {
                const overdue = r.status === 'upcoming' && r.due_date < today;
                return (
                  <tr key={r.id}>
                    <td className={`nowrap ${overdue ? 'text-critical' : ''}`}>{overdue && <span aria-hidden="true">⚠ </span>}{fmtDate(r.due_date)}{overdue && <div className="small">Overdue</div>}</td>
                    <td>{r.title}{r.notes && <div className="muted small">{r.notes}</div>}</td>
                    <td>{r.report_type}</td>
                    <td><StatusPill status={r.status} /></td>
                    <td>{fmtDate(r.submitted_date)}</td>
                    {grant.can_edit && (
                      <td className="row-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(r)}>Edit</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => remove(r)}>Delete</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ReportForm grant={grant} report={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </section>
  );
}

function ReportForm({ grant, report, onClose, onSaved }) {
  const [f, setF] = useState({
    title: report?.title ?? '', report_type: report?.report_type ?? 'Financial', due_date: report?.due_date ?? '',
    status: report?.status ?? 'upcoming', submitted_date: report?.submitted_date ?? '', notes: report?.notes ?? '',
  });
  const set = (k) => (e) => setF((p) => ({
    ...p, [k]: e.target.value,
    ...(k === 'status' && e.target.value !== 'upcoming' && !p.submitted_date ? { submitted_date: todayIso() } : {}),
  }));
  const { busy, error, submit } = useSubmit(async () => {
    const body = { ...f, submitted_date: f.status === 'upcoming' ? null : f.submitted_date };
    if (report) await api.put(`/reports/${report.id}`, body);
    else await api.post(`/grants/${grant.id}/reports`, body);
    onSaved();
  });
  return (
    <Modal title={report ? 'Edit requirement' : 'Add reporting requirement'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <ErrorNote error={error} />
        <Field label="Title" span={2}><input value={f.title} onChange={set('title')} required placeholder="e.g. Q2 financial report" /></Field>
        <Field label="Type">
          <select value={f.report_type} onChange={set('report_type')}>
            {['Financial', 'Programmatic', 'Final', 'Site visit', 'Other'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Due date"><input type="date" value={f.due_date} onChange={set('due_date')} required /></Field>
        <Field label="Status">
          <select value={f.status} onChange={set('status')}>
            <option value="upcoming">Upcoming</option><option value="submitted">Submitted</option><option value="accepted">Accepted</option>
          </select>
        </Field>
        {f.status !== 'upcoming' && <Field label="Submitted on"><input type="date" value={f.submitted_date ?? ''} onChange={set('submitted_date')} required /></Field>}
        <Field label="Notes" span={2}><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
        <div className="form-actions span-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

// --- Details --------------------------------------------------------------

function DetailsTab({ grant }) {
  const rows = [
    ['Mission program', grant.program_name], ['Funder', grant.funder_name ?? '—'], ['Award number', grant.award_number || '—'],
    ['Award amount', money(grant.award_amount)], ['Award date', fmtDate(grant.award_date)],
    ['Grant period', `${fmtDate(grant.start_date)} – ${fmtDate(grant.end_date)}`],
    ['Restrictions / allowable costs', grant.restrictions || '—'], ['Notes', grant.notes || '—'],
  ];
  return (
    <section className="card">
      <dl className="details">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
    </section>
  );
}
