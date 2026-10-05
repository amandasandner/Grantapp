import { Router } from 'express';
import {
  COOKIE, createSession, destroySession, verifyPassword, hashPassword, requireAuth,
} from '../auth.js';
import { HttpError, str } from '../util.js';

export default function authRoutes(db) {
  const r = Router();

  r.post('/login', (req, res) => {
    const email = str(req.body.email, 'Email', { required: true });
    const password = String(req.body.password ?? '');
    const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ? AND active = 1').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid email or password');
    }
    const { token, expires } = createSession(db, user.id);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1',
      expires: new Date(expires),
    });
    res.json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    const token = req.cookies?.[COOKIE];
    if (token) destroySession(db, token);
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  r.get('/me', requireAuth, (req, res) => res.json(req.user));

  r.post('/password', requireAuth, (req, res) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body.current_password ?? ''), row.password_hash)) {
      throw new HttpError(400, 'Current password is incorrect');
    }
    const next = String(req.body.new_password ?? '');
    if (next.length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
    res.json({ ok: true });
  });

  return r;
}
