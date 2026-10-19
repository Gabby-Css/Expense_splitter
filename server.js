// server.js - API for the expense splitter.
// Load settings (PORT, passwords...) from the private .env file before anything else reads them.
// On a host like Render there is no .env file: the host's own environment variables are used instead.
require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { splitEvenly, calculateBalances, suggestPayments } = require('./split');

const PORT = process.env.PORT || 3000;
const CURRENCIES = ['GHS', 'USD', 'EUR', 'GBP', 'NGN', 'KES', 'ZAR', 'CAD', 'INR'];
const MAX_MEMBERS = 20;
const MAX_CENTS = 1_000_000_000; // 10 million in the group's currency is plenty

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => { req.body ??= {}; next(); });

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const cleanName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(str) {
  if (typeof str !== 'string' || !ISO_DATE.test(str)) return false;
  const d = new Date(str + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

// "12.50" or 12.5 -> 1250 cents. Rejects anything that isn't a sensible positive amount.
function toCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new HttpError(400, 'Enter an amount greater than zero.');
  const cents = Math.round(number * 100);
  if (cents < 1 || cents > MAX_CENTS) throw new HttpError(400, 'That amount is outside the allowed range.');
  return cents;
}

// Stops one visitor from creating thousands of groups.
function rateLimit(max, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt < now) hits.delete(key);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip) || { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    hits.set(req.ip, entry);
    if (entry.count > max) return next(new HttpError(429, 'Slow down a little and try again soon.'));
    next();
  };
}

function getGroupOr404(id) {
  const group = db.prepare('SELECT id, name, currency FROM groups WHERE id = ?').get(id);
  if (!group) throw new HttpError(404, 'We could not find that group. Check the link?');
  return group;
}

function getMemberIds(groupId) {
  return db.prepare('SELECT id FROM members WHERE group_id = ?').all(groupId).map((m) => m.id);
}

// Builds everything the group page needs in one go, including the maths.
function buildGroupPayload(groupId) {
  const group = getGroupOr404(groupId);
  const members = db.prepare('SELECT id, name FROM members WHERE group_id = ? ORDER BY id').all(groupId);

  const expenses = db.prepare(`
    SELECT id, description, amount_cents, paid_by, date, created_at
    FROM expenses WHERE group_id = ? ORDER BY date DESC, id DESC
  `).all(groupId);
  const shareRows = db.prepare(`
    SELECT s.expense_id, s.member_id, s.share_cents
    FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
    WHERE e.group_id = ?
  `).all(groupId);
  for (const e of expenses) e.shares = [];
  const byId = new Map(expenses.map((e) => [e.id, e]));
  for (const row of shareRows) byId.get(row.expense_id).shares.push({ member_id: row.member_id, share_cents: row.share_cents });

  const settlements = db.prepare(`
    SELECT id, from_member, to_member, amount_cents, date, created_at
    FROM settlements WHERE group_id = ? ORDER BY date DESC, id DESC
  `).all(groupId);

  const balance = calculateBalances(members.map((m) => m.id), expenses, settlements);

  return {
    group,
    members,
    expenses,
    settlements,
    totalSpent: expenses.reduce((sum, e) => sum + e.amount_cents, 0),
    balances: Object.fromEntries(balance),
    payments: suggestPayments(balance),
  };
}

// ---------- routes ----------

app.get('/api/config', (req, res) => res.json({ currencies: CURRENCIES, maxMembers: MAX_MEMBERS }));

