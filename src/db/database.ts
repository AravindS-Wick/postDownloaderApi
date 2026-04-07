import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcryptjs from 'bcryptjs';
import type { UserRole } from '../types/auth.types.js';

const __filename_db = fileURLToPath(import.meta.url);
const __dirname_db = path.dirname(__filename_db);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname_db, '../..');
const DB_PATH = path.join(DATA_DIR, 'db', 'app.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    is_blocked INTEGER NOT NULL DEFAULT 0,
    monthly_downloads INTEGER NOT NULL DEFAULT 0,
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

// Migrate: add role/is_blocked/monthly_downloads columns to existing DBs that lack them
const existingCols = (db.pragma('table_info(users)') as any[]).map((c: any) => c.name);
if (!existingCols.includes('role')) {
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
}
if (!existingCols.includes('is_blocked')) {
  db.exec(`ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0`);
}
if (!existingCols.includes('monthly_downloads')) {
  db.exec(`ALTER TABLE users ADD COLUMN monthly_downloads INTEGER NOT NULL DEFAULT 0`);
}

// --- User helpers ---

export interface DbUser {
  email: string;
  password: string;
  role: UserRole;
  is_blocked: number;
  monthly_downloads: number;
  created_at: number;
}

const stmtGetUser     = db.prepare('SELECT * FROM users WHERE email = ?');
const stmtCreateUser  = db.prepare('INSERT INTO users (email, password, role, created_at) VALUES (?, ?, ?, ?)');
const stmtUpdateRole  = db.prepare('UPDATE users SET role = ? WHERE email = ?');
const stmtBlockUser   = db.prepare('UPDATE users SET is_blocked = ? WHERE email = ?');
const stmtListUsers   = db.prepare('SELECT email, role, is_blocked, monthly_downloads, created_at FROM users ORDER BY created_at DESC');

export function getUser(email: string): DbUser | undefined {
  return stmtGetUser.get(email) as DbUser | undefined;
}

export function createUser(email: string, passwordHash: string, role: UserRole = 'user'): void {
  stmtCreateUser.run(email, passwordHash, role, Date.now());
}

export function userExists(email: string): boolean {
  return getUser(email) !== undefined;
}

export function setUserRole(email: string, role: UserRole): void {
  stmtUpdateRole.run(role, email);
}

export function setUserBlocked(email: string, blocked: boolean): void {
  stmtBlockUser.run(blocked ? 1 : 0, email);
}

export function listAllUsers(): Omit<DbUser, 'password'>[] {
  return stmtListUsers.all() as Omit<DbUser, 'password'>[];
}

// --- Download helpers ---

export interface DbDownload {
  id: number;
  user_email: string | null;
  type: string;
  status: 'attempt' | 'complete' | 'consent';
  meta: string;
  age_consent: number;
  created_at: number;
}

const stmtLogDownload        = db.prepare('INSERT INTO downloads (user_email, type, status, meta, age_consent, created_at) VALUES (?, ?, ?, ?, ?, ?)');
const stmtGetUserDownloads   = db.prepare('SELECT * FROM downloads WHERE user_email = ? ORDER BY created_at DESC');
const stmtGetGuestDownloads  = db.prepare('SELECT * FROM downloads WHERE user_email IS NULL ORDER BY created_at DESC LIMIT ?');
const stmtDeleteUserDownloads = db.prepare('DELETE FROM downloads WHERE user_email = ?');
const stmtDeleteAllDownloads = db.prepare('DELETE FROM downloads');
const stmtCountDownloads     = db.prepare('SELECT COUNT(*) AS count FROM downloads');
const stmtCountUsers         = db.prepare('SELECT COUNT(*) AS count FROM users');
const stmtCountGuests        = db.prepare('SELECT COUNT(*) AS count FROM guest_downloads');

export function logDownload(entry: {
  userEmail: string | null;
  type: string;
  status: string;
  meta: any;
  ageConsent: boolean;
}): void {
  stmtLogDownload.run(entry.userEmail, entry.type, entry.status, JSON.stringify(entry.meta ?? {}), entry.ageConsent ? 1 : 0, Date.now());
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

export function clearAllDownloadLogs(): void {
  stmtDeleteAllDownloads.run();
}

export function getDbStats(): { users: number; downloads: number; guestDownloads: number } {
  return {
    users:         (stmtCountUsers.get() as { count: number }).count,
    downloads:     (stmtCountDownloads.get() as { count: number }).count,
    guestDownloads:(stmtCountGuests.get() as { count: number }).count,
  };
}

// --- Guest download helpers ---

const stmtCountGuestDownloads = db.prepare('SELECT COUNT(*) AS count FROM guest_downloads WHERE ip = ?');
const stmtLogGuestDownload    = db.prepare('INSERT INTO guest_downloads (ip, created_at) VALUES (?, ?)');

export function getGuestDownloadCount(ip: string): number {
  return ((stmtCountGuestDownloads.get(ip) as { count: number }) ?? { count: 0 }).count;
}

export function logGuestDownload(ip: string): void {
  stmtLogGuestDownload.run(ip, Date.now());
}

// --- Seed default users on startup ---
// Railway wipes SQLite on every redeploy. Seed users survive this via IF NOT EXISTS check.
// Each seed user gets an explicit role. Override via SEED_USERS env var (JSON array):
// [{"email":"x@y.com","password":"Pass1!","role":"admin"}]

const DEFAULT_SEED_USERS: { email: string; password: string; role: UserRole }[] = [
  { email: 'admin@test.com',  password: 'TestPassword123!', role: 'admin'  },
  { email: 'owner@test.com',  password: 'TestPassword123!', role: 'owner'  },
  { email: 'tester@test.com', password: 'TestPassword123!', role: 'tester' },
  { email: 'user@test.com',   password: 'TestPassword123!', role: 'user'   },
];

(async () => {
  let seedUsers = DEFAULT_SEED_USERS;
  if (process.env.SEED_USERS) {
    try { seedUsers = JSON.parse(process.env.SEED_USERS); } catch { /* use defaults */ }
  }
  for (const u of seedUsers) {
    if (!userExists(u.email)) {
      const hash = await bcryptjs.hash(u.password, 10);
      createUser(u.email, hash, u.role ?? 'user');
    } else {
      // Ensure existing seeded users have the correct role (in case they were created before role column)
      setUserRole(u.email, u.role ?? 'user');
    }
  }
})();

// Graceful shutdown
export function closeDatabase(): void {
  db.close();
}

export default db;
