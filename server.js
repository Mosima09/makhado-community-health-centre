'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'makhado.db');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@makhado.local').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'ChangeMe-Clinic-2026!');
const sessions = new Map();
const loginAttempts = new Map();
const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'patient', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS appointments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT NOT NULL, contact_method TEXT NOT NULL,
 contact_value TEXT NOT NULL, appointment_date TEXT NOT NULL, service TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'Requested', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS contacts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, message TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS feedback (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, rating INTEGER NOT NULL, comment TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'New', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS staff_accounts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activity_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, event_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, user_name TEXT NOT NULL, record_type TEXT NOT NULL, record_id TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL DEFAULT ''
);`);
// Add booking references to databases created by earlier versions.
const appointmentColumns = db.prepare('PRAGMA table_info(appointments)').all().map(c => c.name);
if (!appointmentColumns.includes('booking_ref')) db.exec('ALTER TABLE appointments ADD COLUMN booking_ref TEXT');
// Backfill references for existing appointment rows.
for (const row of db.prepare("SELECT id FROM appointments WHERE booking_ref IS NULL OR booking_ref = ''").all()) {
  const ref = 'MHC-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare('UPDATE appointments SET booking_ref=? WHERE id=?').run(ref, row.id);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve({ hash: key.toString('hex'), salt })));
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function clean(v, max = 500) { return String(v ?? '').trim().slice(0, max); }
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 100; }
function parseCookies(req) {
  const out = {};
  for (const item of String(req.headers.cookie || '').split(';')) {
    const i = item.indexOf('='); if (i > 0) out[item.slice(0, i).trim()] = decodeURIComponent(item.slice(i + 1).trim());
  }
  return out;
}
function currentUser(req) { const sid = parseCookies(req).mhc_session; return sid ? sessions.get(sid) || null : null; }
function createSession(res, user) {
  const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid, { id: user.id, name: user.name, email: user.email, role: user.role });
  res.setHeader('Set-Cookie', `mhc_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
}
function clearSession(req, res) { const sid = parseCookies(req).mhc_session; if (sid) sessions.delete(sid); res.setHeader('Set-Cookie', 'mhc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); }
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function body(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw new Error('Request too large.'); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Invalid request data.'); }
}
function needUser(req, res, role) { const u = currentUser(req); if (!u || (role && u.role !== role)) { json(res, 401, { error: 'Please sign in with an authorised account.' }); return null; } return u; }
function audit(user, recordType, recordId, action, details = '') { db.prepare('INSERT INTO activity_log(user_name,record_type,record_id,action,details) VALUES(?,?,?,?,?)').run(user?.name || 'System', recordType, String(recordId), action, clean(details, 500)); }
async function ensureAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(ADMIN_EMAIL);
  if (!existing) {
    const p = await hashPassword(ADMIN_PASSWORD);
    db.prepare('INSERT INTO users(name,email,password_hash,salt,role) VALUES(?,?,?,?,?)').run('Clinic Administrator', ADMIN_EMAIL, p.hash, p.salt, 'admin');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, database: 'connected' });
    if (req.method === 'GET' && url.pathname === '/api/me') return json(res, 200, { user: currentUser(req) });
    if (req.method === 'POST' && url.pathname === '/api/register') {
      const b = await body(req); const name = clean(b.name, 80); const email = clean(b.email, 100).toLowerCase(); const password = String(b.password || '');
      if (name.length < 2 || !validEmail(email) || password.length < 10 || password.length > 200) return json(res, 400, { error: 'Enter a name, valid email and password of at least 10 characters.' });
      if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return json(res, 409, { error: 'An account with this email already exists.' });
      const p = await hashPassword(password);
      const result = db.prepare('INSERT INTO users(name,email,password_hash,salt,role) VALUES(?,?,?,?,?)').run(name, email, p.hash, p.salt, 'patient');
      return json(res, 201, { ok: true, id: Number(result.lastInsertRowid) });
    }
    if (req.method === 'POST' && (url.pathname === '/api/login' || url.pathname === '/api/admin/login')) {
      const b = await body(req); const email = clean(b.email, 100).toLowerCase(); const password = String(b.password || '');
      const ip = req.socket.remoteAddress || 'unknown'; const attempts = loginAttempts.get(ip) || { n: 0, at: Date.now() };
      if (Date.now() - attempts.at > 10 * 60 * 1000) { attempts.n = 0; attempts.at = Date.now(); }
      if (attempts.n >= 10) return json(res, 429, { error: 'Too many sign-in attempts. Wait 10 minutes and try again.' });
      const user = db.prepare('SELECT id,name,email,password_hash,salt,role FROM users WHERE email=?').get(email);
      let valid = false;
      if (user) { const p = await hashPassword(password, user.salt); valid = safeEqual(p.hash, user.password_hash); }
      if (!valid || (url.pathname === '/api/admin/login' && user.role !== 'admin')) { attempts.n++; attempts.at = Date.now(); loginAttempts.set(ip, attempts); return json(res, 401, { error: 'Email or password is incorrect.' }); }
      loginAttempts.delete(ip); createSession(res, user); return json(res, 200, { ok: true, user: { name: user.name, email: user.email, role: user.role } });
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') { clearSession(req, res); return json(res, 200, { ok: true }); }
    if (req.method === 'POST' && url.pathname === '/api/appointments') {
      const b = await body(req); const name = clean(b.name, 80), contactMethod = clean(b.contactMethod, 30), contactValue = clean(b.contactValue, 100), date = clean(b.date, 10), service = clean(b.service, 80), note = clean(b.note, 250);
      if (name.length < 2 || !contactValue || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !service) return json(res, 400, { error: 'Please complete the required appointment fields.' });
      if (date < new Date().toISOString().slice(0, 10)) return json(res, 400, { error: 'Please choose today or a future date.' });
      const user = currentUser(req);
      let bookingRef;
      do { bookingRef = 'MHC-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }
      while (db.prepare('SELECT id FROM appointments WHERE booking_ref=?').get(bookingRef));
      const r = db.prepare('INSERT INTO appointments(user_id,name,contact_method,contact_value,appointment_date,service,note,booking_ref) VALUES(?,?,?,?,?,?,?,?)').run(user?.id || null, name, contactMethod || 'Phone', contactValue, date, service, note, bookingRef);
      audit(user || { name: name + ' (patient)' }, 'Appointment', bookingRef, 'Appointment request created', `${name}; ${date}; ${service}; status Requested`);
      return json(res, 201, { ok: true, id: Number(r.lastInsertRowid), bookingReference: bookingRef, name, date, service, status: 'Requested' });
    }
    if (req.method === 'POST' && url.pathname === '/api/appointments/track') {
      const b = await body(req); const bookingRef = clean(b.bookingReference, 20).toUpperCase(); const contactValue = clean(b.contactValue, 100).toLowerCase();
      if (!/^MHC-[A-F0-9]{8}$/.test(bookingRef) || !contactValue) return json(res, 400, { error: 'Enter your booking reference and the contact detail used when booking.' });
      const appt = db.prepare('SELECT booking_ref AS bookingReference,name,contact_method AS contactMethod,contact_value AS contactValue,appointment_date AS date,service,status,created_at AS createdAt FROM appointments WHERE booking_ref=? AND lower(contact_value)=?').get(bookingRef, contactValue);
      if (!appt) return json(res, 404, { error: 'We could not find a matching appointment. Check the reference and contact detail and try again.' });
      return json(res, 200, { ok: true, appointment: appt });
    }
    if (req.method === 'POST' && url.pathname === '/api/contact') {
      const b = await body(req); const name = clean(b.name, 80), email = clean(b.email, 100).toLowerCase(), message = clean(b.message, 500);
      if (name.length < 2 || !validEmail(email) || message.length < 2) return json(res, 400, { error: 'Please complete all enquiry fields using a valid email address.' });
      const r = db.prepare('INSERT INTO contacts(name,email,message) VALUES(?,?,?)').run(name, email, message);
      return json(res, 201, { ok: true, id: Number(r.lastInsertRowid) });
    }
    if (req.method === 'POST' && url.pathname === '/api/feedback') {
      const b = await body(req); const name = clean(b.name, 80), category = clean(b.category, 60), rating = Number(b.rating), comment = clean(b.comment, 1000);
      if (!category || !Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length < 2) return json(res, 400, { error: 'Please select a category and rating and enter a comment.' });
      const user = currentUser(req);
      const r = db.prepare('INSERT INTO feedback(user_id,name,category,rating,comment) VALUES(?,?,?,?,?)').run(user?.id || null, name, category, rating, comment);
      audit(user || { name: name || 'Anonymous patient' }, 'Feedback', Number(r.lastInsertRowid), 'Feedback submitted', `${category}; rating ${rating}/5`);
      return json(res, 201, { ok: true, id: Number(r.lastInsertRowid), status: 'New' });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/data') {
      if (!needUser(req, res, 'admin')) return;
      const appointments = db.prepare('SELECT id,booking_ref AS bookingReference,name,contact_method AS contactMethod,contact_value AS contactValue,appointment_date AS date,service,note,status,created_at AS createdAt FROM appointments ORDER BY id DESC').all();
      const contacts = db.prepare('SELECT id,name,email,message,created_at AS createdAt FROM contacts ORDER BY id DESC').all();
      const feedback = db.prepare('SELECT id,name,category,rating,comment,status,created_at AS createdAt FROM feedback ORDER BY id DESC').all();
      const staff = db.prepare('SELECT id,name,role,status,created_at AS createdAt,updated_at AS updatedAt FROM staff_accounts ORDER BY id DESC').all();
      const activity = db.prepare('SELECT id,event_time AS time,user_name AS user,record_type AS recordType,record_id AS recordId,action,details FROM activity_log ORDER BY id DESC LIMIT 250').all();
      return json(res, 200, { appointments, contacts, feedback, staff, activity });
    }
    const feedbackMatch = url.pathname.match(/^\/api\/admin\/feedback\/(\d+)$/);
    if (req.method === 'PATCH' && feedbackMatch) {
      if (!needUser(req, res, 'admin')) return;
      const b = await body(req); const status = clean(b.status, 30);
      if (!['New','Reviewed','Action planned','Closed'].includes(status)) return json(res, 400, { error: 'Invalid feedback status.' });
      const user = needUser(req, res, 'admin'); if (!user) return;
      const previous = db.prepare('SELECT status FROM feedback WHERE id=?').get(Number(feedbackMatch[1]));
      const r = db.prepare('UPDATE feedback SET status=? WHERE id=?').run(status, Number(feedbackMatch[1]));
      if (!r.changes) return json(res, 404, { error: 'Feedback entry not found.' });
      if (previous.status !== status) audit(user, 'Feedback', feedbackMatch[1], 'Status changed', `${previous.status} → ${status}`);
      return json(res, 200, { ok: true });
    }
    const apptMatch = url.pathname.match(/^\/api\/admin\/appointments\/(\d+)$/);
    if (req.method === 'PATCH' && apptMatch) {
      if (!needUser(req, res, 'admin')) return;
      const b = await body(req); const status = clean(b.status, 20);
      if (!['Requested','Confirmed','Completed','Cancelled'].includes(status)) return json(res, 400, { error: 'Invalid appointment status.' });
      const user = needUser(req, res, 'admin'); if (!user) return;
      const previous = db.prepare('SELECT status,booking_ref FROM appointments WHERE id=?').get(Number(apptMatch[1]));
      const r = db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status, Number(apptMatch[1]));
      if (!r.changes) return json(res, 404, { error: 'Appointment not found.' });
      if (previous.status !== status) audit(user, 'Appointment', previous.booking_ref || apptMatch[1], 'Status changed', `${previous.status} → ${status}`);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/staff') {
      const user = needUser(req, res, 'admin'); if (!user) return;
      const b = await body(req); const name = clean(b.name, 80), role = clean(b.role, 60);
      if (name.length < 2 || !['Receptionist','Nurse','Doctor','Clinic Manager','Healthcare Assistant','Administrator','Other'].includes(role)) return json(res, 400, { error: 'Enter a staff name and choose a valid role.' });
      const r = db.prepare('INSERT INTO staff_accounts(name,role,status) VALUES(?,?,?)').run(name, role, 'Active');
      audit(user, 'Staff account', Number(r.lastInsertRowid), 'Staff account created', `${name} — ${role}; status Active`);
      return json(res, 201, { ok: true, id: Number(r.lastInsertRowid) });
    }
    const staffMatch = url.pathname.match(/^\/api\/admin\/staff\/(\d+)$/);
    if (req.method === 'PATCH' && staffMatch) {
      const user = needUser(req, res, 'admin'); if (!user) return;
      const b = await body(req); const status = clean(b.status, 20);
      if (!['Active','Inactive'].includes(status)) return json(res, 400, { error: 'Staff status must be Active or Inactive.' });
      const previous = db.prepare('SELECT name,role,status FROM staff_accounts WHERE id=?').get(Number(staffMatch[1]));
      if (!previous) return json(res, 404, { error: 'Staff account not found.' });
      db.prepare('UPDATE staff_accounts SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, Number(staffMatch[1]));
      if (previous.status !== status) audit(user, 'Staff account', staffMatch[1], 'Staff status changed', `${previous.name}: ${previous.status} → ${status}`);
      return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'API route not found.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
    const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.resolve(path.join(ROOT, 'public', requested.replace(/^\/+/, '')));
    if (!file.startsWith(path.resolve(path.join(ROOT, 'public')) + path.sep) && file !== path.resolve(path.join(ROOT, 'public', 'index.html'))) return json(res, 403, { error: 'Forbidden.' });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'Not found.' });
    const ext = path.extname(file); const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'same-origin', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: err.message === 'Request too large.' ? err.message : 'The server could not complete that request.' });
    else res.end();
  }
});

ensureAdmin().then(() => server.listen(PORT, HOST, () => {
  console.log('\nMakhado Community Health Centre website is running.');
  console.log(`Open: http://${HOST}:${PORT}`);
  console.log(`Admin email: ${ADMIN_EMAIL}`);
  console.log('University demonstration build: use fictional data only.\n');
})).catch(err => { console.error('Could not initialise database/admin account:', err); process.exit(1); });

process.on('SIGINT', () => { db.close(); process.exit(0); });
