import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { seedDemo } from '../server/seed.js';

let app;
let db;

before(() => {
  db = openDb(':memory:');
  seedDemo(db);
  app = createApp(db);
});

async function login(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'grantapp')
    .send({ email, password: 'password123' });
  assert.equal(res.status, 200, res.text);
  const send = (method) => (url, body) => {
    const r = agent[method](url).set('X-Requested-With', 'grantapp');
    return body === undefined ? r : r.send(body);
  };
  return { get: (url) => agent.get(url), post: send('post'), put: send('put'), del: send('delete') };
}

const programId = (name) => db.prepare('SELECT id FROM programs WHERE name = ?').get(name).id;
const grantId = (name) => db.prepare('SELECT id FROM grants WHERE name = ?').get(name).id;

test('unauthenticated requests are rejected', async () => {
  const res = await request(app).get('/api/grants');
  assert.equal(res.status, 401);
});

test('bad password is rejected', async () => {
  const res = await request(app).post('/api/auth/login').set('X-Requested-With', 'grantapp')
    .send({ email: 'admin@example.org', password: 'nope' });
  assert.equal(res.status, 401);
});

test('writes without the request header are refused', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@example.org', password: 'password123' });
  assert.equal(res.status, 403);
});

test('superuser sees grants from every program', async () => {
  const admin = await login('admin@example.org');
  const res = await admin.get('/api/grants');
  const programs = new Set(res.body.map((g) => g.program_name));
  assert.equal(programs.size, 3);
  const dash = await admin.get('/api/dashboard?status=all');
  assert.equal(dash.body.programs.length, 3);
});

test('program manager only sees their own program', async () => {
  const edu = await login('education@example.org');
  const res = await edu.get('/api/grants');
  assert.ok(res.body.length > 0);
  assert.ok(res.body.every((g) => g.program_name === 'Youth Education'));

  const programs = await edu.get('/api/programs');
  assert.deepEqual(programs.body.map((p) => p.name), ['Youth Education']);

  const dash = await edu.get('/api/dashboard?status=all');
  assert.deepEqual(dash.body.programs.map((p) => p.program_name), ['Youth Education']);

  // Another program's grant looks like it doesn't exist.
  const other = await edu.get(`/api/grants/${grantId('Mobile Clinic Expansion')}`);
  assert.equal(other.status, 404);
  const otherDash = await edu.get(`/api/dashboard?program_id=${programId('Community Health')}`);
  assert.equal(otherDash.status, 404);
  const csv = await edu.get(`/api/grants/${grantId('Mobile Clinic Expansion')}/export/expenses.csv`);
  assert.equal(csv.status, 404);
});

test('manager cannot create grants or expenses in another program', async () => {
  const edu = await login('education@example.org');
  const res = await edu.post('/api/grants', {
    program_id: programId('Housing Stability'), name: 'Sneaky', award_amount: 100, start_date: '2026-01-01', end_date: '2026-12-31',
  });
  assert.equal(res.status, 403);

  const gid = grantId('Eviction Prevention Fund');
  const line = db.prepare('SELECT id FROM budget_lines WHERE grant_id = ?').get(gid);
  const exp = await edu.post(`/api/grants/${gid}/expenses`, {
    budget_line_id: line.id, expense_date: new Date().toISOString().slice(0, 10), description: 'x', amount: 100,
  });
  assert.equal(exp.status, 404);

  const expenseId = db.prepare('SELECT id FROM expenses WHERE grant_id = ?').get(gid).id;
  assert.equal((await edu.del(`/api/expenses/${expenseId}`)).status, 404);
  assert.equal((await edu.put(`/api/budget-lines/${line.id}`, { name: 'x', approved_amount: 1 })).status, 404);
});

test('viewer can read but not modify their program', async () => {
  const viewer = await login('board@example.org');
  const gid = grantId('Mobile Clinic Expansion');
  const g = await viewer.get(`/api/grants/${gid}`);
  assert.equal(g.status, 200);
  assert.equal(g.body.can_edit, false);
  const line = g.body.budget_lines[0];
  const res = await viewer.post(`/api/grants/${gid}/expenses`, {
    budget_line_id: line.id, expense_date: g.body.start_date, description: 'x', amount: 100,
  });
  assert.equal(res.status, 403);
  assert.equal((await viewer.put(`/api/grants/${gid}`, { ...g.body, name: 'Renamed' })).status, 403);
  assert.equal((await viewer.post('/api/funders', { name: 'New funder' })).status, 403);
});

test('non-superusers cannot manage users or programs', async () => {
  const edu = await login('education@example.org');
  assert.equal((await edu.get('/api/users')).status, 403);
  assert.equal((await edu.post('/api/programs', { name: 'X' })).status, 403);
});

