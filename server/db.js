import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// All money is stored as integer cents to avoid floating-point drift.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS programs (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_superuser  INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A user's access to a program: 'manager' can edit, 'viewer' is read-only.
CREATE TABLE IF NOT EXISTS user_programs (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  access     TEXT NOT NULL CHECK (access IN ('manager', 'viewer')),
  PRIMARY KEY (user_id, program_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS funders (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  contact_name  TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  website       TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS grants (
  id              INTEGER PRIMARY KEY,
  program_id      INTEGER NOT NULL REFERENCES programs(id),
  funder_id       INTEGER REFERENCES funders(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  award_number    TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('pending', 'active', 'closed')),
  award_amount    INTEGER NOT NULL DEFAULT 0,
  award_date      TEXT,
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,
  restrictions    TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id              INTEGER PRIMARY KEY,
  grant_id        INTEGER NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  category        TEXT NOT NULL DEFAULT 'Other',
  name            TEXT NOT NULL,
  approved_amount INTEGER NOT NULL DEFAULT 0,
  notes           TEXT NOT NULL DEFAULT '',
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expenses (
  id             INTEGER PRIMARY KEY,
  grant_id       INTEGER NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  budget_line_id INTEGER NOT NULL REFERENCES budget_lines(id) ON DELETE RESTRICT,
  expense_date   TEXT NOT NULL,
  vendor         TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  amount         INTEGER NOT NULL,
  reference      TEXT NOT NULL DEFAULT '',
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reporting requirements / deliverables owed to the funder.
CREATE TABLE IF NOT EXISTS grant_reports (
  id             INTEGER PRIMARY KEY,
  grant_id       INTEGER NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  report_type    TEXT NOT NULL DEFAULT 'Financial',
  due_date       TEXT NOT NULL,
  submitted_date TEXT,
  status         TEXT NOT NULL DEFAULT 'upcoming'
                 CHECK (status IN ('upcoming', 'submitted', 'accepted')),
  notes          TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_grants_program ON grants(program_id);
CREATE INDEX IF NOT EXISTS idx_lines_grant ON budget_lines(grant_id);
CREATE INDEX IF NOT EXISTS idx_expenses_grant ON expenses(grant_id);
CREATE INDEX IF NOT EXISTS idx_expenses_line ON expenses(budget_line_id);
CREATE INDEX IF NOT EXISTS idx_reports_grant ON grant_reports(grant_id);
`;

export function openDb(file = process.env.DB_FILE || 'data/grantapp.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// Run fn inside a transaction, rolling back on any thrown error.
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
