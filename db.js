// db.js - SQLite setup for the expense splitter.
// Money is always stored as whole cents (integers). Floating point numbers
// can't represent 0.10 exactly, which would slowly corrupt balances.
const Database = require('better-sqlite3');
const path = require('path');

const dataDir = process.env.DATA_DIR || __dirname;
const db = new Database(path.join(dataDir, 'splitter.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id         TEXT PRIMARY KEY,                 -- random, hard-to-guess id used in the share link
    name       TEXT NOT NULL,
    currency   TEXT NOT NULL DEFAULT 'GHS',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS members (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name     TEXT NOT NULL COLLATE NOCASE,
    UNIQUE (group_id, name)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    description  TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    paid_by      INTEGER NOT NULL REFERENCES members(id),
    date         TEXT NOT NULL,
    created_at   INTEGER NOT NULL
  );

  -- How much of each expense every person is responsible for.
  CREATE TABLE IF NOT EXISTS expense_shares (
    expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    member_id   INTEGER NOT NULL REFERENCES members(id),
    share_cents INTEGER NOT NULL,
    PRIMARY KEY (expense_id, member_id)
  );

  -- "Ama paid Kofi back 20.00"
  CREATE TABLE IF NOT EXISTS settlements (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    from_member  INTEGER NOT NULL REFERENCES members(id),
    to_member    INTEGER NOT NULL REFERENCES members(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    date         TEXT NOT NULL,
    created_at   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses (group_id);
  CREATE INDEX IF NOT EXISTS idx_settlements_group ON settlements (group_id);
`);

module.exports = db;
