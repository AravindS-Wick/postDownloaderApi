/**
 * DB driver selector.
 *
 * DB_DRIVER=sqlite  → better-sqlite3 (default, local dev)
 * DB_DRIVER=mongo   → MongoDB Atlas  (production / Railway)
 *
 * All callers import named functions from this file — the adapter is
 * transparent. No other file needs to know which DB is in use.
 */

import type { DbAdapter, UserRole, BugStatus } from './types.js';
export type { UserRole, BugStatus, DbUser, DbDownload, DbBugReport, DbStats } from './types.js';

const driver = (process.env.DB_DRIVER ?? 'sqlite').toLowerCase();

// Adapter is loaded dynamically so that better-sqlite3 is never imported
// when running on Railway with DB_DRIVER=mongo (avoids native binding issues).
let _adapter: DbAdapter;
let _sqliteAdapter: DbAdapter;

async function getAdapter(): Promise<DbAdapter> {
  if (_adapter) return _adapter;
  if (driver === 'mongo') {
    try {
      const { mongoAdapter, connectMongo } = await import('./mongo.adapter.js');
      await connectMongo();
      _adapter = mongoAdapter;
      console.log('Database connected: MongoDB');
    } catch (mongoErr) {
      console.warn('MongoDB unavailable, falling back to SQLite:', mongoErr instanceof Error ? mongoErr.message : 'Unknown error');
      const { sqliteAdapter } = await import('./sqlite.adapter.js');
      _adapter = sqliteAdapter;
      console.log('Database connected: SQLite');
    }
  } else {
    const { sqliteAdapter } = await import('./sqlite.adapter.js');
    _adapter = sqliteAdapter;
    console.log('Database connected: SQLite');
  }
  return _adapter;
}

async function getSqliteAdapter(): Promise<DbAdapter> {
  if (_sqliteAdapter) return _sqliteAdapter;
  const { sqliteAdapter } = await import('./sqlite.adapter.js');
  _sqliteAdapter = sqliteAdapter;
  console.log('Guest DB: SQLite');
  return _sqliteAdapter;
}

// Initialised on startup. Awaited by index.ts before the server starts.
const DEFAULT_SEED_USERS = [
  { email: 'admin@test.com',  password: 'TestPassword123!', role: 'admin'  as UserRole },
  { email: 'owner@test.com',  password: 'TestPassword123!', role: 'owner'  as UserRole },
  { email: 'tester@test.com', password: 'TestPassword123!', role: 'tester' as UserRole },
  { email: 'user@test.com',   password: 'TestPassword123!', role: 'user'   as UserRole },
];

export const dbReady: Promise<void> = (async () => {
  try {
    const adapter = await getAdapter();
    let seedUsers = DEFAULT_SEED_USERS;
    if (process.env.SEED_USERS) {
      try { seedUsers = JSON.parse(process.env.SEED_USERS); } catch { /* use defaults */ }
    }
    await adapter.seedUsers(seedUsers);
  } catch (err) {
    console.warn('Database initialization failed, app will run without persistence:', err instanceof Error ? err.message : 'Unknown error');
  }
})();

// ── Forwarding functions (same signatures the rest of the codebase expects) ──

export async function getUser(email: string) {
  return (await getAdapter()).getUser(email);
}
export async function createUser(email: string, passwordHash: string, role?: UserRole) {
  return (await getAdapter()).createUser(email, passwordHash, role);
}
export async function userExists(email: string) {
  return (await getAdapter()).userExists(email);
}
export async function setUserRole(email: string, role: UserRole) {
  return (await getAdapter()).setUserRole(email, role);
}
export async function setUserBlocked(email: string, blocked: boolean) {
  return (await getAdapter()).setUserBlocked(email, blocked);
}
export async function deleteUser(email: string) {
  return (await getAdapter()).deleteUser(email);
}
export async function getAllUsers() {
  return (await getAdapter()).getAllUsers();
}
export async function incrementMonthlyDownloads(email: string) {
  return (await getAdapter()).incrementMonthlyDownloads(email);
}
export async function resetMonthlyDownloadsIfNeeded(email: string) {
  return (await getAdapter()).resetMonthlyDownloadsIfNeeded(email);
}
export async function getMonthlyDownloadCount(email: string) {
  return (await getAdapter()).getMonthlyDownloadCount(email);
}

