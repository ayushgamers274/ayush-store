const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');

for (const dir of [UPLOAD_DIR, DATA_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const env = {};
if (fs.existsSync(path.join(__dirname, '.env'))) {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'web',
    tags TEXT NOT NULL DEFAULT '',
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    downloads INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    razorpay_order_id TEXT,
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'created',
    payment_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    text TEXT NOT NULL,
    is_bot INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
try { db.exec('ALTER TABLE messages ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0'); } catch (e) {}

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
  upi_name: 'Ayush'
};
{
  const stmt = db.prepare('SELECT COUNT(*) AS n FROM settings');
  if (stmt.get().n === 0) {
    const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  }
}
function getSettings(includeSecrets) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  rows.forEach((r) => {
    if (!includeSecrets && r.key === 'upi_id') return;
    s[r.key] = r.value;
  });
  if (!includeSecrets) delete s.upi_id;
  return s;
}

{
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'admin')").run('Ayush', 'admin@ayush.dev', hash);
    console.log('  Admin account created: admin@ayush.dev / admin123');
  }
}
const app = express();
app.use(express.json({ limit: '1mb' }));

function cookieToken(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(/(?:^|;\s*)token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function getUserByToken(req) {
  const token = cookieToken(req);
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token) || null;
}

function requireAuth(req, res, next) {
  const user = getUserByToken(req);
  if (!user) return res.status(401).json({ error: 'Please log in first' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getUserByToken(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  req.user = user;
  next();
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
    created_at: row.created_at
  };
}

/* ---------------- auth ---------------- */

app.post('/api/register', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
  const password = String(req.body.password || '');
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)').run(name, email, hash);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, Number(info.lastInsertRowid));
  setTokenCookie(res, token);
  res.json({ user: { id: Number(info.lastInsertRowid), name, email, role: 'user' } });
});

app.post('/api/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  setTokenCookie(res, token);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post('/api/logout', (req, res) => {
  const token = cookieToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'token=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = getUserByToken(req);
  if (!user) return res.json({ user: null });
  res.json({ user });
});

/* ---------------- public ---------------- */

app.get('/api/settings', (req, res) => {
  const s = getSettings(false);
  s.hero_words = JSON.parse(s.hero_words || '[]');
  res.json(s);
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const s = getSettings(true);
  s.hero_words = JSON.parse(s.hero_words || '[]');
  res.json(s);
});

app.get('/api/projects', (req, res) => {
  const rows = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json(rows.map(publicProject));
});

app.get('/api/projects/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Project not found' });
  res.json(publicProject(row));
});

app.get('/api/me/owned', requireAuth, (req, res) => {
  const rows = db.prepare("SELECT project_id FROM orders WHERE user_id = ? AND status = 'paid'").all(req.user.id);
  res.json(rows.map((r) => r.project_id));
});

