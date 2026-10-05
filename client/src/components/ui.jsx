import { useEffect, useRef, useState } from 'react';
import { money, pct } from '../format.js';

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, select, textarea')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, span }) {
  return (
    <label className={`field ${span ? `span-${span}` : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="note note-critical" role="alert"><span aria-hidden="true">⚠</span> {String(error.message ?? error)}</div>;
}

// Form wrapper that tracks submitting/error state for async submit handlers.
export function useSubmit(fn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit, setError };
}

export function StatTile({ label, value, sub, emphasis }) {
  return (
    <div className={`stat ${emphasis ? 'stat-emphasis' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

const PACE = {
  'on-track': { icon: '●', label: 'On track', cls: 'good' },
  ahead: { icon: '▲', label: 'Spending ahead', cls: 'warning' },
  behind: { icon: '▼', label: 'Underspending', cls: 'serious' },
  over: { icon: '⚠', label: 'Over award', cls: 'critical' },
};

export function PaceBadge({ pace }) {
  const p = PACE[pace];
  if (!p) return <span className="muted">—</span>;
  return <span className={`badge badge-${p.cls}`}><span aria-hidden="true">{p.icon}</span> {p.label}</span>;
}

const STATUS = { active: 'Active', pending: 'Pending', closed: 'Closed', upcoming: 'Upcoming', submitted: 'Submitted', accepted: 'Accepted' };
export function StatusPill({ status }) {
  return <span className={`pill pill-${status}`}>{STATUS[status] ?? status}</span>;
}

// Spent vs. remaining meter, with an optional tick showing how much of the
// grant period has elapsed (so pace can be read at a glance).
export function BudgetMeter({ spent, total, timeElapsed, compact }) {
  const ratio = total > 0 ? spent / total : 0;
  const over = spent > total;
  const fill = Math.min(1, Math.max(0, ratio));
  const tip = `${money(spent)} spent of ${money(total)} (${pct(spent, total)})${over ? ` — over by ${money(spent - total)}` : ` — ${money(total - spent)} remaining`}${
    timeElapsed != null ? ` · ${Math.round(timeElapsed * 100)}% of period elapsed` : ''}`;
  return (
    <div className={`meter ${compact ? 'meter-compact' : ''}`} title={tip} role="img" aria-label={tip}>
      <div className={`meter-fill ${over ? 'meter-over' : ''}`} style={{ width: `${fill * 100}%` }} />
      {timeElapsed != null && <div className="meter-tick" style={{ left: `${Math.min(100, timeElapsed * 100)}%` }} />}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
