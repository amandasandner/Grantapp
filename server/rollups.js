import { plain, today } from './util.js';

const DAY = 86400_000;

// Fraction of the grant period that has elapsed as of `asOf` (0..1).
export function timeElapsed(start, end, asOf = today()) {
  const s = Date.parse(start);
  const e = Date.parse(end) + DAY; // end date is inclusive
  const now = Date.parse(asOf);
  if (now <= s) return 0;
  if (now >= e) return 1;
  return (now - s) / (e - s);
}

export function daysRemaining(end, asOf = today()) {
  return Math.round((Date.parse(end) - Date.parse(asOf)) / DAY);
}

// Compare spending pace to time elapsed so program staff see grants drifting
// off-plan before the period ends.
export function paceStatus(g, asOf = today()) {
  if (g.status !== 'active' || g.award_amount <= 0) return 'n/a';
  if (g.spent > g.award_amount) return 'over';
  const spentPct = g.spent / g.award_amount;
  const timePct = timeElapsed(g.start_date, g.end_date, asOf);
  if (spentPct - timePct > 0.15) return 'ahead';
  if (timePct - spentPct > 0.25) return 'behind';
  return 'on-track';
}

const GRANT_SELECT = `
  SELECT g.*, p.name AS program_name, f.name AS funder_name,
    COALESCE((SELECT SUM(approved_amount) FROM budget_lines bl WHERE bl.grant_id = g.id), 0) AS budgeted,
    COALESCE((SELECT SUM(amount) FROM expenses e WHERE e.grant_id = g.id), 0) AS spent
  FROM grants g
  JOIN programs p ON p.id = g.program_id
  LEFT JOIN funders f ON f.id = g.funder_id
`;

function decorate(g, asOf) {
  return {
    ...g,
    remaining: g.award_amount - g.spent,
    unbudgeted: g.award_amount - g.budgeted,
    time_elapsed: timeElapsed(g.start_date, g.end_date, asOf),
    days_remaining: daysRemaining(g.end_date, asOf),
    pace: paceStatus(g, asOf),
  };
}

// programIds: array of allowed ids, or null for all programs.
export function listGrants(db, { programIds, programId, status, q } = {}, asOf = today()) {
  const where = [];
  const params = [];
  if (programIds) {
    if (programIds.length === 0) return [];
    where.push(`g.program_id IN (${programIds.map(() => '?').join(',')})`);
    params.push(...programIds);
  }
  if (programId) { where.push('g.program_id = ?'); params.push(programId); }
  if (status) { where.push('g.status = ?'); params.push(status); }
  if (q) {
    where.push('(g.name LIKE ? OR g.award_number LIKE ? OR f.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const sql = `${GRANT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY g.end_date, g.name`;
  return plain(db.prepare(sql).all(...params)).map((g) => decorate(g, asOf));
}

export function getGrant(db, id, asOf = today()) {
  const g = db.prepare(`${GRANT_SELECT} WHERE g.id = ?`).get(id);
  return g ? decorate({ ...g }, asOf) : null;
}

export function budgetLines(db, grantId) {
  return plain(db.prepare(`
    SELECT bl.*, COALESCE(SUM(e.amount), 0) AS spent, COUNT(e.id) AS expense_count
    FROM budget_lines bl LEFT JOIN expenses e ON e.budget_line_id = bl.id
    WHERE bl.grant_id = ?
    GROUP BY bl.id ORDER BY bl.sort_order, bl.id
  `).all(grantId)).map((l) => ({ ...l, remaining: l.approved_amount - l.spent }));
}

export function dashboard(db, { programIds, programId, status = 'active' }, asOf = today()) {
  const grants = listGrants(db, { programIds, programId, status: status === 'all' ? undefined : status }, asOf);
  const ids = grants.map((g) => g.id);
  const inList = ids.map(() => '?').join(',');

  const totals = grants.reduce(
    (t, g) => ({
      award: t.award + g.award_amount,
      budgeted: t.budgeted + g.budgeted,
      spent: t.spent + g.spent,
      remaining: t.remaining + g.remaining,
    }),
    { award: 0, budgeted: 0, spent: 0, remaining: 0 },
  );

  const byProgram = new Map();
  for (const g of grants) {
    const p = byProgram.get(g.program_id) ?? {
      program_id: g.program_id, program_name: g.program_name, grants: 0, award: 0, spent: 0, remaining: 0,
    };
    p.grants += 1;
    p.award += g.award_amount;
    p.spent += g.spent;
    p.remaining += g.remaining;
    byProgram.set(g.program_id, p);
  }

  let overBudgetLines = [];
  let upcomingReports = [];
  let monthly = [];
  let byCategory = [];
  if (ids.length) {
    overBudgetLines = plain(db.prepare(`
      SELECT bl.id, bl.name, bl.category, bl.approved_amount, g.id AS grant_id, g.name AS grant_name,
        SUM(e.amount) AS spent
      FROM budget_lines bl JOIN grants g ON g.id = bl.grant_id
      JOIN expenses e ON e.budget_line_id = bl.id
      WHERE bl.grant_id IN (${inList})
      GROUP BY bl.id HAVING SUM(e.amount) > bl.approved_amount
      ORDER BY SUM(e.amount) - bl.approved_amount DESC
    `).all(...ids));

    const horizon = new Date(Date.parse(asOf) + 60 * DAY).toISOString().slice(0, 10);
    upcomingReports = plain(db.prepare(`
      SELECT r.*, g.name AS grant_name, p.name AS program_name
      FROM grant_reports r JOIN grants g ON g.id = r.grant_id JOIN programs p ON p.id = g.program_id
      WHERE r.grant_id IN (${inList}) AND r.status = 'upcoming' AND r.due_date <= ?
      ORDER BY r.due_date
    `).all(...ids, horizon)).map((r) => ({ ...r, overdue: r.due_date < asOf }));

    // Last 12 calendar months of spending, zero-filled.
    const months = [];
    const d = new Date(asOf + 'T00:00:00Z');
    for (let i = 11; i >= 0; i--) {
      const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
      months.push(m.toISOString().slice(0, 7));
    }
    const sums = new Map(db.prepare(`
      SELECT substr(expense_date, 1, 7) AS month, SUM(amount) AS total
      FROM expenses WHERE grant_id IN (${inList}) AND expense_date >= ?
      GROUP BY month
    `).all(...ids, months[0] + '-01').map((r) => [r.month, r.total]));
    monthly = months.map((month) => ({ month, spent: sums.get(month) ?? 0 }));

    byCategory = plain(db.prepare(`
      SELECT bl.category, SUM(bl.approved_amount) AS approved,
        COALESCE(SUM((SELECT SUM(amount) FROM expenses e WHERE e.budget_line_id = bl.id)), 0) AS spent
      FROM budget_lines bl WHERE bl.grant_id IN (${inList})
      GROUP BY bl.category ORDER BY approved DESC
    `).all(...ids));
  }

  return {
    as_of: asOf,
    totals: { ...totals, grant_count: grants.length },
    programs: [...byProgram.values()].sort((a, b) => a.program_name.localeCompare(b.program_name)),
    grants,
    over_budget_lines: overBudgetLines,
    upcoming_reports: upcomingReports,
    monthly_spending: monthly,
    by_category: byCategory,
    ending_soon: grants.filter((g) => g.status === 'active' && g.days_remaining >= 0 && g.days_remaining <= 90),
  };
}
