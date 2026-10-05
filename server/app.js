import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from './auth.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import grantRoutes from './routes/grants.js';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(authenticate(db));

  // Cross-site request guard: state-changing API calls must carry a custom
  // header, which browsers won't send cross-origin without a CORS preflight.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.headers['x-requested-with'] !== 'grantapp') {
      return res.status(403).json({ error: 'Missing request header' });
    }
    next();
  });

  app.use('/api/auth', authRoutes(db));
  app.use('/api', adminRoutes(db));
  app.use('/api', grantRoutes(db));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  if (fs.existsSync(DIST)) {
    app.use(express.static(DIST));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
