import crypto from 'node:crypto';

const SESSION_DAYS = 7;
export const COOKIE = 'grantapp_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires };
}

export function destroySession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Load the user (with program memberships) for the session cookie, if any.
export function loadUser(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, u.name, u.is_superuser
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ? AND u.active = 1
  `).get(token, new Date().toISOString());
  if (!row) return null;
  const programs = db.prepare(`
    SELECT up.program_id AS id, p.name, up.access
    FROM user_programs up JOIN programs p ON p.id = up.program_id
    WHERE up.user_id = ? ORDER BY p.name
  `).all(row.id);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isSuperuser: !!row.is_superuser,
    programs: programs.map((p) => ({ ...p })),
  };
}

export function authenticate(db) {
  return (req, _res, next) => {
    req.user = loadUser(db, req.cookies?.[COOKIE]);
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

export function requireSuperuser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (!req.user.isSuperuser) return res.status(403).json({ error: 'Superuser access required' });
  next();
}

// --- Program-level access rules -------------------------------------------

// Program ids the user may view, or null meaning "all programs" (superuser).
export function visibleProgramIds(user) {
  if (user.isSuperuser) return null;
  return user.programs.map((p) => p.id);
}

export function canView(user, programId) {
  return user.isSuperuser || user.programs.some((p) => p.id === Number(programId));
}

export function canEdit(user, programId) {
  return user.isSuperuser || user.programs.some((p) => p.id === Number(programId) && p.access === 'manager');
}

export function isAnyManager(user) {
  return user.isSuperuser || user.programs.some((p) => p.access === 'manager');
}
