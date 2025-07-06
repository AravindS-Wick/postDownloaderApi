import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../services/auth.service';
import { PlatformService } from '../services/platform.service';
import type { FastifyInstance } from 'fastify';
import type { AuthConfig } from '../types/auth.types';

// Mock FastifyInstance
const mockFastify = {
    jwt: {
        sign: vi.fn().mockReturnValue('mock-token')
    }
} as unknown as FastifyInstance;

// Mock PlatformService
vi.mock('../services/platform.service', () => ({
    PlatformService: vi.fn().mockImplementation(() => ({
        getInstagramAuthUrl: vi.fn().mockResolvedValue('https://instagram.com/auth'),
        getYouTubeAuthUrl: vi.fn().mockResolvedValue('https://youtube.com/auth'),
        getTwitterAuthUrl: vi.fn().mockResolvedValue('https://twitter.com/auth'),
        getTikTokAuthUrl: vi.fn().mockResolvedValue('https://tiktok.com/auth'),
        handleInstagramCallback: vi.fn().mockResolvedValue({
            accessToken: 'instagram-token',
            expiresIn: 3600
        }),
        handleYouTubeCallback: vi.fn().mockResolvedValue({
            accessToken: 'youtube-token',
            refreshToken: 'youtube-refresh',
            expiresIn: 3600
        }),
        handleTwitterCallback: vi.fn().mockResolvedValue({
            accessToken: 'twitter-token',
            refreshToken: 'twitter-refresh',
            expiresIn: 3600
        }),
        handleTikTokCallback: vi.fn().mockResolvedValue({
            accessToken: 'tiktok-token',
            refreshToken: 'tiktok-refresh',
            expiresIn: 3600
        })
    }))
}));

describe('AuthService', () => {
    let authService: AuthService;
    const mockConfig: AuthConfig = {
        jwtSecret: 'test-secret',
        jwtExpiresIn: '1h',
        platforms: {
            instagram: {
                clientId: 'test-instagram-id',
                clientSecret: 'test-instagram-secret',
                redirectUri: 'http://localhost:5173/auth/callback/instagram',
                scope: ['basic', 'user_profile']
            },
            youtube: {
                clientId: 'test-youtube-id',
                clientSecret: 'test-youtube-secret',
                redirectUri: 'http://localhost:5173/auth/callback/youtube',
                scope: ['https://www.googleapis.com/auth/youtube.readonly']
            },
            twitter: {
                clientId: 'test-twitter-id',
                clientSecret: 'test-twitter-secret',
                redirectUri: 'http://localhost:5173/auth/callback/twitter',
                scope: ['tweet.read', 'users.read']
            },
            tiktok: {
                clientId: 'test-tiktok-id',
                clientSecret: 'test-tiktok-secret',
                redirectUri: 'http://localhost:5173/auth/callback/tiktok',
                scope: ['user.info.basic']
            }
        }
    };

    beforeEach(() => {
        authService = new AuthService(mockFastify, mockConfig);
        vi.clearAllMocks();
    });

    describe('login', () => {
        it('should return token and user profile', async () => {
            const result = await authService.login('test@example.com', 'password');
            expect(result).toEqual({
                token: 'mock-token',
                user: {
                    id: '1',
                    email: 'test@example.com',
                    name: 'Test User',
                    platforms: []
                }
            });
        });
    });

    describe('getAuthUrl', () => {
        it('should return Instagram auth URL', async () => {
            const url = await authService.getAuthUrl('instagram');
            expect(url).toBe('https://instagram.com/auth');
        });

        it('should return YouTube auth URL', async () => {
            const url = await authService.getAuthUrl('youtube');
            expect(url).toBe('https://youtube.com/auth');
        });

        it('should throw error for unsupported platform', async () => {
            await expect(authService.getAuthUrl('unsupported')).rejects.toThrow('Unsupported platform: unsupported');
        });
    });

    describe('connectPlatform', () => {
        it('should connect Instagram platform', async () => {
            const result = await authService.connectPlatform('instagram', 'test-code');
            expect(result).toEqual({
                id: 'instagram',
                name: 'Instagram',
                icon: '/instagram-icon.png',
                isConnected: true,
                accessToken: 'instagram-token',
                expiresAt: expect.any(Number)
            });
        });

        it('should connect YouTube platform', async () => {
            const result = await authService.connectPlatform('youtube', 'test-code');
            expect(result).toEqual({
                id: 'youtube',
                name: 'Youtube',
                icon: '/youtube-icon.png',
                isConnected: true,
                accessToken: 'youtube-token',
                refreshToken: 'youtube-refresh',
                expiresAt: expect.any(Number)
            });
        });

        it('should throw error for unsupported platform', async () => {
            await expect(authService.connectPlatform('unsupported', 'test-code'))
                .rejects.toThrow('Unsupported platform: unsupported');
        });
    });

    describe('checkPlatformLogin', () => {
        it('should return false for unconnected platform', async () => {
            const result = await authService.checkPlatformLogin('instagram');
            expect(result).toBe(false);
        });
    });

    describe('disconnectPlatform', () => {
        it('should disconnect platform', async () => {
            await expect(authService.disconnectPlatform('instagram')).resolves.not.toThrow();
        });
    });

    describe('getCurrentUser', () => {
        it('should return user profile', async () => {
            const result = await authService.getCurrentUser('1');
            expect(result).toEqual({
                id: '1',
                email: 'user@example.com',
                name: 'Test User',
                platforms: []
            });
        });
    });
}); 
