# Grant Tracker

A web app for tracking grant awards, approved budgets, and expenses across an
organization's mission programs — similar in spirit to the grantseeker side of
Fluxx. Each program sees only its own grants; superusers see everything, and all
data rolls up into a dashboard of remaining funds.

## Features

- **Mission programs & permissions**
  - **Superuser**: sees and manages every program, grant, user, and setting.
  - **Program manager**: sees their program(s) and can add and edit grants, budgets, expenses, and reports.
  - **Program viewer**: read-only access to their program(s).
  - A user can belong to several programs with different access in each. Access is
    enforced by the API, not just hidden in the UI. Grants in other programs return
    "not found", so users can't tell they exist.
- **Grants**: funder, award number, award amount and date, grant period (start/end),
  status (pending / active / closed), restrictions, and notes. A program can have any
  number of grants, each with its own budget and dates.
- **Approved budgets**: line items by category (Personnel, Fringe, Travel, …). Lines
  can't total more than the award, and the app shows any part of the award not yet assigned to a line.
- **Expenses** are recorded against a budget line, with vendor, invoice/reference #, and who entered them.
  - Dates must fall within the grant period, and closed grants are locked.
  - Negative amounts can be entered for refunds and corrections.
  - Going over a line's budget is allowed but flagged.
- **Reporting requirements**: financial and programmatic deadlines, with overdue tracking.
- **Dashboard**: remaining funds, total awarded and spent, remaining by program,
  12-month spending, budget vs. actual by category, and a per-grant "burn vs. time"
  meter that compares spending to how much of the grant period has passed.
  - Pace flags show when a grant is spending ahead of plan, underspending, or over its award.
  - A **Needs attention** list collects overdue and upcoming reports, over-budget lines, and grants ending within 90 days.
- **CSV exports** per grant: the expense ledger and budget vs. actual.

## Running locally

Requires **Node.js 22.13+** (it uses the built-in `node:sqlite`, so there are no native modules to compile).

```bash
npm install
npm run seed      # optional: demo data (3 programs, 7 grants, sample users)
npm run dev       # API on :3001, web app on http://localhost:5173
```

Demo logins (password `password123`):

| Email | Access |
|---|---|
| admin@example.org | Superuser (all programs) |
| education@example.org | Manager, Youth Education |
| health@example.org | Manager, Community Health |
| housing@example.org | Manager, Housing Stability |
| board@example.org | Viewer (read-only), Community Health |

Without seeding, the first start creates a superuser: `ADMIN_EMAIL` (default
`admin@example.org`) with `ADMIN_PASSWORD`, or a random password printed to the console.
Sign in, rename the programs under **Admin**, and invite your staff.

## Production

```bash
npm run build
npm start         # serves the built app and API on PORT (default 3001)
```

Or with Docker:

```bash
docker build -t grantapp .
docker run -p 3001:3001 -v grantapp-data:/data -e ADMIN_PASSWORD='choose-a-strong-one' grantapp
```

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `DB_FILE` | `data/grantapp.db` | SQLite database path. Back this file up. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | First superuser, created only when there are no users |
| `INSECURE_COOKIES` | unset | Set to `1` to allow sign-in over plain HTTP in production (not recommended) |

In production, session cookies are marked `Secure`, so serve the app over HTTPS
(for example, behind a reverse proxy).

## Project layout

```
server/            Express API
  db.js            SQLite schema (money stored as integer cents)
  auth.js          Password hashing, sessions, program-level access rules
  rollups.js       Spent / remaining / pace calculations and dashboard aggregation
  routes/          auth, admin (programs & users), grants (budgets, expenses, reports, exports)
  seed.js          Bootstrap admin + demo data
client/src/        React front end (Vite)
test/              API tests, including permission isolation between programs
```

## Tests

```bash
npm test
```
