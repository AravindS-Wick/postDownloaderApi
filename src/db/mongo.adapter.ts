/**
 * MongoDB adapter — uses mongoose.
 * Used when DB_DRIVER=mongo in production (Railway).
 * Requires MONGODB_URI environment variable.
 */

import mongoose, { Schema, model, type Document, type Model } from 'mongoose';
import bcryptjs from 'bcryptjs';
import type {
  DbAdapter,
  DbUser,
  DbDownload,
  DbBugReport,
  DbStats,
  BugStatus,
  UserRole,
  SeedUser,
} from './types.js';

// ── Mongoose schemas ─────────────────────────────────────────────────────────

interface UserDoc extends Document {
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
  password_reset_token: string | null;
  password_reset_expires: number | null;
}

function generateUserRef(): string {
  return 'U' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

const userSchema = new Schema<UserDoc>({
  email:                 { type: String, required: true, unique: true, index: true },
  user_ref:             { type: String, required: true, unique: true, index: true, default: generateUserRef },
  password:              { type: String, required: true },
  created_at:            { type: Number, required: true },
  role:                  { type: String, default: 'user' },
  is_blocked:            { type: Number, default: 0 },
  monthly_downloads:     { type: Number, default: 0 },
  month_reset_at:        { type: Number, default: 0 },
  is_verified:           { type: Number, default: 0 },
  verification_code:     { type: String, default: null },
  verification_expires:  { type: Number, default: null },
  password_reset_token:  { type: String, default: null },
  password_reset_expires:{ type: Number, default: null },
}, { collection: 'users' });

interface DownloadDoc extends Document {
  user_ref: string | null;
  type: string;
  status: 'attempt' | 'complete' | 'consent';
  meta: string;
  age_consent: number;
  created_at: number;
}

const downloadSchema = new Schema<DownloadDoc>({
  user_ref:  { type: String, default: null, index: true },
  type:        { type: String, required: true },
  status:      { type: String, required: true, enum: ['attempt', 'complete', 'consent'] },
  meta:        { type: String, default: '{}' },
  age_consent: { type: Number, default: 0 },
  created_at:  { type: Number, required: true, index: true },
}, { collection: 'downloads' });

interface GuestDownloadDoc extends Document {
  ip: string;
  created_at: number;
}

const guestDownloadSchema = new Schema<GuestDownloadDoc>({
  ip:         { type: String, required: true, index: true },
  created_at: { type: Number, required: true },
}, { collection: 'guest_downloads' });

interface BugReportDoc extends Document {
  reporter_email: string;
  error_text: string;
  image_base64: string | null;
  status: BugStatus;
  created_at: number;
  updated_at: number;
}

const bugReportSchema = new Schema<BugReportDoc>({
  reporter_email: { type: String, required: true, index: true },
  error_text:     { type: String, required: true },
  image_base64:   { type: String, default: null },
  status:         { type: String, default: 'todo', index: true,
                    enum: ['todo','inprogress','pr-raised','verify','blocked','fixed'] },
  created_at:     { type: Number, required: true },
  updated_at:     { type: Number, required: true },
}, { collection: 'bug_reports' });

interface RefreshTokenDoc extends Document {
  token: string;
  user_email: string;
  expires_at: number;
  revoked: number;
  created_at: number;
}

const refreshTokenSchema = new Schema<RefreshTokenDoc>({
  token:      { type: String, required: true, unique: true, index: true },
  user_email: { type: String, required: true, index: true },
  expires_at: { type: Number, required: true },
  revoked:    { type: Number, default: 0 },
  created_at: { type: Number, required: true },
}, { collection: 'refresh_tokens' });

// ── Models (lazy — only created after connect()) ─────────────────────────────

let User: Model<UserDoc>;
let Download: Model<DownloadDoc>;
let GuestDownload: Model<GuestDownloadDoc>;
let BugReport: Model<BugReportDoc>;
let RefreshToken: Model<RefreshTokenDoc>;

async function connect(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable is required for DB_DRIVER=mongo');

  await mongoose.connect(uri).catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    throw err;
  });

  User         = model<UserDoc>('User', userSchema);
  Download     = model<DownloadDoc>('Download', downloadSchema);
  GuestDownload= model<GuestDownloadDoc>('GuestDownload', guestDownloadSchema);
  BugReport    = model<BugReportDoc>('BugReport', bugReportSchema);
  RefreshToken = model<RefreshTokenDoc>('RefreshToken', refreshTokenSchema);
}