app.post('/api/groups', rateLimit(20, 60 * 60 * 1000), (req, res) => {
  const name = cleanName(req.body.name);
  const currency = CURRENCIES.includes(req.body.currency) ? req.body.currency : 'GHS';
  if (!name || name.length > 60) throw new HttpError(400, 'Give the group a name (up to 60 characters).');

  // case-insensitive de-duplication, keeping the first spelling we see
  const seen = new Set();
  const names = [];
  for (const raw of Array.isArray(req.body.members) ? req.body.members : []) {
    const n = cleanName(raw);
    if (!n || n.length > 30 || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    names.push(n);
  }
  if (names.length < 2) throw new HttpError(400, 'Add at least two different people.');
  if (names.length > MAX_MEMBERS) throw new HttpError(400, `A group can have up to ${MAX_MEMBERS} people.`);

  const id = crypto.randomBytes(6).toString('base64url');
  db.transaction(() => {
    db.prepare('INSERT INTO groups (id, name, currency, created_at) VALUES (?, ?, ?, ?)').run(id, name, currency, Date.now());
    const insert = db.prepare('INSERT INTO members (group_id, name) VALUES (?, ?)');
    for (const n of names) insert.run(id, n);
  })();

  res.status(201).json({ id });
});

app.get('/api/groups/:id', (req, res) => res.json(buildGroupPayload(req.params.id)));

app.post('/api/groups/:id/members', (req, res) => {
  const group = getGroupOr404(req.params.id);
  const name = cleanName(req.body.name);
  if (!name || name.length > 30) throw new HttpError(400, 'Names must be 1 to 30 characters.');
  if (getMemberIds(group.id).length >= MAX_MEMBERS) throw new HttpError(400, `A group can have up to ${MAX_MEMBERS} people.`);

  try {
    db.prepare('INSERT INTO members (group_id, name) VALUES (?, ?)').run(group.id, name);
  } catch (err) {
    if (String(err.code).startsWith('SQLITE_CONSTRAINT')) throw new HttpError(409, `${name} is already in this group.`);
    throw err;
  }
  res.status(201).json({ ok: true });
});

app.post('/api/groups/:id/expenses', (req, res) => {
  const group = getGroupOr404(req.params.id);
  const memberIds = getMemberIds(group.id);

  const description = cleanName(req.body.description);
  if (!description || description.length > 80) throw new HttpError(400, 'Describe the expense (up to 80 characters).');
  const cents = toCents(req.body.amount);
  const paidBy = Number(req.body.paid_by);
  if (!memberIds.includes(paidBy)) throw new HttpError(400, 'Pick who paid.');
  if (!validDate(req.body.date)) throw new HttpError(400, 'Pick a valid date.');

  // keep only real members, remove duplicates, and sort so leftover cents are handed out predictably
  const participants = [...new Set((Array.isArray(req.body.participants) ? req.body.participants : []).map(Number))]
    .filter((id) => memberIds.includes(id))
    .sort((a, b) => a - b);
  if (participants.length === 0) throw new HttpError(400, 'Choose at least one person to split with.');

  const shares = splitEvenly(cents, participants);
  db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO expenses (group_id, description, amount_cents, paid_by, date, created_at) VALUES (?, ?, ?, ?, ?, ?)
    `).run(group.id, description, cents, paidBy, req.body.date, Date.now());
    const insertShare = db.prepare('INSERT INTO expense_shares (expense_id, member_id, share_cents) VALUES (?, ?, ?)');
    for (const s of shares) insertShare.run(info.lastInsertRowid, s.memberId, s.cents);
  })();

  res.status(201).json({ ok: true });
});

app.delete('/api/groups/:id/expenses/:expenseId', (req, res) => {
  const group = getGroupOr404(req.params.id);
  const info = db.prepare('DELETE FROM expenses WHERE id = ? AND group_id = ?').run(req.params.expenseId, group.id);
  if (info.changes === 0) throw new HttpError(404, 'That expense is already gone.');
  res.json({ ok: true });
});

app.post('/api/groups/:id/settlements', (req, res) => {
  const group = getGroupOr404(req.params.id);
  const memberIds = getMemberIds(group.id);
  const from = Number(req.body.from);
  const to = Number(req.body.to);
  if (!memberIds.includes(from) || !memberIds.includes(to) || from === to) throw new HttpError(400, 'Pick two different people.');
  const cents = toCents(req.body.amount);
  const date = validDate(req.body.date) ? req.body.date : new Date().toISOString().slice(0, 10);

  db.prepare('INSERT INTO settlements (group_id, from_member, to_member, amount_cents, date, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(group.id, from, to, cents, date, Date.now());
  res.status(201).json({ ok: true });
});

app.delete('/api/groups/:id/settlements/:settlementId', (req, res) => {
  const group = getGroupOr404(req.params.id);
  const info = db.prepare('DELETE FROM settlements WHERE id = ? AND group_id = ?').run(req.params.settlementId, group.id);
  if (info.changes === 0) throw new HttpError(404, 'That payment is already gone.');
  res.json({ ok: true });
});

// ---------- static files + errors ----------

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

app.listen(PORT, () => console.log(`Expense splitter running at http://localhost:${PORT}`));
