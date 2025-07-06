import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlatformService } from '../services/platform.service';

describe('PlatformService', () => {
    let platformService: PlatformService;

    beforeEach(() => {
        platformService = new PlatformService({
            instagram: {
                clientId: 'test-instagram-client-id',
                clientSecret: 'test-instagram-client-secret',
                redirectUri: 'http://localhost:3000/auth/instagram/callback'
            },
            youtube: {
                clientId: 'test-youtube-client-id',
                clientSecret: 'test-youtube-client-secret',
                redirectUri: 'http://localhost:3000/auth/youtube/callback'
            },
            twitter: {
                clientId: 'test-twitter-client-id',
                clientSecret: 'test-twitter-client-secret',
                redirectUri: 'http://localhost:3000/auth/twitter/callback'
            },
            tiktok: {
                clientId: 'test-tiktok-client-id',
                clientSecret: 'test-tiktok-client-secret',
                redirectUri: 'http://localhost:3000/auth/tiktok/callback'
            }
        });
    });

    describe('getInstagramAuthUrl', () => {
        it('should return Instagram auth URL', () => {
            const url = platformService.getInstagramAuthUrl();
            expect(url).toContain('instagram.com/oauth/authorize');
            expect(url).toContain('test-instagram-client-id');
            expect(url).toContain('http://localhost:3000/auth/instagram/callback');
        });
    });

    describe('getYouTubeAuthUrl', () => {
        it('should return YouTube auth URL', () => {
            const url = platformService.getYouTubeAuthUrl();
            expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
            expect(url).toContain('test-youtube-client-id');
            expect(url).toContain('http://localhost:3000/auth/youtube/callback');
        });
    });

    describe('getTwitterAuthUrl', () => {
        it('should return Twitter auth URL', () => {
            const url = platformService.getTwitterAuthUrl();
            expect(url).toContain('twitter.com/i/oauth2/authorize');
            expect(url).toContain('test-twitter-client-id');
            expect(url).toContain('http://localhost:3000/auth/twitter/callback');
        });
    });

    describe('getTikTokAuthUrl', () => {
        it('should return TikTok auth URL', () => {
            const url = platformService.getTikTokAuthUrl();
            expect(url).toContain('tiktok.com/auth/authorize');
            expect(url).toContain('test-tiktok-client-id');
            expect(url).toContain('http://localhost:3000/auth/tiktok/callback');
        });
    });

    describe('handleInstagramCallback', () => {
        it('should handle Instagram callback and return tokens', async () => {
            const mockResponse = {
                access_token: 'test-access-token',
                expires_in: 3600
            };

            global.fetch = vi.fn().mockResolvedValue({
                json: () => Promise.resolve(mockResponse)
            });

            const result = await platformService.handleInstagramCallback('test-code');
            expect(result).toEqual({
                accessToken: 'test-access-token',
                expiresIn: 3600
            });
        });
    });

    describe('handleYouTubeCallback', () => {
        it('should handle YouTube callback and return tokens', async () => {
            const mockResponse = {
                access_token: 'test-access-token',
                refresh_token: 'test-refresh-token',
                expires_in: 3600
            };

            global.fetch = vi.fn().mockResolvedValue({
                json: () => Promise.resolve(mockResponse)
            });

            const result = await platformService.handleYouTubeCallback('test-code');
            expect(result).toEqual({
                accessToken: 'test-access-token',
                refreshToken: 'test-refresh-token',
                expiresIn: 3600
            });
        });
    });

    describe('handleTwitterCallback', () => {
        it('should handle Twitter callback and return tokens', async () => {
            const mockResponse = {
                access_token: 'test-access-token',
                refresh_token: 'test-refresh-token',
                expires_in: 3600
            };

            global.fetch = vi.fn().mockResolvedValue({
                json: () => Promise.resolve(mockResponse)
            });

            const result = await platformService.handleTwitterCallback('test-code');
            expect(result).toEqual({
                accessToken: 'test-access-token',
                refreshToken: 'test-refresh-token',
                expiresIn: 3600
            });
        });
    });

    describe('handleTikTokCallback', () => {
        it('should handle TikTok callback and return tokens', async () => {
            const mockResponse = {
                access_token: 'test-access-token',
                refresh_token: 'test-refresh-token',
                expires_in: 3600
            };

            global.fetch = vi.fn().mockResolvedValue({
                json: () => Promise.resolve(mockResponse)
            });

            const result = await platformService.handleTikTokCallback('test-code');
            expect(result).toEqual({
                accessToken: 'test-access-token',
                refreshToken: 'test-refresh-token',
                expiresIn: 3600
            });
        });
    });
}); 