// ── Helper: map Mongoose doc → plain DbUser ──────────────────────────────────

function toDbUser(doc: UserDoc): DbUser {
  return {
    email:                doc.email,
    user_ref:             doc.user_ref,
    password:             doc.password,
    created_at:           doc.created_at,
    role:                 doc.role as UserRole,
    is_blocked:           doc.is_blocked,
    monthly_downloads:    doc.monthly_downloads,
    month_reset_at:       doc.month_reset_at,
    is_verified:          doc.is_verified,
    verification_code:    doc.verification_code,
    verification_expires: doc.verification_expires,
  };
}

function toDbDownload(doc: DownloadDoc & { _id: any }): DbDownload {
  return {
    id:         doc._id.toString(),
    user_ref: doc.user_ref,
    type:       doc.type,
    status:     doc.status,
    meta:       doc.meta,
    age_consent:doc.age_consent,
    created_at: doc.created_at,
  } as unknown as DbDownload;
}

function toDbBugReport(doc: BugReportDoc & { _id: any }): DbBugReport {
  return {
    id:             doc._id.toString(),
    reporter_email: doc.reporter_email,
    error_text:     doc.error_text,
    image_base64:   doc.image_base64,
    status:         doc.status,
    created_at:     doc.created_at,
    updated_at:     doc.updated_at,
  } as unknown as DbBugReport;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export const mongoAdapter: DbAdapter = {
  // --- User ---
  async getUser(email) {
    const doc = await User.findOne({ email });
    return doc ? toDbUser(doc) : undefined;
  },
  async createUser(email, passwordHash, role = 'user') {
    await User.create({ email, user_ref: generateUserRef(), password: passwordHash, created_at: Date.now(), role });
  },
  async userExists(email) {
    return (await User.exists({ email })) !== null;
  },
  async setUserRole(email, role) {
    await User.updateOne({ email }, { role });
  },
  async setUserBlocked(email, blocked) {
    await User.updateOne({ email }, { is_blocked: blocked ? 1 : 0 });
  },
  async deleteUser(email) {
    await User.deleteOne({ email });
  },
  async getAllUsers() {
    const docs = await User.find({}, '-password').sort({ created_at: -1 });
    return docs.map(d => ({
      email:             d.email,
      user_ref:         d.user_ref,
      created_at:        d.created_at,
      role:              d.role as UserRole,
      is_blocked:        d.is_blocked,
      monthly_downloads: d.monthly_downloads,
      month_reset_at:    d.month_reset_at,
      is_verified:       d.is_verified,
      verification_code:    d.verification_code,
      verification_expires: d.verification_expires,
    }));
  },
  async incrementMonthlyDownloads(email) {
    await User.updateOne({ email }, { $inc: { monthly_downloads: 1 } });
  },
  async resetMonthlyDownloadsIfNeeded(email) {
    const doc = await User.findOne({ email });
    if (!doc) return;
    const now = new Date();
    const resetDate = new Date(doc.month_reset_at);
    if (
      doc.month_reset_at === 0 ||
      resetDate.getMonth() !== now.getMonth() ||
      resetDate.getFullYear() !== now.getFullYear()
    ) {
      await User.updateOne({ email }, { monthly_downloads: 0, month_reset_at: Date.now() });
    }
  },
  async getMonthlyDownloadCount(email) {
    const doc = await User.findOne({ email }, 'monthly_downloads');
    return doc?.monthly_downloads ?? 0;
  },

  // --- Verification ---
  async setVerificationCode(email, code, expiresAt) {
    await User.updateOne({ email }, { verification_code: code, verification_expires: expiresAt });
  },
  async markEmailVerified(email) {
    await User.updateOne({ email }, { is_verified: 1, verification_code: null, verification_expires: null });
  },
  async updatePassword(email, hashedPassword) {
    await User.updateOne({ email }, { password: hashedPassword });
  },
  async setPasswordResetToken(email, token, expiresAt) {
    await User.updateOne({ email }, { password_reset_token: token, password_reset_expires: expiresAt });
  },
  async getPasswordResetToken(email) {
    const doc = await User.findOne({ email }, 'password_reset_token password_reset_expires');
    if (!doc || !doc.password_reset_token) return undefined;
    return { token: doc.password_reset_token, expires_at: doc.password_reset_expires! };
  },
  async validatePasswordResetToken(email, token) {
    const doc = await User.findOne({ email }, 'password_reset_token password_reset_expires');
    if (!doc || !doc.password_reset_token) return false;
    if (doc.password_reset_token !== token) return false;
    if (Date.now() > (doc.password_reset_expires ?? 0)) return false;
    return true;
  },
  async clearPasswordResetToken(email) {
    await User.updateOne({ email }, { password_reset_token: null, password_reset_expires: null });
  },

  // --- Refresh tokens ---
  async storeRefreshToken(token, userEmail, expiresAt) {
    await RefreshToken.create({ token, user_email: userEmail, expires_at: expiresAt, created_at: Date.now() });
  },
  async getRefreshToken(token) {
    const doc = await RefreshToken.findOne({ token });
    if (!doc) return undefined;
    return { token: doc.token, user_email: doc.user_email, expires_at: doc.expires_at, revoked: doc.revoked };
  },
  async revokeRefreshToken(token) {
    await RefreshToken.updateOne({ token }, { revoked: 1 });
  },
  async revokeAllUserRefreshTokens(userEmail) {
    await RefreshToken.updateMany({ user_email: userEmail }, { revoked: 1 });
  },
  async cleanExpiredRefreshTokens() {
    await RefreshToken.deleteMany({ $or: [{ expires_at: { $lt: Date.now() } }, { revoked: 1 }] });
  },

  // --- Downloads ---
  async logDownload(entry) {
    await Download.create({
      user_ref:  entry.userRef,
      type:        entry.type,
      status:      entry.status,
      meta:        JSON.stringify(entry.meta ?? {}),
      age_consent: entry.ageConsent ? 1 : 0,
      created_at:  Date.now(),
    });
  },
  async getUserDownloads(userRef) {
    const docs = await Download.find({ user_ref: userRef }).sort({ created_at: -1 });
    return docs.map(toDbDownload);
  },
  async getGuestDownloads(limit = 1000) {
    const docs = await Download.find({ user_ref: null }).sort({ created_at: -1 }).limit(limit);
    return docs.map(toDbDownload);
  },
  async deleteUserDownloads(userRef) {
    await Download.deleteMany({ user_ref: userRef });
  },

  // --- Guest downloads ---
  async getGuestDownloadCount(ip) {
    return GuestDownload.countDocuments({ ip });
  },
  async logGuestDownload(ip) {
    await GuestDownload.create({ ip, created_at: Date.now() });
  },

  // --- Bug reports ---
  async createBugReport(reporterEmail, errorText, imageBase64) {
    const now = Date.now();
    const doc = await BugReport.create({
      reporter_email: reporterEmail,
      error_text:     errorText,
      image_base64:   imageBase64 ?? null,
      status:         'todo',
      created_at:     now,
      updated_at:     now,
    });
    // Return the ObjectId string cast to unknown then number to satisfy the
    // shared interface (SQLite uses integer rowids; callers treat it as opaque).
    return doc._id.toString() as unknown as number;
  },
  async getAllBugReports() {
    const docs = await BugReport.find().sort({ created_at: -1 });
    return docs.map(toDbBugReport);
  },
  async updateBugStatus(id, status) {
    await BugReport.updateOne({ _id: String(id) }, { status, updated_at: Date.now() });
  },

  // --- Stats ---
  async getDbStats() {
    const [users, downloads, bugReports, guestDownloads] = await Promise.all([
      User.countDocuments(),
      Download.countDocuments(),
      BugReport.countDocuments(),
      GuestDownload.countDocuments(),
    ]);
    return { users, downloads, bugReports, guestDownloads };
  },
  async clearDownloadLogs() {
    await Promise.all([Download.deleteMany({}), GuestDownload.deleteMany({})]);
  },

  // --- Seed ---
  async seedUsers(users: SeedUser[]) {
    for (const u of users) {
      const exists = await User.exists({ email: u.email });
      if (!exists) {
        const hash = await bcryptjs.hash(u.password, 10);
        await User.create({
          email:      u.email,
          password:   hash,
          created_at: Date.now(),
          role:       u.role ?? 'user',
          is_verified: 1,
        });
      }
    }
  },

  // --- Lifecycle ---
  async close() {
    await mongoose.disconnect();
  },
};

export { connect as connectMongo };
