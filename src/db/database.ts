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

  CREATE TABLE IF NOT EXISTS bug_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_email TEXT NOT NULL,
    error_text TEXT NOT NULL,
    image_base64 TEXT,
    status TEXT NOT NULL DEFAULT 'todo'
      CHECK(status IN ('todo','inprogress','pr-raised','verify','blocked','fixed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
  CREATE INDEX IF NOT EXISTS idx_bug_reports_reporter ON bug_reports(reporter_email);
`);

// Migrate existing users table: add new columns if they don't exist
// SQLite supports ALTER TABLE ADD COLUMN safely on existing tables
try { db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN monthly_downloads INTEGER NOT NULL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN month_reset_at INTEGER NOT NULL DEFAULT 0`); } catch {}

// --- User helpers ---

export type UserRole = 'admin' | 'owner' | 'tester' | 'user';

export interface DbUser {
  email: string;
  password: string;
  created_at: number;
  role: UserRole;
  is_blocked: number;
  monthly_downloads: number;
  month_reset_at: number;
}

const stmtGetUser = db.prepare('SELECT * FROM users WHERE email = ?');
const stmtCreateUser = db.prepare(
  `INSERT INTO users (email, password, created_at, role, is_blocked, monthly_downloads, month_reset_at)
   VALUES (?, ?, ?, ?, 0, 0, 0)`
);

export function getUser(email: string): DbUser | undefined {
  return stmtGetUser.get(email) as DbUser | undefined;
}

export function createUser(email: string, passwordHash: string, role: UserRole = 'user'): void {
  stmtCreateUser.run(email, passwordHash, Date.now(), role);
}

export function userExists(email: string): boolean {
  return getUser(email) !== undefined;
}

export function setUserRole(email: string, role: UserRole): void {
  db.prepare('UPDATE users SET role = ? WHERE email = ?').run(role, email);
}

export function setUserBlocked(email: string, blocked: boolean): void {
  db.prepare('UPDATE users SET is_blocked = ? WHERE email = ?').run(blocked ? 1 : 0, email);
}

export function deleteUser(email: string): void {
  db.prepare('DELETE FROM users WHERE email = ?').run(email);
}

export function getAllUsers(): Omit<DbUser, 'password'>[] {
  return db.prepare(
    'SELECT email, created_at, role, is_blocked, monthly_downloads, month_reset_at FROM users ORDER BY created_at DESC'
  ).all() as Omit<DbUser, 'password'>[];
}

export function incrementMonthlyDownloads(email: string): void {
  db.prepare('UPDATE users SET monthly_downloads = monthly_downloads + 1 WHERE email = ?').run(email);
}

export function resetMonthlyDownloadsIfNeeded(email: string): void {
  const user = getUser(email);
  if (!user) return;
  const now = new Date();
  const resetDate = new Date(user.month_reset_at);
  if (
    user.month_reset_at === 0 ||
    resetDate.getMonth() !== now.getMonth() ||
    resetDate.getFullYear() !== now.getFullYear()
  ) {
    db.prepare('UPDATE users SET monthly_downloads = 0, month_reset_at = ? WHERE email = ?').run(
      Date.now(),
      email
    );
  }
}

export function getMonthlyDownloadCount(email: string): number {
  const user = getUser(email);
  return user?.monthly_downloads ?? 0;
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

// --- DB stats helper ---

export interface DbStats {
  users: number;
  downloads: number;
  bugReports: number;
  guestDownloads: number;
}

export function getDbStats(): DbStats {
  const users = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
  const downloads = (db.prepare('SELECT COUNT(*) AS count FROM downloads').get() as { count: number }).count;
  const bugReports = (db.prepare('SELECT COUNT(*) AS count FROM bug_reports').get() as { count: number }).count;
  const guestDownloads = (db.prepare('SELECT COUNT(*) AS count FROM guest_downloads').get() as { count: number }).count;
  return { users, downloads, bugReports, guestDownloads };
}

export function clearDownloadLogs(): void {
  db.exec('DELETE FROM downloads; DELETE FROM guest_downloads;');
}

// --- Bug report helpers ---

export type BugStatus = 'todo' | 'inprogress' | 'pr-raised' | 'verify' | 'blocked' | 'fixed';

export interface DbBugReport {
  id: number;
  reporter_email: string;
  error_text: string;
  image_base64: string | null;
  status: BugStatus;
  created_at: number;
  updated_at: number;
}

export function createBugReport(
  reporterEmail: string,
  errorText: string,
  imageBase64?: string
): number {
  const now = Date.now();
  const result = db.prepare(
    `INSERT INTO bug_reports (reporter_email, error_text, image_base64, status, created_at, updated_at)
     VALUES (?, ?, ?, 'todo', ?, ?)`
  ).run(reporterEmail, errorText, imageBase64 ?? null, now, now);
  return result.lastInsertRowid as number;
}

export function getAllBugReports(): DbBugReport[] {
  return db.prepare(
    'SELECT * FROM bug_reports ORDER BY created_at DESC'
  ).all() as DbBugReport[];
}

export function updateBugStatus(id: number, status: BugStatus): void {
  db.prepare('UPDATE bug_reports SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    Date.now(),
    id
  );
}

// Graceful shutdown
export function closeDatabase(): void {
  db.close();
}

export default db;
