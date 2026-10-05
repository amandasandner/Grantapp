const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdShort = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

export const money = (cents) => usd.format((cents ?? 0) / 100);
export const moneyShort = (cents) => usdShort.format((cents ?? 0) / 100);
export const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');

// "1,234.56" -> 123456 cents; returns NaN for invalid input.
export function toCents(input) {
  const s = String(input ?? '').replace(/[$,\s]/g, '');
  if (s === '' || !/^-?\d*(\.\d{0,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

export const fromCents = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