// --- Verification ---
export async function setVerificationCode(email: string, code: string, expiresAt: number) {
  return (await getAdapter()).setVerificationCode(email, code, expiresAt);
}
export async function markEmailVerified(email: string) {
  return (await getAdapter()).markEmailVerified(email);
}
export async function updatePassword(email: string, hashedPassword: string) {
  return (await getAdapter()).updatePassword(email, hashedPassword);
}
export async function setPasswordResetToken(email: string, token: string, expiresAt: number) {
  return (await getAdapter()).setPasswordResetToken(email, token, expiresAt);
}
export async function getPasswordResetToken(email: string) {
  return (await getAdapter()).getPasswordResetToken(email);
}
export async function validatePasswordResetToken(email: string, token: string) {
  return (await getAdapter()).validatePasswordResetToken(email, token);
}
export async function clearPasswordResetToken(email: string) {
  return (await getAdapter()).clearPasswordResetToken(email);
}

// --- Refresh tokens ---
export async function storeRefreshToken(token: string, userEmail: string, expiresAt: number) {
  return (await getAdapter()).storeRefreshToken(token, userEmail, expiresAt);
}
export async function getRefreshToken(token: string) {
  return (await getAdapter()).getRefreshToken(token);
}
export async function revokeRefreshToken(token: string) {
  return (await getAdapter()).revokeRefreshToken(token);
}
export async function revokeAllUserRefreshTokens(userEmail: string) {
  return (await getAdapter()).revokeAllUserRefreshTokens(userEmail);
}
export async function cleanExpiredRefreshTokens() {
  return (await getAdapter()).cleanExpiredRefreshTokens();
}

// --- Downloads ---
export async function logDownload(entry: {
  userRef: string | null;
  type: string;
  status: string;
  meta: any;
  ageConsent: boolean;
}) {
  return (await getAdapter()).logDownload(entry);
}
export async function logDownloadForUser(entry: {
  userRef: string;
  type: string;
  status: string;
  meta: any;
  ageConsent: boolean;
}) {
  return (await getAdapter()).logDownload(entry);
}
export async function logGuestDownloadEntry(entry: {
  userRef: string | null;
  type: string;
  status: string;
  meta: any;
  ageConsent: boolean;
}) {
  return (await getSqliteAdapter()).logDownload(entry);
}
export async function getUserDownloads(userRef: string) {
  return (await getAdapter()).getUserDownloads(userRef);
}
export async function getGuestDownloads(limit?: number) {
  return (await getAdapter()).getGuestDownloads(limit);
}
export async function deleteUserDownloads(email: string) {
  return (await getAdapter()).deleteUserDownloads(email);
}

// --- Guest downloads ---
export async function getGuestDownloadCount(ip: string) {
  return (await getAdapter()).getGuestDownloadCount(ip);
}
export async function logGuestDownload(ip: string) {
  return (await getAdapter()).logGuestDownload(ip);
}

// --- Bug reports ---
export async function createBugReport(reporterEmail: string, errorText: string, imageBase64?: string) {
  return (await getAdapter()).createBugReport(reporterEmail, errorText, imageBase64);
}
export async function getAllBugReports() {
  return (await getAdapter()).getAllBugReports();
}
export async function updateBugStatus(id: number, status: BugStatus) {
  return (await getAdapter()).updateBugStatus(id, status);
}

// --- Stats ---
export async function getDbStats() {
  return (await getAdapter()).getDbStats();
}
export async function clearDownloadLogs() {
  return (await getAdapter()).clearDownloadLogs();
}

// --- Lifecycle ---
export async function closeDatabase() {
  return (await getAdapter()).close();
}
