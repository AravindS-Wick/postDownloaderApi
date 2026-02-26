import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename_db = fileURLToPath(import.meta.url);
const __dirname_db = path.dirname(__filename_db);
// Use DATA_DIR env var when deployed (e.g. Fly.io persistent volume at /data)
// Falls back to the local db/ directory for development
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname_db, '../..');
const DB_PATH = path.join(DATA_DIR, 'db', 'app.db');

// Ensure the db directory exists
import fs from 'fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

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

  CREATE TABLE IF NOT EXISTS guest_downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_guest_downloads_ip ON guest_downloads(ip);
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

// --- Guest download helpers (freemium tracking) ---

const stmtCountGuestDownloads = db.prepare(
  'SELECT COUNT(*) AS count FROM guest_downloads WHERE ip = ?'
);
const stmtLogGuestDownload = db.prepare(
  'INSERT INTO guest_downloads (ip, created_at) VALUES (?, ?)'
);

export function getGuestDownloadCount(ip: string): number {
  const row = stmtCountGuestDownloads.get(ip) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function logGuestDownload(ip: string): void {
  stmtLogGuestDownload.run(ip, Date.now());
}

// Graceful shutdown
export function closeDatabase(): void {
  db.close();
}

export default db;
