const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT) || 3000;

const env = {};
if (fs.existsSync(path.join(__dirname, '.env'))) {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

const connectionString = env.DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres@localhost:5433/app';
const dbUrl = new URL(connectionString);
const pool = new Pool({
  connectionString,
  ssl: (dbUrl.hostname !== 'localhost' && dbUrl.hostname !== '127.0.0.1') ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
pool.on('error', (err) => {
  console.error('Postgres pool error:', err.message);
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'web',
      tags TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      downloads INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      file_data BYTEA
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'created',
      payment_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      text TEXT NOT NULL,
      is_bot INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_id ON messages (id)');
  await pool.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS image TEXT');
}

const DEFAULT_SETTINGS = {
  site_name: 'Ayush',
  tagline: 'Full-stack developer & project creator',
  bio: 'I build fast, clean and reliable web products. Browse my projects, download the free ones, or buy premium ones with UPI — and say hi in the chat.',
  email: 'ayush@example.com',
  github: 'https://github.com/',
  linkedin: 'https://linkedin.com/',
  x: 'https://x.com/',
  instagram: 'https://instagram.com/',
  hero_words: '["full-stack developer","project creator","chai enthusiast"]',
  upi_id: '',
  upi_name: 'Ayush',
  upi_qr: ''
};

async function seedDefaults() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM settings');
  if (rows[0].n === 0) {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2)', [k, v]);
    }
  }
  const admins = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (admins.rows.length === 0) {
    const email = String(env.ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'admin@ayush.dev').trim().toLowerCase();
    const pass = env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const hash = bcrypt.hashSync(pass, 10);
    await pool.query("INSERT INTO users (name, email, password, role) VALUES ('Ayush', $1, $2, 'admin')", [email, hash]);
    console.log(`  Admin created: ${email} / ${(env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD) ? '(from env)' : pass}`);
  }
}

async function getSettings(includeSecrets) {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  const s = { ...DEFAULT_SETTINGS };
  rows.forEach((r) => {
    if (!includeSecrets && r.key === 'upi_id') return;
    s[r.key] = r.value;
  });
  if (!includeSecrets) delete s.upi_id;
  return s;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function cookieToken(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(/(?:^|;\s*)token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function getUserByToken(req) {
  const token = cookieToken(req);
  if (!token) return null;
  const { rows } = await pool.query(
    'SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1',
    [token]
  );
  return rows[0] || null;
}

function requireAuth(req, res, next) {
  getUserByToken(req).then((user) => {
    if (!user) return res.status(401).json({ error: 'Please log in first' });
    req.user = user;
    next();
  }).catch(next);
}

function requireAdmin(req, res, next) {
  getUserByToken(req).then((user) => {
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    req.user = user;
    next();
  }).catch(next);
}

function setTokenCookie(res, token) {
  res.setHeader('Set-Cookie', `token=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
}

function publicProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: row.price,
    category: row.category,
    tags: (row.tags || '').split(',').filter(Boolean),
    size: row.size,
    downloads: row.downloads,
    image: row.image || null,
    created_at: row.created_at
  };
}

/* ---------------- auth ---------------- */

app.post('/api/register', h(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
  const password = String(req.body.password || '');
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (exists.rows.length) return res.status(409).json({ error: 'An account with this email already exists' });
  const hash = bcrypt.hashSync(password, 10);
  const inserted = await pool.query('INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id', [name, email, hash]);
  const id = Number(inserted.rows[0].id);
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, id]);
  setTokenCookie(res, token);
  res.json({ user: { id, name, email, role: 'user' } });
}));

app.post('/api/login', h(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id]);
  setTokenCookie(res, token);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

app.post('/api/logout', h(async (req, res) => {
  const token = cookieToken(req);
  if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.setHeader('Set-Cookie', 'token=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
}));

app.get('/api/me', h(async (req, res) => {
  const user = await getUserByToken(req);
  if (!user) return res.json({ user: null });
  res.json({ user });
}));

/* ---------------- public ---------------- */

app.get('/api/settings', h(async (req, res) => {
  const s = await getSettings(false);
  s.hero_words = JSON.parse(s.hero_words || '[]');
  res.json(s);
}));

app.get('/api/admin/settings', requireAdmin, h(async (req, res) => {
  const s = await getSettings(true);
  s.hero_words = JSON.parse(s.hero_words || '[]');
  res.json(s);
}));

app.get('/api/projects', h(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects ORDER BY created_at DESC');
  res.json(rows.map(publicProject));
}));

app.get('/api/projects/:id', h(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'Project not found' });
  res.json(publicProject(rows[0]));
}));

app.get('/api/me/owned', requireAuth, h(async (req, res) => {
  const { rows } = await pool.query("SELECT project_id FROM orders WHERE user_id = $1 AND status = 'paid'", [req.user.id]);
  res.json(rows.map((r) => r.project_id));
}));

app.get('/api/me/orders', requireAuth, h(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT o.id, o.project_id, o.amount, o.currency, o.status, o.payment_id, o.created_at, p.title, p.price AS project_price, p.category
    FROM orders o JOIN projects p ON p.id = o.project_id
    WHERE o.user_id = $1 ORDER BY o.id DESC LIMIT 100
  `, [req.user.id]);
  res.json(rows);
}));

app.get('/api/admin/payments/status', requireAdmin, h(async (req, res) => {
  const s = await getSettings(true);
  const upiId = (s.upi_id || '').trim();
  res.json({ configured: !!upiId, upiId });
}));

/* ---------------- downloads ---------------- */

app.get('/api/download/:id', requireAuth, h(async (req, res) => {
  const { rows } = await pool.query('SELECT id, title, original_name, price, file_data FROM projects WHERE id = $1', [Number(req.params.id)]);
  const project = rows[0];
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.price > 0) {
    const paid = await pool.query("SELECT id FROM orders WHERE project_id = $1 AND user_id = $2 AND status = 'paid'", [project.id, req.user.id]);
    if (!paid.rows.length) return res.status(403).json({ error: 'You need to buy this project first' });
  }
  if (!project.file_data || !project.file_data.length) return res.status(404).json({ error: 'File missing on server' });
  await pool.query('UPDATE projects SET downloads = downloads + 1 WHERE id = $1', [project.id]);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', project.file_data.length);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(project.original_name)}`);
  res.end(project.file_data);
}));

/* ---------------- payments (UPI via FamPay / any UPI app) ---------------- */

app.post('/api/orders', requireAuth, h(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [Number(req.body.projectId)]);
  const project = rows[0];
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.price <= 0) return res.status(400).json({ error: 'This project is free — just download it' });
  const existing = await pool.query("SELECT id FROM orders WHERE project_id = $1 AND user_id = $2 AND status = 'paid'", [project.id, req.user.id]);
  if (existing.rows.length) return res.json({ alreadyOwned: true });
  const pending = await pool.query("SELECT id FROM orders WHERE project_id = $1 AND user_id = $2 AND status IN ('created','verify')", [project.id, req.user.id]);
  if (pending.rows.length) return res.json({ alreadyPending: true });

  const s = await getSettings(true);
  const upiId = (s.upi_id || '').trim();
  if (!upiId) return res.status(400).json({ error: 'Store owner has not set up UPI yet — message them in the chat' });

  const inserted = await pool.query("INSERT INTO orders (project_id, user_id, amount, currency, status) VALUES ($1, $2, $3, 'INR', 'created') RETURNING id", [project.id, req.user.id, project.price]);
  const orderId = Number(inserted.rows[0].id);
  res.json({
    orderId,
    amount: project.price,
    projectTitle: project.title,
    upi: { id: upiId, name: s.upi_name || '', orderId }
  });
}));

