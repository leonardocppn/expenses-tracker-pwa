-- Life Tracker — D1 (SQLite) schema
-- Run with: wrangler d1 execute your-tracker-db --file=schema.sql

CREATE TABLE IF NOT EXISTS expenses (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT    NOT NULL,
  macro    TEXT    NOT NULL,
  amount   REAL    NOT NULL,
  note     TEXT,
  date     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS mood (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  value INTEGER NOT NULL,
  note  TEXT,
  date  TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS sleep (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  bedtime   TEXT,
  wake_time TEXT,
  date      TEXT,
  hours     REAL
);
