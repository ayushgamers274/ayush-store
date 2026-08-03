/* One-time migration: SQLite (data/app.db + uploads/) -> PostgreSQL (DATABASE_URL) */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');

const env = {};
if (fs.existsSync(path.join(__dirname, '.env'))) {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

const connectionString = env.DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Set DATABASE_URL first (the Neon/Render Postgres connection string).');
  process.exit(1);
}

const dbUrl = new URL(connectionString);
const pool = new Pool({
  connectionString,
  ssl: (dbUrl.hostname !== 'localhost' && dbUrl.hostname !== '127.0.0.1') ? { rejectUnauthorized: false } : false
});

(async () => {
  if (!fs.existsSync(DB_PATH)) {
    console.error('No SQLite DB found at', DB_PATH);
    process.exit(1);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'web', tags TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL, original_name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, downloads INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), file_data BYTEA, image TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', status TEXT NOT NULL DEFAULT 'created', payment_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', text TEXT NOT NULL, is_bot INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const src = new DatabaseSync(DB_PATH, { readOnly: true });
  const count = (t) => src.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const total = count('settings') + count('users') + count('sessions') + count('projects') + count('orders') + count('messages');

  console.log(`Migrating ${total} rows from SQLite -> PostgreSQL...`);

  for (const row of src.prepare('SELECT * FROM settings').all()) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [row.key, row.value]);
  }
  console.log('  settings:', count('settings'));

  for (const row of src.prepare('SELECT * FROM users').all()) {
    await pool.query('INSERT INTO users (id, name, email, password, role, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING', [row.id, row.name, row.email, row.password, row.role, row.created_at]);
  }
  console.log('  users:', count('users'));

  for (const row of src.prepare('SELECT * FROM sessions').all()) {
    await pool.query('INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (token) DO NOTHING', [row.token, row.user_id, row.created_at]);
  }
  console.log('  sessions:', count('sessions'));

  for (const row of src.prepare('SELECT * FROM projects').all()) {
    const filePath = path.join(UPLOAD_DIR, row.filename);
    const fileData = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    await pool.query(
      'INSERT INTO projects (id, title, description, price, category, tags, filename, original_name, size, downloads, created_at, file_data, image) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (id) DO NOTHING',
      [row.id, row.title, row.description, row.price, row.category, row.tags, row.filename, row.original_name, row.size, row.downloads, row.created_at, fileData, row.image || null]
    );
    console.log(`  project ${row.id} (${row.title}): ${fileData ? (fileData.length + ' bytes') : 'NO FILE FOUND'}`);
  }

  for (const row of src.prepare('SELECT * FROM orders').all()) {
    await pool.query('INSERT INTO orders (id, project_id, user_id, amount, currency, status, payment_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING', [row.id, row.project_id, row.user_id, row.amount, row.currency, row.status, row.payment_id, row.created_at]);
  }
  console.log('  orders:', count('orders'));

  for (const row of src.prepare('SELECT * FROM messages').all()) {
    await pool.query('INSERT INTO messages (id, name, role, text, is_bot, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING', [row.id, row.name, row.role, row.text, row.is_bot, row.created_at]);
  }
  console.log('  messages:', count('messages'));

  await pool.end();
  console.log('\nMigration complete.');
})().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
