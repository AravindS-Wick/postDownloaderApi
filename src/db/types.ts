// Shared types and the DbAdapter interface used by all database drivers.

export type UserRole = 'admin' | 'owner' | 'tester' | 'user';
export type BugStatus = 'todo' | 'inprogress' | 'pr-raised' | 'verify' | 'blocked' | 'fixed';

export interface DbUser {
  email: string;
  user_ref: string;
  password: string;
  created_at: number;
  role: UserRole;
  is_blocked: number;
  monthly_downloads: number;
  month_reset_at: number;
  is_verified: number;
  verification_code: string | null;
  verification_expires: number | null;
}

export interface DbDownload {
  id: number;
  user_ref: string | null;
  type: string;
  status: 'attempt' | 'complete' | 'consent';
  meta: string; // JSON string
  age_consent: number;
  created_at: number;
}

export interface DbBugReport {
  id: number;
  reporter_email: string;
  error_text: string;
  image_base64: string | null;
  status: BugStatus;
  created_at: number;
  updated_at: number;
}

export interface DbStats {
  users: number;
  downloads: number;
  bugReports: number;
  guestDownloads: number;
}

export interface SeedUser {
  email: string;
  password: string;
  role?: UserRole;
}

export interface DbAdapter {
  // User
  getUser(email: string): Promise<DbUser | undefined>;
  createUser(email: string, passwordHash: string, role?: UserRole): Promise<void>;
  userExists(email: string): Promise<boolean>;
  setUserRole(email: string, role: UserRole): Promise<void>;
  setUserBlocked(email: string, blocked: boolean): Promise<void>;
  deleteUser(email: string): Promise<void>;
  getAllUsers(): Promise<Omit<DbUser, 'password'>[]>;
  incrementMonthlyDownloads(email: string): Promise<void>;
  resetMonthlyDownloadsIfNeeded(email: string): Promise<void>;
  getMonthlyDownloadCount(email: string): Promise<number>;

  // Verification
  setVerificationCode(email: string, code: string, expiresAt: number): Promise<void>;
  markEmailVerified(email: string): Promise<void>;
  updatePassword(email: string, hashedPassword: string): Promise<void>;
  setPasswordResetToken(email: string, token: string, expiresAt: number): Promise<void>;
  getPasswordResetToken(email: string): Promise<{ token: string; expires_at: number } | undefined>;
  validatePasswordResetToken(email: string, token: string): Promise<boolean>;
  clearPasswordResetToken(email: string): Promise<void>;

  // Refresh tokens
  storeRefreshToken(token: string, userEmail: string, expiresAt: number): Promise<void>;
  getRefreshToken(token: string): Promise<{ token: string; user_email: string; expires_at: number; revoked: number } | undefined>;
  revokeRefreshToken(token: string): Promise<void>;
  revokeAllUserRefreshTokens(userEmail: string): Promise<void>;
  cleanExpiredRefreshTokens(): Promise<void>;

  // Downloads
  logDownload(entry: { userRef: string | null; type: string; status: string; meta: any; ageConsent: boolean }): Promise<void>;
  getUserDownloads(userRef: string): Promise<DbDownload[]>;
  getGuestDownloads(limit?: number): Promise<DbDownload[]>;
  deleteUserDownloads(userRef: string): Promise<void>;

  // Guest downloads
  getGuestDownloadCount(ip: string): Promise<number>;
  logGuestDownload(ip: string): Promise<void>;

  // Bug reports
  createBugReport(reporterEmail: string, errorText: string, imageBase64?: string): Promise<number>;
  getAllBugReports(): Promise<DbBugReport[]>;
  updateBugStatus(id: number, status: BugStatus): Promise<void>;

  // Stats
  getDbStats(): Promise<DbStats>;
  clearDownloadLogs(): Promise<void>;

  // Seed
  seedUsers(users: SeedUser[]): Promise<void>;

  // Lifecycle
  close(): Promise<void>;
}
