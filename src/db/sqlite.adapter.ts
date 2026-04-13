/**
 * SQLite adapter — uses better-sqlite3.
 * Used when DB_DRIVER=sqlite (or unset) in local development.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcryptjs from 'bcryptjs';
import type {
  DbAdapter,
  DbUser,
  DbDownload,
  DbBugReport,
  DbStats,
  BugStatus,
  UserRole,
} from './types.js';

const __filename_db = fileURLToPath(import.meta.url);
const __dirname_db = path.dirname(__filename_db);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname_db, '../..');
const DB_PATH = path.join(DATA_DIR, 'db', 'app.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

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

try { db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN monthly_downloads INTEGER NOT NULL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN month_reset_at INTEGER NOT NULL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN verification_code TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN user_ref TEXT`); } catch {}
try { db.exec(`ALTER TABLE downloads ADD COLUMN user_ref TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN verification_expires INTEGER`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN password_reset_token TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN password_reset_expires INTEGER`); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    user_email TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_email);
`);

const stmtGetUser = db.prepare('SELECT * FROM users WHERE email = ?');
const stmtCreateUser = db.prepare(
  `INSERT INTO users (email, password, created_at, role, is_blocked, monthly_downloads, month_reset_at)
   VALUES (?, ?, ?, ?, 0, 0, 0)`
);
const stmtLogDownload = db.prepare(
  'INSERT INTO downloads (user_email, type, status, meta, age_consent, created_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const stmtGetUserDownloads = db.prepare(
  'SELECT * FROM downloads WHERE user_email = ? ORDER BY created_at DESC'
);
const stmtGetGuestDownloads = db.prepare(
  'SELECT * FROM downloads WHERE user_email IS NULL ORDER BY created_at DESC LIMIT ?'
);
const stmtDeleteUserDownloads = db.prepare('DELETE FROM downloads WHERE user_email = ?');
const stmtCountGuestDownloads = db.prepare(
  'SELECT COUNT(*) AS count FROM guest_downloads WHERE ip = ?'
);
const stmtLogGuestDownload = db.prepare(
  'INSERT INTO guest_downloads (ip, created_at) VALUES (?, ?)'
);

export const sqliteAdapter: DbAdapter = {
  // --- User ---
  async getUser(email) {
    return stmtGetUser.get(email) as DbUser | undefined;
  },
  async createUser(email, passwordHash, role = 'user') {
    stmtCreateUser.run(email, passwordHash, Date.now(), role);
  },
  async userExists(email) {
    return stmtGetUser.get(email) !== undefined;
  },
  async setUserRole(email, role) {
    db.prepare('UPDATE users SET role = ? WHERE email = ?').run(role, email);
  },
  async setUserBlocked(email, blocked) {
    db.prepare('UPDATE users SET is_blocked = ? WHERE email = ?').run(blocked ? 1 : 0, email);
  },
  async deleteUser(email) {
    db.prepare('DELETE FROM users WHERE email = ?').run(email);
  },
  async getAllUsers() {
    return db.prepare(
      'SELECT email, created_at, role, is_blocked, monthly_downloads, month_reset_at, is_verified FROM users ORDER BY created_at DESC'
    ).all() as Omit<DbUser, 'password'>[];
  },
  async incrementMonthlyDownloads(email) {
    db.prepare('UPDATE users SET monthly_downloads = monthly_downloads + 1 WHERE email = ?').run(email);
  },
  async resetMonthlyDownloadsIfNeeded(email) {
    const user = stmtGetUser.get(email) as DbUser | undefined;
    if (!user) return;
    const now = new Date();
    const resetDate = new Date(user.month_reset_at);
    if (
      user.month_reset_at === 0 ||
      resetDate.getMonth() !== now.getMonth() ||
      resetDate.getFullYear() !== now.getFullYear()
    ) {
      db.prepare('UPDATE users SET monthly_downloads = 0, month_reset_at = ? WHERE email = ?').run(Date.now(), email);
    }
  },
  async getMonthlyDownloadCount(email) {
    const user = stmtGetUser.get(email) as DbUser | undefined;
    return user?.monthly_downloads ?? 0;
  },

  // --- Verification ---
  async setVerificationCode(email, code, expiresAt) {
    db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE email = ?')
      .run(code, expiresAt, email);
  },
  async markEmailVerified(email) {
    db.prepare('UPDATE users SET is_verified = 1, verification_code = NULL, verification_expires = NULL WHERE email = ?')
      .run(email);
  },
  async updatePassword(email, hashedPassword) {
    db.prepare('UPDATE users SET password = ? WHERE email = ?').run(hashedPassword, email);
  },
  async setPasswordResetToken(email, token, expiresAt) {
    db.prepare('UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE email = ?')
      .run(token, expiresAt, email);
  },
  async getPasswordResetToken(email) {
    return db.prepare(
      'SELECT password_reset_token as token, password_reset_expires as expires_at FROM users WHERE email = ?'
    ).get(email) as { token: string; expires_at: number } | undefined;
  },
  async validatePasswordResetToken(email, token) {
    const row = db.prepare(
      'SELECT password_reset_token as token, password_reset_expires as expires_at FROM users WHERE email = ?'
    ).get(email) as { token: string; expires_at: number } | undefined;
    if (!row || !row.token) return false;
    if (row.token !== token) return false;
    if (Date.now() > row.expires_at) return false;
    return true;
  },
  async clearPasswordResetToken(email) {
    db.prepare('UPDATE users SET password_reset_token = NULL, password_reset_expires = NULL WHERE email = ?')
      .run(email);
  },

  // --- Refresh tokens ---
  async storeRefreshToken(token, userEmail, expiresAt) {
    db.prepare('INSERT INTO refresh_tokens (token, user_email, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(token, userEmail, expiresAt, Date.now());
  },
  async getRefreshToken(token) {
    return db.prepare('SELECT * FROM refresh_tokens WHERE token = ?').get(token) as
      | { token: string; user_email: string; expires_at: number; revoked: number }
      | undefined;
  },
  async revokeRefreshToken(token) {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?').run(token);
  },
  async revokeAllUserRefreshTokens(userEmail) {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_email = ?').run(userEmail);
  },
  async cleanExpiredRefreshTokens() {
    db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked = 1').run(Date.now());
  },

  // --- Downloads ---
  async logDownload(entry) {
    stmtLogDownload.run(
      entry.userRef,
      entry.type,
      entry.status,
      JSON.stringify(entry.meta ?? {}),
      entry.ageConsent ? 1 : 0,
      Date.now()
    );
  },
  async getUserDownloads(userRef) {
    return stmtGetUserDownloads.all(userRef) as DbDownload[];
  },
  async getGuestDownloads(limit = 1000) {
    return stmtGetGuestDownloads.all(limit) as DbDownload[];
  },
  async deleteUserDownloads(userRef) {
    stmtDeleteUserDownloads.run(userRef);
  },

  // --- Guest downloads ---
  async getGuestDownloadCount(ip) {
    const row = stmtCountGuestDownloads.get(ip) as { count: number } | undefined;
    return row?.count ?? 0;
  },
  async logGuestDownload(ip) {
    stmtLogGuestDownload.run(ip, Date.now());
  },

  // --- Bug reports ---
  async createBugReport(reporterEmail, errorText, imageBase64) {
    const now = Date.now();
    const result = db.prepare(
      `INSERT INTO bug_reports (reporter_email, error_text, image_base64, status, created_at, updated_at)
       VALUES (?, ?, ?, 'todo', ?, ?)`
    ).run(reporterEmail, errorText, imageBase64 ?? null, now, now);
    return result.lastInsertRowid as number;
  },
  async getAllBugReports() {
    return db.prepare('SELECT * FROM bug_reports ORDER BY created_at DESC').all() as DbBugReport[];
  },
  async updateBugStatus(id, status) {
    db.prepare('UPDATE bug_reports SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
  },

  // --- Stats ---
  async getDbStats() {
    const users = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
    const downloads = (db.prepare('SELECT COUNT(*) AS count FROM downloads').get() as { count: number }).count;
    const bugReports = (db.prepare('SELECT COUNT(*) AS count FROM bug_reports').get() as { count: number }).count;
    const guestDownloads = (db.prepare('SELECT COUNT(*) AS count FROM guest_downloads').get() as { count: number }).count;
    return { users, downloads, bugReports, guestDownloads };
  },
  async clearDownloadLogs() {
    db.exec('DELETE FROM downloads; DELETE FROM guest_downloads;');
  },

  // --- Seed ---
  async seedUsers(users) {
    for (const u of users) {
      const exists = stmtGetUser.get(u.email) !== undefined;
      if (!exists) {
        const hash = await bcryptjs.hash(u.password, 10);
        stmtCreateUser.run(u.email, hash, Date.now(), u.role ?? 'user');
        db.prepare('UPDATE users SET is_verified = 1 WHERE email = ?').run(u.email);
      }
    }
  },

  // --- Lifecycle ---
  async close() {
    db.close();
  },
};
