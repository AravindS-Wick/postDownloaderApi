import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename_db = fileURLToPath(import.meta.url);
const __dirname_db = path.dirname(__filename_db);
const DB_PATH = path.join(__dirname_db, '../../db/app.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('attempt', 'complete', 'consent')),
    meta TEXT,
    age_consent INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_downloads_user_email ON downloads(user_email);
  CREATE INDEX IF NOT EXISTS idx_downloads_created_at ON downloads(created_at DESC);
`);

// --- User helpers ---

export interface DbUser {
  email: string;
  password: string;
  created_at: number;
}

const stmtGetUser = db.prepare('SELECT email, password, created_at FROM users WHERE email = ?');
const stmtCreateUser = db.prepare('INSERT INTO users (email, password, created_at) VALUES (?, ?, ?)');

export function getUser(email: string): DbUser | undefined {
  return stmtGetUser.get(email) as DbUser | undefined;
}

export function createUser(email: string, passwordHash: string): void {
  stmtCreateUser.run(email, passwordHash, Date.now());
}

export function userExists(email: string): boolean {
  return getUser(email) !== undefined;
}

// --- Download helpers ---

export interface DbDownload {
  id: number;
  user_email: string | null;
  type: string;
  status: 'attempt' | 'complete' | 'consent';
  meta: string; // JSON string
  age_consent: number;
  created_at: number;
}

const stmtLogDownload = db.prepare(
  'INSERT INTO downloads (user_email, type, status, meta, age_consent, created_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const stmtGetUserDownloads = db.prepare(
  'SELECT * FROM downloads WHERE user_email = ? ORDER BY created_at DESC'
);
const stmtGetGuestDownloads = db.prepare(
  'SELECT * FROM downloads WHERE user_email IS NULL ORDER BY created_at DESC LIMIT ?'
);
const stmtDeleteUserDownloads = db.prepare(
  'DELETE FROM downloads WHERE user_email = ?'
);

export function logDownload(entry: {
  userEmail: string | null;
  type: string;
  status: string;
  meta: any;
  ageConsent: boolean;
}): void {
  stmtLogDownload.run(
    entry.userEmail,
    entry.type,
    entry.status,
    JSON.stringify(entry.meta ?? {}),
    entry.ageConsent ? 1 : 0,
    Date.now()
  );
}

export function getUserDownloads(email: string): DbDownload[] {
  return stmtGetUserDownloads.all(email) as DbDownload[];
}

export function getGuestDownloads(limit = 1000): DbDownload[] {
  return stmtGetGuestDownloads.all(limit) as DbDownload[];
}

export function deleteUserDownloads(email: string): void {
  stmtDeleteUserDownloads.run(email);
}

// Graceful shutdown
export function closeDatabase(): void {
  db.close();
}

export default db;
