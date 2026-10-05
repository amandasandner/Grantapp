import { Router } from 'express';
import { canEdit, canView, isAnyManager, requireAuth, requireSuperuser, visibleProgramIds } from '../auth.js';
import { tx } from '../db.js';
import { budgetLines, dashboard, getGrant, listGrants } from '../rollups.js';
import { HttpError, cents, date, id, oneOf, plain, str } from '../util.js';

const GRANT_STATUSES = ['pending', 'active', 'closed'];
const REPORT_STATUSES = ['upcoming', 'submitted', 'accepted'];

// Fetch a grant the user is allowed to see. Grants in other programs are
// reported as "not found" so their existence isn't leaked.
function loadGrant(db, user, grantId, { edit = false } = {}) {
  const g = getGrant(db, id(grantId, 'grant'));
  if (!g || !canView(user, g.program_id)) throw new HttpError(404, 'Grant not found');
  if (edit && !canEdit(user, g.program_id)) throw new HttpError(403, 'You have read-only access to this program');
  return g;
}

function loadChild(db, user, table, childId, { edit = true } = {}) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id(childId));
  if (!row) throw new HttpError(404, 'Not found');
  const grant = loadGrant(db, user, row.grant_id, { edit });
  return { row: { ...row }, grant };
}

function grantFields(db, body) {
  const f = {
    program_id: id(body.program_id, 'program'),
    funder_id: body.funder_id ? id(body.funder_id, 'funder') : null,
    name: str(body.name, 'Grant name', { required: true, max: 300 }),
    award_number: str(body.award_number, 'Award number', { max: 100 }),
    status: oneOf(body.status, 'Status', GRANT_STATUSES, 'active'),
    award_amount: cents(body.award_amount, 'Award amount'),
    award_date: date(body.award_date, 'Award date'),
    start_date: date(body.start_date, 'Start date', { required: true }),
    end_date: date(body.end_date, 'End date', { required: true }),
    restrictions: str(body.restrictions, 'Restrictions', { max: 5000 }),
    notes: str(body.notes, 'Notes', { max: 5000 }),
  };
  if (f.end_date < f.start_date) throw new HttpError(400, 'End date must be on or after the start date');
  if (f.funder_id && !db.prepare('SELECT 1 FROM funders WHERE id = ?').get(f.funder_id)) throw new HttpError(400, 'Unknown funder');
  if (!db.prepare('SELECT 1 FROM programs WHERE id = ?').get(f.program_id)) throw new HttpError(400, 'Unknown program');
  return f;
}

