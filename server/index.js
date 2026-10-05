import { createApp } from './app.js';
import { openDb } from './db.js';
import { ensureBootstrapAdmin } from './seed.js';

const db = openDb();
ensureBootstrapAdmin(db);

const port = Number(process.env.PORT) || 3001;
createApp(db).listen(port, () => {
  console.log(`Grant tracker API listening on http://localhost:${port}`);
});