app.get('/api/me/orders', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT o.id, o.project_id, o.amount, o.currency, o.status, o.payment_id, o.created_at, p.title, p.price AS project_price, p.category
    FROM orders o JOIN projects p ON p.id = o.project_id
    WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 100
  `).all(req.user.id);
  res.json(rows);
});

app.get('/api/admin/payments/status', requireAdmin, (req, res) => {
  const s = getSettings(true);
  const upiId = (s.upi_id || '').trim();
  res.json({ configured: !!upiId, upiId });
});

/* ---------------- downloads ---------------- */

app.get('/api/download/:id', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.price > 0) {
    const paid = db.prepare("SELECT id FROM orders WHERE project_id = ? AND user_id = ? AND status = 'paid'").get(project.id, req.user.id);
    if (!paid) return res.status(403).json({ error: 'You need to buy this project first' });
  }
  const filePath = path.join(UPLOAD_DIR, project.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on server' });
  db.prepare('UPDATE projects SET downloads = downloads + 1 WHERE id = ?').run(project.id);
  res.download(filePath, project.original_name);
});

/* ---------------- payments (UPI via FamPay / any UPI app) ---------------- */

app.post('/api/orders', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.body.projectId));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (project.price <= 0) return res.status(400).json({ error: 'This project is free — just download it' });
  const existing = db.prepare("SELECT id FROM orders WHERE project_id = ? AND user_id = ? AND status = 'paid'").get(project.id, req.user.id);
  if (existing) return res.json({ alreadyOwned: true });
  const pending = db.prepare("SELECT id FROM orders WHERE project_id = ? AND user_id = ? AND status IN ('created','verify')").get(project.id, req.user.id);
  if (pending) return res.json({ alreadyPending: true });

  const s = getSettings(true);
  const upiId = (s.upi_id || '').trim();
  if (!upiId) return res.status(400).json({ error: 'Store owner has not set up UPI yet — message them in the chat' });

  const info = db.prepare("INSERT INTO orders (project_id, user_id, amount, currency, status) VALUES (?, ?, ?, 'INR', 'created')").run(project.id, req.user.id, project.price);
  res.json({
    orderId: Number(info.lastInsertRowid),
    amount: project.price,
    projectTitle: project.title,
    upi: { id: upiId, name: s.upi_name || '', orderId: Number(info.lastInsertRowid) }
  });
});

app.post('/api/orders/verify', requireAuth, (req, res) => {
  const { orderId, utr } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(orderId));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.user_id !== req.user.id) return res.status(403).json({ error: 'Not your order' });
  if (order.status === 'paid') return res.json({ ok: true, alreadyOwned: true });
  const ref = String(utr || '').trim().slice(0, 80);
  if (!/^\d{10,16}$/.test(ref)) return res.status(400).json({ error: 'Invalid UTR — enter the 10-16 digit transaction number from your UPI app' });
  const usedElsewhere = db.prepare("SELECT id FROM orders WHERE payment_id = ? AND id != ? AND status != 'rejected'").get(ref, order.id);
  if (usedElsewhere) return res.status(400).json({ error: 'This UTR is already used on another order' });
  db.prepare("UPDATE orders SET status = 'verify', payment_id = ? WHERE id = ?").run(ref, order.id);
  res.json({ ok: true, status: 'verify' });
});

app.post('/api/orders/approve', requireAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.body.orderId));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const approve = req.body.approve !== false;
  db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(approve ? 'paid' : 'rejected', order.id);
  res.json({ ok: true, status: approve ? 'paid' : 'rejected' });
});

/* ---------------- chat ---------------- */

function projectLine(p) {
  return p.price > 0 ? `${p.title} — Rs ${p.price} (premium)` : `${p.title} — free`;
}

function botReply(text, name) {
  const t = text.toLowerCase();
  const s = getSettings(false);
  const site = s.site_name || 'Ayush';
  const projects = db.prepare('SELECT id, title, price, category FROM projects ORDER BY created_at DESC').all();
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

app.get('/api/messages', (req, res) => {
  const after = Number(req.query.after) || 0;
  const rows = db.prepare('SELECT * FROM messages WHERE id > ? ORDER BY id ASC LIMIT 200').all(after);
  res.json(rows);
});

app.post('/api/messages', (req, res) => {
  const name = String(req.body.name || 'Guest').trim().slice(0, 60);
  const text = String(req.body.text || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Message is empty' });
  const info = db.prepare("INSERT INTO messages (name, role, text, is_bot) VALUES (?, 'user', ?, 0)").run(name, text);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(info.lastInsertRowid));
  const reply = botReply(text, name || 'friend');
  db.prepare("INSERT INTO messages (name, role, text, is_bot) VALUES (?, 'admin', ?, 1)").run('Bot', reply);
  res.json(msg);
});

/* ---------------- admin ---------------- */

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const projects = db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
  const members = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'user'").get().n;
  const paidOrders = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM orders WHERE status = 'paid'").get();
  const messages = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
  res.json({ projects, members, orders: paidOrders.n, revenue: paidOrders.total, messages });
});

app.post('/api/admin/projects', requireAdmin, (req, res) => {
  const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').replace(/[^.\w]/g, '').slice(0, 12);
      cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: 300 * 1024 * 1024 }
  }).single('file');

  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const title = String(req.body.title || '').trim().slice(0, 100);
    const description = String(req.body.description || '').trim().slice(0, 3000);
    const price = Math.max(0, Math.round(Number(req.body.price) || 0));
    const category = String(req.body.category || 'web').trim().slice(0, 40);
    const tags = String(req.body.tags || '').trim().slice(0, 200);
    if (!title || !description) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Title and description are required' });
    }
    const info = db.prepare('INSERT INTO projects (title, description, price, category, tags, filename, original_name, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(title, description, price, category, tags, req.file.filename, req.file.originalname, req.file.size);
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  });
});

app.delete('/api/admin/projects/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Project not found' });
  const filePath = path.join(UPLOAD_DIR, row.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM projects WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, p.title AS project_title, u.name AS user_name, u.email AS user_email
    FROM orders o JOIN projects p ON p.id = o.project_id JOIN users u ON u.id = o.user_id
    ORDER BY o.id DESC LIMIT 200
  `).all();
  res.json(rows);
});

app.get('/api/admin/members', requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT id, name, email, created_at FROM users WHERE role = 'user' ORDER BY id DESC LIMIT 200").all();
  res.json(rows);
});

app.post('/api/admin/messages', requireAdmin, (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Message is empty' });
  const info = db.prepare("INSERT INTO messages (name, role, text) VALUES (?, 'admin', ?)").run('Ayush', text);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(info.lastInsertRowid));
  res.json(msg);
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const allowed = ['site_name', 'tagline', 'bio', 'email', 'github', 'linkedin', 'x', 'instagram', 'hero_words', 'upi_id', 'upi_name'];
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const key of allowed) {
    if (typeof req.body[key] === 'string' || Array.isArray(req.body[key])) {
      stmt.run(key, Array.isArray(req.body[key]) ? JSON.stringify(req.body[key]) : req.body[key].slice(0, 3000));
    }
  }
  res.json({ ok: true });
});

/* ---------------- static ---------------- */

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || err.statusCode || 500).json({ error: err.type === 'entity.parse.failed' ? 'Invalid JSON body' : (err.message || 'Server error') });
});

const server = http.createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  Ayush project store running:');
  console.log(`  -> http://localhost:${PORT}`);
  console.log(`  -> Admin panel: http://localhost:${PORT}/#/admin`);
  console.log('  Admin login: admin@ayush.dev / admin123');
  console.log('');
});
