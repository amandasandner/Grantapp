import { useState } from 'react';
import { money, moneyShort } from '../format.js';

const W = 560;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

function niceMax(v) {
  if (v <= 0) return 100;
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= v);
}

const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
};

// Single-series column chart with per-bar hover tooltip.
export default function MonthlyChart({ data }) {
  const [hover, setHover] = useState(null);
  const max = niceMax(Math.max(...data.map((d) => d.spent)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / data.length;
  const barW = Math.min(28, slot - 6);
  const y = (v) => PAD.top + plotH - (Math.max(0, v) / max) * plotH;
  const ticks = [0, 0.5, 1].map((f) => f * max);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly spending, last 12 months">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{moneyShort(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const top = y(d.spent);
          const h = PAD.top + plotH - top;
          const r = Math.min(4, h / 2);
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect className="hit" x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} />
              {h > 0 && (
                <path
                  className={`bar ${hover === i ? 'bar-hover' : ''}`}
                  d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`}
                />
              )}
              <text className="axis" x={x + barW / 2} y={H - 8} textAnchor="middle">{monthLabel(d.month)}</text>
            </g>
          );
        })}
        <line className="baseline" x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} />
      </svg>
      {hover != null && (
        <div className="tooltip" style={{ left: `${((PAD.left + (hover + 0.5) * slot) / W) * 100}%` }}>
          <div className="muted small">{new Date(`${data[hover].month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
          <strong>{money(data[hover].spent)}</strong>
        </div>
      )}
      <details className="table-toggle">
        <summary>View as table</summary>
        <table className="table compact">
          <tbody>{data.map((d) => <tr key={d.month}><td>{d.month}</td><td className="num">{money(d.spent)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