app.post('/api/orders/verify', requireAuth, h(async (req, res) => {
  const { orderId, utr } = req.body;
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [Number(orderId)]);
  const order = rows[0];
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.user_id !== req.user.id) return res.status(403).json({ error: 'Not your order' });
  if (order.status === 'paid') return res.json({ ok: true, alreadyOwned: true });
  const ref = String(utr || '').trim().slice(0, 80);
  if (!/^\d{10,16}$/.test(ref)) return res.status(400).json({ error: 'Invalid UTR — enter the 10-16 digit transaction number from your UPI app' });
  const usedElsewhere = await pool.query("SELECT id FROM orders WHERE payment_id = $1 AND id != $2 AND status <> 'rejected'", [ref, order.id]);
  if (usedElsewhere.rows.length) return res.status(400).json({ error: 'This UTR is already used on another order' });
  await pool.query("UPDATE orders SET status = 'verify', payment_id = $1 WHERE id = $2", [ref, order.id]);
  res.json({ ok: true, status: 'verify' });
}));

app.post('/api/orders/approve', requireAdmin, h(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [Number(req.body.orderId)]);
  const order = rows[0];
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const approve = req.body.approve !== false;
  await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [approve ? 'paid' : 'rejected', order.id]);
  res.json({ ok: true, status: approve ? 'paid' : 'rejected' });
}));

/* ---------------- chat ---------------- */

function projectLine(p) {
  return p.price > 0 ? `${p.title} — Rs ${p.price} (premium)` : `${p.title} — free`;
}

