import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../services/auth.service.js';
import type { FastifyInstance } from 'fastify';

// Prevent better-sqlite3 native module from loading
vi.mock('../db/database.js', () => ({
    getUser: vi.fn(),
    createUser: vi.fn(),
    userExists: vi.fn(),
    logDownload: vi.fn(),
    getUserDownloads: vi.fn(),
    closeDatabase: vi.fn(),
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
        getTikTokAuthUrl: vi.fn().mockResolvedValue('https://tiktok.com/auth'),
        handleInstagramCallback: vi.fn().mockResolvedValue({ accessToken: 'ig-token', expiresIn: 3600 }),
        handleYouTubeCallback: vi.fn().mockResolvedValue({ accessToken: 'yt-token', refreshToken: 'yt-refresh', expiresIn: 3600 }),
        handleTwitterCallback: vi.fn().mockResolvedValue({ accessToken: 'tw-token', refreshToken: 'tw-refresh', expiresIn: 7200 }),
        handleTikTokCallback: vi.fn().mockResolvedValue({ accessToken: 'tk-token', refreshToken: 'tk-refresh', expiresIn: 3600 }),
    })),
    isValidPlatform: vi.fn(),
    validateOAuthState: vi.fn(),
}));

vi.mock('../config/auth.config.js', () => ({
    authConfig: {
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: 7 * 24 * 60 * 60 * 1000,
        verificationCodeExpiresIn: 15 * 60 * 1000,
        platforms: {
            instagram: { clientId: 'ig-id', clientSecret: 'ig-secret', redirectUri: 'http://localhost/cb', scope: [] },
            youtube: { clientId: 'yt-id', clientSecret: 'yt-secret', redirectUri: 'http://localhost/cb', scope: [] },
            twitter: { clientId: 'tw-id', clientSecret: 'tw-secret', redirectUri: 'http://localhost/cb', scope: [] },
        }
    }
}));

import bcrypt from 'bcryptjs';
import { getUser } from '../db/database.js';

const mockFastify = {
    jwt: { sign: vi.fn().mockReturnValue('mock-jwt-token') }
} as unknown as FastifyInstance;

describe('AuthService', () => {
    let service: AuthService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AuthService(mockFastify);
    });

    describe('login', () => {
        it('throws when user does not exist', async () => {
            vi.mocked(getUser).mockReturnValue(undefined);
            await expect(service.login('noone@test.com', 'pass')).rejects.toThrow('Invalid credentials');
        });

        it('throws when password is wrong', async () => {
            const hash = await bcrypt.hash('correct', 10);
            vi.mocked(getUser).mockReturnValue({
                email: 'u@test.com', password: hash, created_at: 0,
                role: 'user', is_blocked: 0, monthly_downloads: 0, month_reset_at: 0, is_verified: 1, verification_code: null, verification_expires: null
            });
            await expect(service.login('u@test.com', 'wrong')).rejects.toThrow('Invalid credentials');
        });

        it('throws when account is blocked', async () => {
            const hash = await bcrypt.hash('Password1', 10);
            vi.mocked(getUser).mockReturnValue({
                email: 'u@test.com', password: hash, created_at: 0,
                role: 'user', is_blocked: 1, monthly_downloads: 0, month_reset_at: 0, is_verified: 1, verification_code: null, verification_expires: null
            });
            await expect(service.login('u@test.com', 'Password1')).rejects.toThrow('blocked');
        });

        it('returns token and user profile on success', async () => {
            const hash = await bcrypt.hash('Password1', 10);
            vi.mocked(getUser).mockReturnValue({
                email: 'u@test.com', password: hash, created_at: 0,
                role: 'user', is_blocked: 0, monthly_downloads: 0, month_reset_at: 0, is_verified: 1, verification_code: null, verification_expires: null
            });
            const result = await service.login('u@test.com', 'Password1');
            expect(result.token).toBe('mock-jwt-token');
            expect(result.refreshToken).toBeDefined();
            expect(result.user.email).toBe('u@test.com');
            expect(result.user.role).toBe('user');
        });
    });

    describe('getAuthUrl', () => {
        it('returns Instagram auth URL', async () => {
            const url = await service.getAuthUrl('instagram');
            expect(url).toBe('https://instagram.com/auth');
        });

        it('returns YouTube auth URL', async () => {
            const url = await service.getAuthUrl('youtube');
            expect(url).toBe('https://youtube.com/auth');
        });

        it('throws for unsupported platform', async () => {
            await expect(service.getAuthUrl('tiktok')).rejects.toThrow('Unsupported platform');
        });
    });

    describe('connectPlatform', () => {
        it('connects Instagram', async () => {
            const p = await service.connectPlatform('instagram', 'code');
            expect(p.id).toBe('instagram');
            expect(p.isConnected).toBe(true);
            expect(p.accessToken).toBe('ig-token');
        });

        it('connects YouTube with refreshToken', async () => {
            const p = await service.connectPlatform('youtube', 'code');
            expect(p.refreshToken).toBe('yt-refresh');
        });

        it('throws for unsupported platform', async () => {
            await expect(service.connectPlatform('tiktok', 'code')).rejects.toThrow('Unsupported platform');
        });
    });

    describe('checkPlatformLogin', () => {
        it('returns false (not implemented yet)', async () => {
            expect(await service.checkPlatformLogin('instagram')).toBe(false);
        });
    });

    describe('getCurrentUser', () => {
        it('returns user profile when found', async () => {
            vi.mocked(getUser).mockReturnValue({
                email: 'u@test.com', password: 'hash', created_at: 0,
                role: 'user', is_blocked: 0, monthly_downloads: 0, month_reset_at: 0, is_verified: 1, verification_code: null, verification_expires: null
            });
            const user = await service.getCurrentUser('u@test.com');
            expect(user.email).toBe('u@test.com');
        });

        it('throws when user not found', async () => {
            vi.mocked(getUser).mockReturnValue(undefined);
            await expect(service.getCurrentUser('ghost@test.com')).rejects.toThrow('User not found');
        });
    });

    describe('disconnectPlatform', () => {
        it('resolves without error', async () => {
            await expect(service.disconnectPlatform('instagram')).resolves.not.toThrow();
        });
    });
});
