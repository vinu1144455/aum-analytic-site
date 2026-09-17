const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const rawPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'aum.db');
const DB_PATH = path.isAbsolute(rawPath) ? rawPath : path.resolve(__dirname, '..', rawPath);

// Make sure the folder that will hold the database file exists.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS requirements (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name           TEXT NOT NULL,
    company_name        TEXT NOT NULL,
    email               TEXT NOT NULL,
    phone               TEXT NOT NULL,
    industry            TEXT,
    service_required    TEXT,
    number_of_positions INTEGER,
    job_details         TEXT,
    file_path            TEXT,
    file_original_name   TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