async function botReply(text, name) {
  const t = text.toLowerCase();
  const s = await getSettings(false);
  const site = s.site_name || 'Ayush';
  const { rows: projects } = await pool.query('SELECT id, title, price, category FROM projects ORDER BY created_at DESC');
  const freeList = projects.filter((p) => p.price === 0);
  const paidList = projects.filter((p) => p.price > 0);
  const email = s.email || '';
  const has = (...words) => words.some((w) => t.includes(w));

  if (has('help', 'menu', 'options', 'kya kar sakte')) {
    return 'I can help with: projects & prices, free downloads, UPI payments, login, contact, custom work. Just ask!';
  }
  if (has('hi', 'hello', 'hey', 'hii', 'heyy', 'yo', 'sup', 'namaste', 'salaam', 'good morning', 'good evening', 'good afternoon', 'hola')) {
    const picks = projects.slice(0, 3);
    const lines = picks.map(projectLine).join(', ') || 'nothing yet';
    return `Hey ${name}! Welcome to ${site}. I'm the auto assistant. We have ${projects.length} projects right now: ${lines}. Ask me about prices, downloads or payments.`;
  }
  if (has('price', 'cost', 'rate', 'kitna', 'charge', 'price list', 'pricing')) {
    let out = `Here is the price list:\n`;
    out += projects.length ? projects.map((p) => `- ${projectLine(p)}`).join('\n') : '- No projects uploaded yet';
    if (freeList.length) out += `\n\nFree projects unlock instantly after login. Premium ones unlock right after UPI payment is verified.`;
    return out;
  }
  if (has('free', 'download', 'mila', 'access', 'src', 'source', 'code', 'file')) {
    let out = 'Free projects download instantly when you log in. Premium projects unlock after payment is verified — you get the full source code.\n\n';
    if (freeList.length) out += 'Free right now: ' + freeList.map(projectLine).join(', ') + '.';
    return out;
  }
  if (has('upi', 'pay', 'payment', 'utr', 'buy', 'purchase', 'order', 'buying')) {
    return 'Payment is simple: click Buy on a premium project, pay to my UPI ID from FamPay / GPay / PhonePe (QR + app button shown), then enter the 12-digit UTR number. I check it and unlock the download — usually within minutes. Log in to get started.';
  }
  if (has('login', 'log in', 'sign in', 'account', 'register', 'sign up', 'join')) {
    return 'Use the Login / Sign up buttons at the top. After buying, your purchases appear under My Account.';
  }
  if (has('custom', 'hire', 'work', 'freelance', 'build', 'develop', 'request')) {
    return email ? `I take custom work! Email me at ${email} or keep chatting here with details of what you need built.` : 'I take custom work — send me the details here and I will get back to you.';
  }
  if (has('contact', 'email', 'mail', 'insta', 'instagram', 'telegram', 'discord id', 'social')) {
    return email ? `You can reach me at ${email}. Business inquiries welcome!` : 'Drop your message here — I reply as soon as I see it.';
  }
  if (has('nuker', 'nuke', 'bot', 'discord')) {
    const disc = projects.filter((p) => (p.title + ' ' + p.category).toLowerCase().includes('discord'));
    if (disc.length) return 'Discord stuff: ' + disc.map(projectLine).join(', ') + '. Open them in the store for full details.';
    return 'I do not have any Discord projects uploaded yet — check back soon!';
  }
  const hit = projects.find((p) => {
    const words = p.title.toLowerCase().split(/\s+/);
    return words.some((w) => w.length > 3 && t.includes(w));
  });
  if (hit) {
    return `Found it: ${projectLine(hit)}. Log in and grab it from the store — ${hit.price > 0 ? 'pay via UPI and it unlocks instantly.' : 'it downloads instantly.'}`;
  }
  return 'I am not sure about that one. Try asking about projects, prices, downloads, payments (UPI), login, or custom work.';
}

app.get('/api/messages', h(async (req, res) => {
  const after = Number(req.query.after) || 0;
  const { rows } = await pool.query('SELECT * FROM messages WHERE id > $1 ORDER BY id ASC LIMIT 200', [after]);
  res.json(rows);
}));

