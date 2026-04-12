/**
 * Integration-style route tests using Fastify's inject() method.
 * All DB calls and external services are mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

// ── Mock DB so better-sqlite3 never loads ────────────────────────────────────
vi.mock('../db/database.js', () => ({
    getUser: vi.fn(),
    createUser: vi.fn(),
    userExists: vi.fn(),
    logDownload: vi.fn(),
    getUserDownloads: vi.fn(),
    getGuestDownloadCount: vi.fn().mockReturnValue(0),
    logGuestDownload: vi.fn(),
    closeDatabase: vi.fn(),
    getAllUsers: vi.fn().mockReturnValue([]),
    setUserBlocked: vi.fn(),
    setUserRole: vi.fn(),
    deleteUser: vi.fn(),
    resetMonthlyDownloadsIfNeeded: vi.fn(),
    incrementMonthlyDownloads: vi.fn(),
    getMonthlyDownloadCount: vi.fn().mockReturnValue(0),
    createBugReport: vi.fn().mockReturnValue(1),
    getAllBugReports: vi.fn().mockReturnValue([]),
    updateBugStatus: vi.fn(),
    getDbStats: vi.fn().mockReturnValue({ users: 0, downloads: 0, bugReports: 0, guestDownloads: 0 }),
    clearDownloadLogs: vi.fn(),
    getGuestDownloads: vi.fn().mockReturnValue([]),
    deleteUserDownloads: vi.fn(),
    storeRefreshToken: vi.fn(),
    getRefreshToken: vi.fn(),
    revokeRefreshToken: vi.fn(),
    revokeAllUserRefreshTokens: vi.fn(),
    setVerificationCode: vi.fn(),
    markEmailVerified: vi.fn(),
    cleanExpiredRefreshTokens: vi.fn(),
}));

vi.mock('../services/platform.service.js', () => ({
    PlatformService: vi.fn().mockImplementation(() => ({
        getInstagramAuthUrl: vi.fn().mockResolvedValue('https://instagram.com/auth'),
        getYouTubeAuthUrl: vi.fn().mockResolvedValue('https://youtube.com/auth'),
        getTwitterAuthUrl: vi.fn().mockResolvedValue('https://twitter.com/auth'),
        handleInstagramCallback: vi.fn(),
        handleYouTubeCallback: vi.fn(),
        handleTwitterCallback: vi.fn(),
    })),
    isValidPlatform: vi.fn((p: string) => ['instagram', 'youtube', 'twitter'].includes(p)),
    validateOAuthState: vi.fn().mockReturnValue({ valid: false, error: 'Invalid state' }),
}));

vi.mock('../services/email.service.js', () => ({
    generateVerificationCode: vi.fn().mockReturnValue('123456'),
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/auth.service.js', () => ({
    createAuthService: vi.fn(() => ({
        login: vi.fn().mockRejectedValue(new Error('Invalid credentials')),
        getAuthUrl: vi.fn().mockResolvedValue('https://example.com/auth'),
        checkPlatformLogin: vi.fn().mockResolvedValue(false),
        connectPlatform: vi.fn().mockResolvedValue({ id: 'instagram', isConnected: true, accessToken: 'tok' }),
        disconnectPlatform: vi.fn().mockResolvedValue(undefined),
        getCurrentUser: vi.fn().mockResolvedValue({ id: '1', email: 'u@test.com', name: 'u', role: 'user', platforms: [] }),
    })),
    AuthService: vi.fn(),
}));

import { authRoutes } from '../routes/auth.routes.js';
import userRoutes from '../routes/user.js';
import { getUser, createUser, userExists, logDownload, getUserDownloads } from '../db/database.js';
import bcrypt from 'bcryptjs';

// ── Build a minimal Fastify app for testing ──────────────────────────────────
async function buildApp(): Promise<FastifyInstance> {
    const app = fastify({ logger: false });

    // Skip per-route rate limiting during tests by allowing all localhost IPs
    await app.register(rateLimit, {
        global: false,
        max: 10000,
        timeWindow: '1 minute',
        allowList: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
    });
    await app.register(jwt, { secret: 'test-secret-for-testing-only' });

    app.decorate('authenticate', async (request: any, reply: any) => {
        try { await request.jwtVerify(); }
        catch { reply.code(401).send({ error: 'Unauthorized' }); }
    });

    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.register(userRoutes, { prefix: '/api/user' });

    return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('Auth Routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => { app = await buildApp(); });
    afterAll(async () => { await app.close(); });
    beforeEach(() => { vi.clearAllMocks(); });

    describe('POST /api/auth/register', () => {
        it('returns 400 when email is missing', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { password: 'Password1' } });
            expect(res.statusCode).toBe(400);
        });

        it('returns 400 when password is missing', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'u@test.com' } });
            expect(res.statusCode).toBe(400);
        });

        it('returns 400 for invalid email format', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'notanemail', password: 'Password1' } });
            expect(res.statusCode).toBe(400);
            expect(JSON.parse(res.body).message).toMatch(/email/i);
        });

        it('returns 400 for weak password', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'u@test.com', password: 'weak' } });
            expect(res.statusCode).toBe(400);
        });

        it('returns 409 when user already exists', async () => {
            vi.mocked(userExists).mockReturnValue(true);
            const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'existing@test.com', password: 'TestPassword123!' } });
            expect(res.statusCode).toBe(409);
            expect(JSON.parse(res.body).message).toMatch(/already exists/i);
        });

        it('returns 200 on successful registration', async () => {
            vi.mocked(userExists).mockReturnValue(false);
            vi.mocked(createUser).mockReturnValue(undefined);
            const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'new@test.com', password: 'TestPassword123!' } });
            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.body).success).toBe(true);
        });
    });

    describe('POST /api/auth/login', () => {
        it('returns 401 for invalid credentials', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'u@test.com', password: 'Wrong1' } });
            expect(res.statusCode).toBe(401);
        });
    });

    describe('GET /api/auth/auth-url/:platform', () => {
        it('returns 400 for unsupported platform', async () => {
            const res = await app.inject({ method: 'GET', url: '/api/auth/auth-url/tiktok' });
            expect(res.statusCode).toBe(400);
        });

        it('returns auth URL for a valid platform', async () => {
            const res = await app.inject({ method: 'GET', url: '/api/auth/auth-url/instagram' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.success).toBe(true);
            expect(body.authUrl).toContain('http');
        });
    });

    describe('GET /api/auth/check-platform/:platform', () => {
        it('returns 400 for unsupported platform', async () => {
            const res = await app.inject({ method: 'GET', url: '/api/auth/check-platform/tiktok' });
            expect(res.statusCode).toBe(400);
        });

        it('returns isLoggedIn: false for a valid platform', async () => {
            const res = await app.inject({ method: 'GET', url: '/api/auth/check-platform/instagram' });
            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.body).isLoggedIn).toBe(false);
        });
    });

    describe('POST /api/auth/connect/:platform', () => {
        it('returns 400 for unsupported platform', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/auth/connect/tiktok', payload: { code: 'abc' } });
            expect(res.statusCode).toBe(400);
        });

        it('returns 400 for missing code', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/auth/connect/instagram', payload: {} });
            expect(res.statusCode).toBe(400);
        });

        it('returns platform info on success', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/auth/connect/instagram', payload: { code: 'valid-code' } });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.success).toBe(true);
            expect(body.platform.isConnected).toBe(true);
        });
    });

    describe('POST /api/auth/disconnect/:platform', () => {
        it('returns 400 for unsupported platform', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/auth/disconnect/tiktok' });
            expect(res.statusCode).toBe(400);
        });

        it('returns success for valid platform', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/auth/disconnect/instagram' });
            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.body).success).toBe(true);
        });
    });

    describe('GET /api/auth/callback/:platform', () => {
        it('returns 400 for invalid platform', async () => {
            const res = await app.inject({ method: 'GET', url: '/api/auth/callback/tiktok?code=abc&state=xyz' });
            expect(res.statusCode).toBe(400);
        });

        it('returns 403 for invalid OAuth state', async () => {
            const res = await app.inject({ method: 'GET', url: '/api/auth/callback/instagram?code=abc&state=bad-state' });
            expect(res.statusCode).toBe(403);
        });
    });
});

describe('User Routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => { app = await buildApp(); });
    afterAll(async () => { await app.close(); });
    beforeEach(() => { vi.clearAllMocks(); });

    describe('POST /api/user/signup', () => {
        it('returns 410 for all requests (deprecated endpoint)', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/user/signup', payload: { email: 'test@test.com', password: 'Password1' } });
            expect(res.statusCode).toBe(410);
            const body = JSON.parse(res.body);
            expect(body.message).toMatch(/deprecated|use.*register/i);
        });

        it('returns 410 for missing fields (deprecated endpoint)', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/user/signup', payload: {} });
            expect(res.statusCode).toBe(410);
        });

        it('returns 410 for invalid email (deprecated endpoint)', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/user/signup', payload: { email: 'bad', password: 'Password1' } });
            expect(res.statusCode).toBe(410);
        });
    });

    describe('POST /api/user/log', () => {
        it('returns 400 for invalid type', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/user/log', payload: { type: 'document', status: 'attempt', ageConsent: true } });
            expect(res.statusCode).toBe(400);
            expect(JSON.parse(res.body).message).toMatch(/type/i);
        });

        it('returns 400 for invalid status', async () => {
            const res = await app.inject({ method: 'POST', url: '/api/user/log', payload: { type: 'video', status: 'pending', ageConsent: true } });
            expect(res.statusCode).toBe(400);
            expect(JSON.parse(res.body).message).toMatch(/status/i);
        });

        it('returns 200 for valid log entry', async () => {
            vi.mocked(logDownload).mockReturnValue(undefined);
            const res = await app.inject({
                method: 'POST', url: '/api/user/log',
                payload: { type: 'video', status: 'attempt', meta: { url: 'https://youtube.com/watch?v=abc' }, ageConsent: true }
            });
            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.body).success).toBe(true);
        });

        it('returns 200 for consent log without email', async () => {
            vi.mocked(logDownload).mockReturnValue(undefined);
            const res = await app.inject({
                method: 'POST', url: '/api/user/log',
                payload: { type: 'video', status: 'consent', meta: {}, ageConsent: true }
            });
            expect(res.statusCode).toBe(200);
        });

        it('returns 400 for oversized meta', async () => {
            const bigMeta = { data: 'x'.repeat(11000) };
            const res = await app.inject({
                method: 'POST', url: '/api/user/log',
                payload: { type: 'video', status: 'attempt', meta: bigMeta, ageConsent: true }
            });
            expect(res.statusCode).toBe(400);
            expect(JSON.parse(res.body).message).toMatch(/too large/i);
        });
    });

    describe('GET /api/user/profile', () => {
        it('returns 401 without JWT', async () => {
            const res = await app.inject({ method: 'GET', url: '/api/user/profile' });
            expect(res.statusCode).toBe(401);
        });

        it('returns profile with valid JWT', async () => {
            const hash = await bcrypt.hash('Password1', 10);
            vi.mocked(getUser).mockReturnValue({
                email: 'u@test.com', password: hash, created_at: Date.now(),
                role: 'user', is_blocked: 0, monthly_downloads: 0, month_reset_at: 0, is_verified: 1, verification_code: null, verification_expires: null
            });
            vi.mocked(getUserDownloads).mockReturnValue([]);

            const token = app.jwt.sign({ userId: 'u@test.com', email: 'u@test.com', role: 'user' });
            const res = await app.inject({
                method: 'GET', url: '/api/user/profile',
                headers: { authorization: `Bearer ${token}` }
            });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.email).toBe('u@test.com');
        });
    });
});