function assertBudgetFits(db, grantId, awardAmount, { excludeLineId = 0, addAmount = 0 } = {}) {
  const { total } = db.prepare(
    'SELECT COALESCE(SUM(approved_amount), 0) AS total FROM budget_lines WHERE grant_id = ? AND id <> ?',
  ).get(grantId, excludeLineId);
  if (total + addAmount > awardAmount) {
    throw new HttpError(400, 'Approved budget lines cannot total more than the award amount');
  }
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

const dollars = (c) => (c / 100).toFixed(2);

export default function grantRoutes(db) {
  const r = Router();
  r.use(requireAuth);

  // --- Dashboard --------------------------------------------------------
  r.get('/dashboard', (req, res) => {
    const programId = req.query.program_id ? id(req.query.program_id, 'program') : undefined;
    if (programId && !canView(req.user, programId)) throw new HttpError(404, 'Program not found');
    const status = oneOf(req.query.status, 'Status', [...GRANT_STATUSES, 'all'], 'active');
    res.json(dashboard(db, { programIds: visibleProgramIds(req.user), programId, status }));
  });

  // --- Funders ----------------------------------------------------------
  r.get('/funders', (_req, res) => {
    res.json(plain(db.prepare('SELECT * FROM funders ORDER BY name').all()));
  });

  const funderFields = (b) => ({
    name: str(b.name, 'Funder name', { required: true, max: 300 }),
    contact_name: str(b.contact_name, 'Contact name', { max: 200 }),
    contact_email: str(b.contact_email, 'Contact email', { max: 200 }),
    website: str(b.website, 'Website', { max: 300 }),
    notes: str(b.notes, 'Notes', { max: 5000 }),
  });

  r.post('/funders', (req, res) => {
    if (!isAnyManager(req.user)) throw new HttpError(403, 'Only program managers can add funders');
    const f = funderFields(req.body);
    if (db.prepare('SELECT 1 FROM funders WHERE name = ?').get(f.name)) throw new HttpError(409, 'That funder already exists');
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO funders (name, contact_name, contact_email, website, notes) VALUES (?, ?, ?, ?, ?)',
    ).run(f.name, f.contact_name, f.contact_email, f.website, f.notes);
    res.status(201).json({ ...db.prepare('SELECT * FROM funders WHERE id = ?').get(lastInsertRowid) });
  });

  r.put('/funders/:id', (req, res) => {
    if (!isAnyManager(req.user)) throw new HttpError(403, 'Only program managers can edit funders');
    const fid = id(req.params.id);
    const f = funderFields(req.body);
    const result = db.prepare(
      'UPDATE funders SET name = ?, contact_name = ?, contact_email = ?, website = ?, notes = ? WHERE id = ?',
    ).run(f.name, f.contact_name, f.contact_email, f.website, f.notes, fid);
    if (!result.changes) throw new HttpError(404, 'Funder not found');
    res.json({ ...db.prepare('SELECT * FROM funders WHERE id = ?').get(fid) });
  });

  r.delete('/funders/:id', requireSuperuser, (req, res) => {
    db.prepare('DELETE FROM funders WHERE id = ?').run(id(req.params.id));
    res.status(204).end();
  });

  // --- Grants -----------------------------------------------------------
  r.get('/grants', (req, res) => {
    const programId = req.query.program_id ? id(req.query.program_id, 'program') : undefined;
    const status = oneOf(req.query.status, 'Status', GRANT_STATUSES, undefined);
    res.json(listGrants(db, {
      programIds: visibleProgramIds(req.user), programId, status, q: str(req.query.q, 'Search', { max: 200 }),
    }));
  });

  r.post('/grants', (req, res) => {
    const f = grantFields(db, req.body);
    if (!canEdit(req.user, f.program_id)) throw new HttpError(403, 'You cannot add grants to this program');
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO grants (program_id, funder_id, name, award_number, status, award_amount, award_date,
        start_date, end_date, restrictions, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(f.program_id, f.funder_id, f.name, f.award_number, f.status, f.award_amount, f.award_date,
      f.start_date, f.end_date, f.restrictions, f.notes);
    res.status(201).json(getGrant(db, Number(lastInsertRowid)));
  });

  r.get('/grants/:id', (req, res) => {
    const g = loadGrant(db, req.user, req.params.id);
    res.json({
      ...g,
      can_edit: canEdit(req.user, g.program_id),
      budget_lines: budgetLines(db, g.id),
      reports: plain(db.prepare('SELECT * FROM grant_reports WHERE grant_id = ? ORDER BY due_date').all(g.id)),
    });
  });

  r.put('/grants/:id', (req, res) => {
    const g = loadGrant(db, req.user, req.params.id, { edit: true });
    const f = grantFields(db, req.body);
    if (f.program_id !== g.program_id && !canEdit(req.user, f.program_id)) {
      throw new HttpError(403, 'You cannot move this grant to that program');
    }
    if (f.award_amount < g.budgeted) {
      throw new HttpError(400, 'Award amount cannot be less than the approved budget total; reduce budget lines first');
    }
    const outside = db.prepare(
      'SELECT COUNT(*) AS n FROM expenses WHERE grant_id = ? AND (expense_date < ? OR expense_date > ?)',
    ).get(g.id, f.start_date, f.end_date).n;
    if (outside) throw new HttpError(400, `${outside} recorded expense(s) fall outside the new grant period`);
    db.prepare(`
      UPDATE grants SET program_id = ?, funder_id = ?, name = ?, award_number = ?, status = ?, award_amount = ?,
        award_date = ?, start_date = ?, end_date = ?, restrictions = ?, notes = ?
      WHERE id = ?
    `).run(f.program_id, f.funder_id, f.name, f.award_number, f.status, f.award_amount, f.award_date,
      f.start_date, f.end_date, f.restrictions, f.notes, g.id);
    res.json(getGrant(db, g.id));
  });

  r.delete('/grants/:id', (req, res) => {
    const g = loadGrant(db, req.user, req.params.id, { edit: true });
    tx(db, () => {
      db.prepare('DELETE FROM expenses WHERE grant_id = ?').run(g.id);
      db.prepare('DELETE FROM grants WHERE id = ?').run(g.id);
    });
    res.status(204).end();
  });

  // --- Budget lines -----------------------------------------------------
  const lineFields = (b) => ({
    category: str(b.category, 'Category', { max: 100 }) || 'Other',
    name: str(b.name, 'Line item', { required: true, max: 300 }),
    approved_amount: cents(b.approved_amount, 'Approved amount'),
    notes: str(b.notes, 'Notes', { max: 2000 }),
    sort_order: Number.isInteger(b.sort_order) ? b.sort_order : 0,
  });

  r.post('/grants/:id/budget-lines', (req, res) => {
    const g = loadGrant(db, req.user, req.params.id, { edit: true });
    const f = lineFields(req.body);
    assertBudgetFits(db, g.id, g.award_amount, { addAmount: f.approved_amount });
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO budget_lines (grant_id, category, name, approved_amount, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(g.id, f.category, f.name, f.approved_amount, f.notes, f.sort_order);
    res.status(201).json(budgetLines(db, g.id).find((l) => l.id === Number(lastInsertRowid)));
  });

  r.put('/budget-lines/:id', (req, res) => {
    const { row, grant } = loadChild(db, req.user, 'budget_lines', req.params.id);
    const f = lineFields(req.body);
    assertBudgetFits(db, grant.id, grant.award_amount, { excludeLineId: row.id, addAmount: f.approved_amount });
    db.prepare('UPDATE budget_lines SET category = ?, name = ?, approved_amount = ?, notes = ?, sort_order = ? WHERE id = ?')
      .run(f.category, f.name, f.approved_amount, f.notes, f.sort_order, row.id);
    res.json(budgetLines(db, grant.id).find((l) => l.id === row.id));
  });

  r.delete('/budget-lines/:id', (req, res) => {
    const { row } = loadChild(db, req.user, 'budget_lines', req.params.id);
    if (db.prepare('SELECT 1 FROM expenses WHERE budget_line_id = ?').get(row.id)) {
      throw new HttpError(409, 'This line has expenses; move or delete them first');
    }
    db.prepare('DELETE FROM budget_lines WHERE id = ?').run(row.id);
    res.status(204).end();
  });

  // --- Expenses ---------------------------------------------------------
  function expenseFields(grant, b) {
    const f = {
      budget_line_id: id(b.budget_line_id, 'budget line'),
      expense_date: date(b.expense_date, 'Expense date', { required: true }),
      vendor: str(b.vendor, 'Vendor', { max: 300 }),
      description: str(b.description, 'Description', { required: true, max: 2000 }),
      // Negative amounts are allowed for refunds and corrections.
      amount: cents(b.amount, 'Amount', { allowNegative: true }),
      reference: str(b.reference, 'Reference', { max: 200 }),
    };
    if (f.amount === 0) throw new HttpError(400, 'Amount cannot be zero');
    const line = db.prepare('SELECT id FROM budget_lines WHERE id = ? AND grant_id = ?').get(f.budget_line_id, grant.id);
    if (!line) throw new HttpError(400, 'Budget line does not belong to this grant');
    if (f.expense_date < grant.start_date || f.expense_date > grant.end_date) {
      throw new HttpError(400, `Expense date must fall within the grant period (${grant.start_date} to ${grant.end_date})`);
    }
    if (grant.status === 'closed') throw new HttpError(400, 'This grant is closed; reopen it to change expenses');
    return f;
  }

  function lineWarning(lineId) {
    const l = db.prepare(`
      SELECT bl.name, bl.approved_amount, COALESCE(SUM(e.amount), 0) AS spent
      FROM budget_lines bl LEFT JOIN expenses e ON e.budget_line_id = bl.id WHERE bl.id = ? GROUP BY bl.id
    `).get(lineId);
    return l.spent > l.approved_amount
      ? `"${l.name}" is now over budget by $${dollars(l.spent - l.approved_amount)}`
      : null;
  }

  const EXPENSE_SELECT = `
    SELECT e.*, bl.name AS budget_line_name, bl.category, u.name AS created_by_name
    FROM expenses e JOIN budget_lines bl ON bl.id = e.budget_line_id LEFT JOIN users u ON u.id = e.created_by
  `;

  r.get('/grants/:id/expenses', (req, res) => {
    const g = loadGrant(db, req.user, req.params.id);
    const lineId = req.query.budget_line_id ? id(req.query.budget_line_id) : null;
    const rows = lineId
      ? db.prepare(`${EXPENSE_SELECT} WHERE e.grant_id = ? AND e.budget_line_id = ? ORDER BY e.expense_date DESC, e.id DESC`).all(g.id, lineId)
      : db.prepare(`${EXPENSE_SELECT} WHERE e.grant_id = ? ORDER BY e.expense_date DESC, e.id DESC`).all(g.id);
    res.json(plain(rows));
  });

  r.post('/grants/:id/expenses', (req, res) => {
    const g = loadGrant(db, req.user, req.params.id, { edit: true });
    const f = expenseFields(g, req.body);
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO expenses (grant_id, budget_line_id, expense_date, vendor, description, amount, reference, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(g.id, f.budget_line_id, f.expense_date, f.vendor, f.description, f.amount, f.reference, req.user.id);
    res.status(201).json({
      ...db.prepare(`${EXPENSE_SELECT} WHERE e.id = ?`).get(lastInsertRowid),
      warning: lineWarning(f.budget_line_id),
    });
  });

  r.put('/expenses/:id', (req, res) => {
    const { row, grant } = loadChild(db, req.user, 'expenses', req.params.id);
    const f = expenseFields(grant, req.body);
    db.prepare(`
      UPDATE expenses SET budget_line_id = ?, expense_date = ?, vendor = ?, description = ?, amount = ?, reference = ?
      WHERE id = ?
    `).run(f.budget_line_id, f.expense_date, f.vendor, f.description, f.amount, f.reference, row.id);
    res.json({ ...db.prepare(`${EXPENSE_SELECT} WHERE e.id = ?`).get(row.id), warning: lineWarning(f.budget_line_id) });
  });

  r.delete('/expenses/:id', (req, res) => {
    const { row, grant } = loadChild(db, req.user, 'expenses', req.params.id);
    if (grant.status === 'closed') throw new HttpError(400, 'This grant is closed; reopen it to change expenses');
    db.prepare('DELETE FROM expenses WHERE id = ?').run(row.id);
    res.status(204).end();
  });

  // --- Reports / deliverables -------------------------------------------
  const reportFields = (b) => {
    const f = {
      title: str(b.title, 'Title', { required: true, max: 300 }),
      report_type: str(b.report_type, 'Type', { max: 100 }) || 'Financial',
      due_date: date(b.due_date, 'Due date', { required: true }),
      submitted_date: date(b.submitted_date, 'Submitted date'),
      status: oneOf(b.status, 'Status', REPORT_STATUSES, 'upcoming'),
      notes: str(b.notes, 'Notes', { max: 2000 }),
    };
    if (f.status !== 'upcoming' && !f.submitted_date) throw new HttpError(400, 'Submitted date is required once a report is submitted');
    return f;
  };

  r.post('/grants/:id/reports', (req, res) => {
    const g = loadGrant(db, req.user, req.params.id, { edit: true });
    const f = reportFields(req.body);
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO grant_reports (grant_id, title, report_type, due_date, submitted_date, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(g.id, f.title, f.report_type, f.due_date, f.submitted_date, f.status, f.notes);
    res.status(201).json({ ...db.prepare('SELECT * FROM grant_reports WHERE id = ?').get(lastInsertRowid) });
  });

  r.put('/reports/:id', (req, res) => {
    const { row } = loadChild(db, req.user, 'grant_reports', req.params.id);
    const f = reportFields(req.body);
    db.prepare(`
      UPDATE grant_reports SET title = ?, report_type = ?, due_date = ?, submitted_date = ?, status = ?, notes = ?
      WHERE id = ?
    `).run(f.title, f.report_type, f.due_date, f.submitted_date, f.status, f.notes, row.id);
    res.json({ ...db.prepare('SELECT * FROM grant_reports WHERE id = ?').get(row.id) });
  });

  r.delete('/reports/:id', (req, res) => {
    const { row } = loadChild(db, req.user, 'grant_reports', req.params.id);
    db.prepare('DELETE FROM grant_reports WHERE id = ?').run(row.id);
    res.status(204).end();
  });

  // --- Exports ----------------------------------------------------------
  r.get('/grants/:id/export/:kind', (req, res) => {
    const g = loadGrant(db, req.user, req.params.id);
    let rows;
    if (req.params.kind === 'expenses.csv') {
      const ex = db.prepare(`${EXPENSE_SELECT} WHERE e.grant_id = ? ORDER BY e.expense_date, e.id`).all(g.id);
      rows = [
        ['Date', 'Category', 'Budget line', 'Vendor', 'Description', 'Reference', 'Amount', 'Entered by'],
        ...ex.map((e) => [e.expense_date, e.category, e.budget_line_name, e.vendor, e.description, e.reference, dollars(e.amount), e.created_by_name]),
      ];
    } else if (req.params.kind === 'budget.csv') {
      const lines = budgetLines(db, g.id);
      rows = [
        ['Category', 'Budget line', 'Approved', 'Spent', 'Remaining', '% spent'],
        ...lines.map((l) => [l.category, l.name, dollars(l.approved_amount), dollars(l.spent), dollars(l.remaining),
          l.approved_amount ? ((l.spent / l.approved_amount) * 100).toFixed(1) : '']),
        ['', 'Total', dollars(g.budgeted), dollars(g.spent), dollars(g.budgeted - g.spent), ''],
      ];
    } else {
      throw new HttpError(404, 'Unknown export');
    }
    const slug = g.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-${req.params.kind}"`);
    res.send(rows.map((row) => row.map(csvCell).join(',')).join('\r\n'));
  });

  return r;
}
