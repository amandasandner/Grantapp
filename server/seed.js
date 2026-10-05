import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth.js';
import { openDb, tx } from './db.js';

// On first start, create a superuser so someone can sign in and set things up.
export function ensureBootstrapAdmin(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const email = process.env.ADMIN_EMAIL || 'admin@example.org';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO users (email, name, password_hash, is_superuser) VALUES (?, ?, ?, 1)')
    .run(email, 'Administrator', hashPassword(password));
  console.log(`\nCreated superuser ${email}${process.env.ADMIN_PASSWORD ? '' : ` with password: ${password}`}`);
  console.log('Change this password after signing in.\n');
}

const usd = (dollars) => Math.round(dollars * 100);

// Demo data: three mission programs, users with different access, and grants
// at different points in their lifecycle.
export function seedDemo(db, { password = 'password123' } = {}) {
  const pw = hashPassword(password);
  const addDays = (d, n) => new Date(Date.parse(d) + n * 86400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  tx(db, () => {
    const program = db.prepare('INSERT INTO programs (name, description) VALUES (?, ?)');
    const programs = [
      ['Youth Education', 'After-school tutoring and college readiness'],
      ['Community Health', 'Mobile clinics and health navigation'],
      ['Housing Stability', 'Rental assistance and housing case management'],
    ].map(([n, d]) => Number(program.run(n, d).lastInsertRowid));

    const user = db.prepare('INSERT INTO users (email, name, password_hash, is_superuser) VALUES (?, ?, ?, ?)');
    const member = db.prepare('INSERT INTO user_programs (user_id, program_id, access) VALUES (?, ?, ?)');
    user.run('admin@example.org', 'Finance Director', pw, 1);
    const people = [
      ['education@example.org', 'Education Manager', programs[0], 'manager'],
      ['health@example.org', 'Health Manager', programs[1], 'manager'],
      ['housing@example.org', 'Housing Manager', programs[2], 'manager'],
      ['board@example.org', 'Health Program Viewer', programs[1], 'viewer'],
    ];
    for (const [email, name, pid, access] of people) {
      const uid = Number(user.run(email, name, pw, 0).lastInsertRowid);
      member.run(uid, pid, access);
    }

    const funder = db.prepare('INSERT INTO funders (name, contact_name, contact_email, website) VALUES (?, ?, ?, ?)');
    const funders = [
      ['Riverside Community Foundation', 'Dana Ortiz', 'dortiz@example.com', 'https://example.com'],
      ['State Department of Health', 'Grants Office', 'grants@example.gov', 'https://example.gov'],
      ['Hartwell Family Fund', 'Sam Lee', 'slee@example.com', ''],
      ['United Way', 'Program Officer', 'po@example.com', ''],
    ].map((f) => Number(funder.run(...f).lastInsertRowid));

    const grant = db.prepare(`
      INSERT INTO grants (program_id, funder_id, name, award_number, status, award_amount, award_date, start_date, end_date, restrictions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const line = db.prepare('INSERT INTO budget_lines (grant_id, category, name, approved_amount, sort_order) VALUES (?, ?, ?, ?, ?)');
    const expense = db.prepare(`
      INSERT INTO expenses (grant_id, budget_line_id, expense_date, vendor, description, amount, reference, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const report = db.prepare('INSERT INTO grant_reports (grant_id, title, report_type, due_date, status, submitted_date) VALUES (?, ?, ?, ?, ?, ?)');

    // [program, funder, name, number, status, award, startOffsetDays, lengthDays, lines[[cat, name, amt]], spendFraction]
    const grants = [
      [0, 0, 'College Pathways Initiative', 'RCF-2026-014', 'active', 150000, -200, 365,
        [['Personnel', 'Program Coordinator salary', 72000], ['Fringe', 'Benefits (22%)', 15840], ['Supplies', 'Curriculum materials', 12000],
          ['Travel', 'Campus visits', 8000], ['Contractual', 'SAT prep vendor', 30000], ['Indirect', 'Indirect costs (8%)', 12160]], 0.62],
      [0, 3, 'Summer Learning Lab', 'UW-SL-26', 'active', 60000, -120, 240,
        [['Personnel', 'Summer instructors', 36000], ['Supplies', 'STEM kits', 14000], ['Other', 'Field trips', 10000]], 0.35],
      [1, 1, 'Mobile Clinic Expansion', 'DOH-26-77812', 'active', 420000, -300, 730,
        [['Personnel', 'Nurse practitioners', 210000], ['Fringe', 'Benefits', 46200], ['Equipment', 'Mobile clinic van', 95000],
          ['Supplies', 'Medical supplies', 40000], ['Travel', 'Fuel & mileage', 12000], ['Indirect', 'Indirect costs', 16800]], 0.48],
      [1, 2, 'Health Navigators Pilot', 'HFF-0921', 'active', 85000, -340, 365,
        [['Personnel', 'Navigator stipends', 60000], ['Other', 'Community outreach', 15000], ['Supplies', 'Tablets & data plans', 10000]], 0.97],
      [2, 0, 'Eviction Prevention Fund', 'RCF-2025-088', 'active', 250000, -150, 545,
        [['Direct assistance', 'Rental assistance payments', 180000], ['Personnel', 'Case managers', 55000], ['Indirect', 'Administration', 15000]], 0.20],
      [2, 3, 'Housing First Planning Grant', 'UW-HF-25', 'closed', 40000, -500, 365,
        [['Contractual', 'Needs assessment consultant', 30000], ['Other', 'Community meetings', 10000]], 1.0],
      [2, 2, 'Landlord Engagement Program', 'HFF-1102', 'pending', 75000, 30, 365,
        [['Personnel', 'Landlord liaison', 50000], ['Other', 'Risk mitigation fund', 25000]], 0],
    ];

    const vendors = ['Office Depot', 'ADP Payroll', 'Staples', 'Amazon Business', 'Local Vendor LLC', 'City Transit', 'Shell'];
    let ref = 1000;
    const ids = {};
    for (const [pi, fi, name, num, status, award, startOff, len, lines, frac] of grants) {
      const start = addDays(today, startOff);
      const end = addDays(start, len - 1);
      const gid = Number(grant.run(programs[pi], funders[fi], name, num, status, usd(award), addDays(start, -30), start, end,
        pi === 1 ? 'Funds may not be used for lobbying or capital construction.' : '').lastInsertRowid);
      ids[name] = gid;
      lines.forEach(([cat, ln, amt], i) => {
        const lid = Number(line.run(gid, cat, ln, usd(amt), i).lastInsertRowid);
        // Spread spending across the elapsed part of the period; push one line over budget for the demo.
        const target = amt * frac * (name === 'Health Navigators Pilot' && i === 1 ? 1.12 : 1);
        const lastDay = status === 'closed' ? end : (today < end ? today : end);
        const span = Math.max(1, Math.round((Date.parse(lastDay) - Date.parse(start)) / 86400_000));
        const n = target > 0 ? Math.max(1, Math.min(10, Math.round(target / 4000))) : 0;
        for (let k = 0; k < n; k++) {
          const when = addDays(start, Math.floor((span * (k + 0.5)) / n));
          expense.run(gid, lid, when, vendors[(k + i) % vendors.length], `${ln} — installment ${k + 1}`,
            usd(target / n), `INV-${ref++}`);
        }
      });
      if (status !== 'pending') {
        report.run(gid, 'Interim financial report', 'Financial', addDays(start, Math.round(len / 2)),
          addDays(start, Math.round(len / 2)) < today ? 'submitted' : 'upcoming',
          addDays(start, Math.round(len / 2)) < today ? addDays(start, Math.round(len / 2) - 3) : null);
        report.run(gid, 'Final narrative & financial report', 'Final', addDays(end, 60),
          status === 'closed' ? 'accepted' : 'upcoming', status === 'closed' ? addDays(end, 45) : null);
      }
    }
    // An overdue deliverable to show up on the dashboard.
    report.run(ids['Health Navigators Pilot'], 'Quarterly outcomes report', 'Programmatic', addDays(today, -5), 'upcoming', null);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
    console.error('Database already has data. Delete data/grantapp.db to reseed.');
    process.exit(1);
  }
  seedDemo(db);
  console.log('Seeded demo data. Sign in as admin@example.org / password123 (superuser),');
  console.log('or education@, health@, housing@, board@example.org with the same password.');
}
