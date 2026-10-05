export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function str(value, field, { required = false, max = 2000 } = {}) {
  const s = value == null ? '' : String(value).trim();
  if (required && !s) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} is too long`);
  return s;
}

export function date(value, field, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  const s = String(value);
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, `${field} must be a date (YYYY-MM-DD)`);
  return s;
}

// Money arrives and leaves the API as integer cents.
export function cents(value, field, { required = true, allowNegative = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return 0;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HttpError(400, `${field} must be a whole number of cents`);
  if (!allowNegative && n < 0) throw new HttpError(400, `${field} cannot be negative`);
  return n;
}

export function oneOf(value, field, options, fallback) {
  if (value == null || value === '') return fallback;
  if (!options.includes(value)) throw new HttpError(400, `${field} must be one of: ${options.join(', ')}`);
  return value;
}

export function id(value, field = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${field}`);
  return n;
}

export function plain(rows) {
  return rows.map((r) => ({ ...r }));
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