app.post('/api/messages', h(async (req, res) => {
  const name = String(req.body.name || 'Guest').trim().slice(0, 60);
  const text = String(req.body.text || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Message is empty' });
  const inserted = await pool.query("INSERT INTO messages (name, role, text, is_bot) VALUES ($1, 'user', $2, 0) RETURNING *", [name, text]);
  const msg = inserted.rows[0];
  const reply = await botReply(text, name || 'friend');
  await pool.query("INSERT INTO messages (name, role, text, is_bot) VALUES ('Bot', 'admin', $1, 1)", [reply]);
  res.json(msg);
}));

/* ---------------- admin ---------------- */

app.get('/api/admin/stats', requireAdmin, h(async (req, res) => {
  const projects = await pool.query('SELECT COUNT(*)::int AS n FROM projects');
  const members = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'user'");
  const paidOrders = await pool.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::int AS total FROM orders WHERE status = 'paid'");
  const messages = await pool.query('SELECT COUNT(*)::int AS n FROM messages');
  res.json({ projects: projects.rows[0].n, members: members.rows[0].n, orders: paidOrders.rows[0].n, revenue: paidOrders.rows[0].total, messages: messages.rows[0].n });
}));

app.post('/api/admin/projects', requireAdmin, (req, res) => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }
  }).fields([{ name: 'file', maxCount: 1 }, { name: 'image', maxCount: 1 }]);

  upload(req, res, async (err) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large — max 100 MB. Bade files ke liye storage upgrade chahiye.' });
        return res.status(400).json({ error: err.message });
      }
      const file = req.files && req.files.file && req.files.file[0];
      if (!file) return res.status(400).json({ error: 'No file uploaded' });
      let image = null;
      const img = req.files && req.files.image && req.files.image[0];
      if (img) {
        if (img.size > 2 * 1024 * 1024) return res.status(400).json({ error: 'Image must be under 2 MB' });
        image = `data:${img.mimetype};base64,${img.buffer.toString('base64')}`;
      }
      const title = String(req.body.title || '').trim().slice(0, 100);
      const description = String(req.body.description || '').trim().slice(0, 3000);
      const price = Math.max(0, Math.round(Number(req.body.price) || 0));
      const category = String(req.body.category || 'web').trim().slice(0, 40);
      const tags = String(req.body.tags || '').trim().slice(0, 200);
      if (!title || !description) return res.status(400).json({ error: 'Title and description are required' });
      const inserted = await pool.query(
        'INSERT INTO projects (title, description, price, category, tags, filename, original_name, size, file_data, image) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
        [title, description, price, category, tags, file.originalname || 'file', file.originalname, file.size, file.buffer, image]
      );
      res.json({ ok: true, id: Number(inserted.rows[0].id) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

app.delete('/api/admin/projects/:id', requireAdmin, h(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'Project not found' });
  await pool.query('DELETE FROM projects WHERE id = $1', [rows[0].id]);
  res.json({ ok: true });
}));

app.get('/api/admin/orders', requireAdmin, h(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT o.*, p.title AS project_title, u.name AS user_name, u.email AS user_email
    FROM orders o JOIN projects p ON p.id = o.project_id JOIN users u ON u.id = o.user_id
    ORDER BY o.id DESC LIMIT 200
  `);
  res.json(rows);
}));

app.get('/api/admin/members', requireAdmin, h(async (req, res) => {
  const { rows } = await pool.query("SELECT id, name, email, created_at FROM users WHERE role = 'user' ORDER BY id DESC LIMIT 200");
  res.json(rows);
}));

app.post('/api/admin/messages', requireAdmin, h(async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Message is empty' });
  const inserted = await pool.query("INSERT INTO messages (name, role, text) VALUES ('Ayush', 'admin', $1) RETURNING *", [text]);
  res.json(inserted.rows[0]);
}));

app.put('/api/admin/settings', requireAdmin, h(async (req, res) => {
  const allowed = ['site_name', 'tagline', 'bio', 'email', 'github', 'linkedin', 'x', 'instagram', 'hero_words', 'upi_id', 'upi_name', 'upi_qr'];
  for (const key of allowed) {
    if (typeof req.body[key] === 'string' || Array.isArray(req.body[key])) {
      const value = Array.isArray(req.body[key]) ? JSON.stringify(req.body[key]) : req.body[key].slice(0, key === 'upi_qr' ? 1000000 : 3000);
      await pool.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, value]
      );
    }
  }
  res.json({ ok: true });
}));

/* ---------------- static ---------------- */

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || err.statusCode || 500).json({ error: err.type === 'entity.parse.failed' ? 'Invalid JSON body' : (err.message || 'Server error') });
});

initDb().then(async () => {
  await seedDefaults();
  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  Ayush project store running:');
    console.log(`  -> http://localhost:${PORT}`);
    console.log(`  -> Admin panel: http://localhost:${PORT}/#/admin`);
    console.log('');
  });
  const shutdown = () => {
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}).catch((err) => {
  console.error('Failed to init database:', err.message);
  process.exit(1);
});