test('full grant lifecycle with budget and expense rollups', async () => {
  const mgr = await login('housing@example.org');
  const created = await mgr.post('/api/grants', {
    program_id: programId('Housing Stability'), name: 'Test Grant', award_amount: 1_000_000,
    start_date: '2026-01-01', end_date: '2026-12-31', status: 'active',
  });
  assert.equal(created.status, 201, created.text);
  const gid = created.body.id;

  const l1 = await mgr.post(`/api/grants/${gid}/budget-lines`, { category: 'Personnel', name: 'Staff', approved_amount: 600_000 });
  const l2 = await mgr.post(`/api/grants/${gid}/budget-lines`, { category: 'Supplies', name: 'Supplies', approved_amount: 400_000 });
  assert.equal(l1.status, 201);
  assert.equal(l2.status, 201);

  // Budget cannot exceed the award.
  const over = await mgr.post(`/api/grants/${gid}/budget-lines`, { name: 'Extra', approved_amount: 1 });
  assert.equal(over.status, 400);

  // Expense outside the grant period is rejected.
  const early = await mgr.post(`/api/grants/${gid}/expenses`, {
    budget_line_id: l1.body.id, expense_date: '2025-12-31', description: 'Too early', amount: 100,
  });
  assert.equal(early.status, 400);

  const e1 = await mgr.post(`/api/grants/${gid}/expenses`, {
    budget_line_id: l1.body.id, expense_date: '2026-02-01', description: 'Payroll', amount: 250_000,
  });
  assert.equal(e1.status, 201, e1.text);
  assert.equal(e1.body.warning, null);

  const e2 = await mgr.post(`/api/grants/${gid}/expenses`, {
    budget_line_id: l2.body.id, expense_date: '2026-03-01', description: 'Laptops', amount: 450_000,
  });
  assert.match(e2.body.warning, /over budget by \$500\.00/);

  const g = await mgr.get(`/api/grants/${gid}`);
  assert.equal(g.body.spent, 700_000);
  assert.equal(g.body.remaining, 300_000);
  assert.equal(g.body.budgeted, 1_000_000);
  const staff = g.body.budget_lines.find((l) => l.name === 'Staff');
  assert.equal(staff.remaining, 350_000);

  // Expense must belong to a line on the same grant.
  const otherLine = db.prepare('SELECT bl.id FROM budget_lines bl WHERE bl.grant_id <> ?').get(gid);
  const wrong = await mgr.post(`/api/grants/${gid}/expenses`, {
    budget_line_id: otherLine.id, expense_date: '2026-02-01', description: 'x', amount: 1,
  });
  assert.equal(wrong.status, 400);

  // Award can't drop below the approved budget.
  const shrink = await mgr.put(`/api/grants/${gid}`, { ...g.body, award_amount: 10 });
  assert.equal(shrink.status, 400);

  // Line with expenses can't be deleted.
  assert.equal((await mgr.del(`/api/budget-lines/${l1.body.id}`)).status, 409);

  const csv = await mgr.get(`/api/grants/${gid}/export/budget.csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /"Staff","6000.00","2500.00","3500.00"/);

  assert.equal((await mgr.del(`/api/grants/${gid}`)).status, 204);
  assert.equal((await mgr.get(`/api/grants/${gid}`)).status, 404);
});

test('superuser can grant a user access to a program', async () => {
  const admin = await login('admin@example.org');
  const created = await admin.post('/api/users', {
    email: 'new@example.org', name: 'New Person', password: 'password123',
    programs: [{ id: programId('Youth Education'), access: 'viewer' }],
  });
  assert.equal(created.status, 201, created.text);
  const newbie = await login('new@example.org');
  const grants = await newbie.get('/api/grants');
  assert.ok(grants.body.length > 0 && grants.body.every((g) => g.program_name === 'Youth Education'));

  await admin.put(`/api/users/${created.body.id}`, { programs: [] });
  assert.equal((await newbie.get('/api/grants')).body.length, 0);

  await admin.put(`/api/users/${created.body.id}`, { active: false });
  assert.equal((await newbie.get('/api/grants')).status, 401);
});

test('dashboard flags over-budget lines and computes remaining funds', async () => {
  const admin = await login('admin@example.org');
  const dash = await admin.get('/api/dashboard');
  assert.equal(dash.status, 200);
  const t = dash.body.totals;
  assert.equal(t.remaining, t.award - t.spent);
  assert.ok(dash.body.over_budget_lines.some((l) => l.grant_name === 'Health Navigators Pilot'));
  assert.ok(dash.body.upcoming_reports.some((r) => r.overdue));
  assert.equal(dash.body.monthly_spending.length, 12);
});
