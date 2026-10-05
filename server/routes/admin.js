import { Router } from 'express';
import { hashPassword, requireAuth, requireSuperuser, visibleProgramIds } from '../auth.js';
import { tx } from '../db.js';
import { HttpError, id, plain, str } from '../util.js';

function userWithPrograms(db, userId) {
  const u = db.prepare('SELECT id, email, name, is_superuser, active, created_at FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  const programs = plain(db.prepare(`
    SELECT up.program_id AS id, p.name, up.access FROM user_programs up
    JOIN programs p ON p.id = up.program_id WHERE up.user_id = ? ORDER BY p.name
  `).all(userId));
  return { ...u, is_superuser: !!u.is_superuser, active: !!u.active, programs };
}

function setMemberships(db, userId, programs) {
  if (!Array.isArray(programs)) return;
  db.prepare('DELETE FROM user_programs WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT INTO user_programs (user_id, program_id, access) VALUES (?, ?, ?)');
  for (const p of programs) {
    const access = p.access === 'manager' ? 'manager' : 'viewer';
    const pid = id(p.id ?? p.program_id, 'program');
    if (!db.prepare('SELECT 1 FROM programs WHERE id = ?').get(pid)) throw new HttpError(400, `Unknown program ${pid}`);
    ins.run(userId, pid, access);
  }
}

export default function adminRoutes(db) {
  const r = Router();

  // --- Programs ---------------------------------------------------------
  r.get('/programs', requireAuth, (req, res) => {
    const ids = visibleProgramIds(req.user);
    const rows = ids === null
      ? db.prepare('SELECT * FROM programs ORDER BY name').all()
      : ids.length
        ? db.prepare(`SELECT * FROM programs WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`).all(...ids)
        : [];
    res.json(plain(rows));
  });

  r.post('/programs', requireSuperuser, (req, res) => {
    const name = str(req.body.name, 'Name', { required: true, max: 200 });
    const description = str(req.body.description, 'Description');
    if (db.prepare('SELECT 1 FROM programs WHERE name = ?').get(name)) throw new HttpError(409, 'A program with that name already exists');
    const { lastInsertRowid } = db.prepare('INSERT INTO programs (name, description) VALUES (?, ?)').run(name, description);
    res.status(201).json({ ...db.prepare('SELECT * FROM programs WHERE id = ?').get(lastInsertRowid) });
  });

  r.put('/programs/:id', requireSuperuser, (req, res) => {
    const pid = id(req.params.id);
    const name = str(req.body.name, 'Name', { required: true, max: 200 });
    const description = str(req.body.description, 'Description');
    const result = db.prepare('UPDATE programs SET name = ?, description = ? WHERE id = ?').run(name, description, pid);
    if (!result.changes) throw new HttpError(404, 'Program not found');
    res.json({ ...db.prepare('SELECT * FROM programs WHERE id = ?').get(pid) });
  });

  r.delete('/programs/:id', requireSuperuser, (req, res) => {
    const pid = id(req.params.id);
    if (db.prepare('SELECT 1 FROM grants WHERE program_id = ?').get(pid)) {
      throw new HttpError(409, 'Program still has grants; move or delete them first');
    }
    db.prepare('DELETE FROM programs WHERE id = ?').run(pid);
    res.status(204).end();
  });

  // --- Users ------------------------------------------------------------
  r.get('/users', requireSuperuser, (_req, res) => {
    const ids = db.prepare('SELECT id FROM users ORDER BY name').all();
    res.json(ids.map((u) => userWithPrograms(db, u.id)));
  });

  r.post('/users', requireSuperuser, (req, res) => {
    const email = str(req.body.email, 'Email', { required: true, max: 200 });
    const name = str(req.body.name, 'Name', { required: true, max: 200 });
    const password = String(req.body.password ?? '');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'A user with that email already exists');
    const userId = tx(db, () => {
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO users (email, name, password_hash, is_superuser) VALUES (?, ?, ?, ?)',
      ).run(email, name, hashPassword(password), req.body.is_superuser ? 1 : 0);
      setMemberships(db, Number(lastInsertRowid), req.body.programs ?? []);
      return Number(lastInsertRowid);
    });
    res.status(201).json(userWithPrograms(db, userId));
  });

  r.put('/users/:id', requireSuperuser, (req, res) => {
    const uid = id(req.params.id);
    const existing = userWithPrograms(db, uid);
    if (!existing) throw new HttpError(404, 'User not found');
    const isSelf = uid === req.user.id;
    if (isSelf && (req.body.is_superuser === false || req.body.active === false)) {
      throw new HttpError(400, 'You cannot remove your own superuser access or deactivate yourself');
    }
    tx(db, () => {
      const email = str(req.body.email ?? existing.email, 'Email', { required: true, max: 200 });
      const name = str(req.body.name ?? existing.name, 'Name', { required: true, max: 200 });
      const dupe = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, uid);
      if (dupe) throw new HttpError(409, 'A user with that email already exists');
      db.prepare('UPDATE users SET email = ?, name = ?, is_superuser = ?, active = ? WHERE id = ?').run(
        email, name,
        (req.body.is_superuser ?? existing.is_superuser) ? 1 : 0,
        (req.body.active ?? existing.active) ? 1 : 0,
        uid,
      );
      if (req.body.password) {
        if (String(req.body.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(req.body.password)), uid);
      }
      if (req.body.active === false) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
      setMemberships(db, uid, req.body.programs);
    });
    res.json(userWithPrograms(db, uid));
  });

  r.delete('/users/:id', requireSuperuser, (req, res) => {
    const uid = id(req.params.id);
    if (uid === req.user.id) throw new HttpError(400, 'You cannot delete yourself');
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    res.status(204).end();
  });

  return r;
}
