import fastify from 'fastify';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformService } from '../services/platform.service.js';
import type { PlatformAuthConfig } from '../types/auth.types.js';

vi.mock('axios', () => ({
    default: {
        post: vi.fn()
    }
}));

const PLATFORM_CONFIG: PlatformAuthConfig = {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://example.com/callback',
    scope: ['test:scope'],
    authUrl: 'https://example.com/auth'
};

describe('PlatformService', () => {
    const server = fastify();
    const service = new PlatformService(server);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    describe('OAuth URL builders', () => {
        it('builds Instagram authorization URL', async () => {
            const url = await service.getInstagramAuthUrl(PLATFORM_CONFIG);
            expect(url).toContain('https://api.instagram.com/oauth/authorize');
            expect(url).toContain(`client_id=${PLATFORM_CONFIG.clientId}`);
            expect(url).toContain(`redirect_uri=${encodeURIComponent(PLATFORM_CONFIG.redirectUri)}`);
        });

        it('builds YouTube authorization URL', async () => {
            const url = await service.getYouTubeAuthUrl(PLATFORM_CONFIG);
            expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
            expect(url).toContain(`client_id=${PLATFORM_CONFIG.clientId}`);
        });

        it('builds Twitter authorization URL', async () => {
            const url = await service.getTwitterAuthUrl(PLATFORM_CONFIG);
            expect(url).toContain('https://twitter.com/i/oauth2/authorize');
            expect(url).toContain(`client_id=${PLATFORM_CONFIG.clientId}`);
        });

        it('builds TikTok authorization URL', async () => {
            const url = await service.getTikTokAuthUrl(PLATFORM_CONFIG);
            expect(url).toContain('https://www.tiktok.com/auth/authorize');
            expect(url).toContain(`client_key=${PLATFORM_CONFIG.clientId}`);
        });
    });

    describe('callback handlers', () => {
        it('handles Instagram callback', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    access_token: 'access',
                    expires_in: 3600
                })
            } as any));

            const result = await service.handleInstagramCallback('code', PLATFORM_CONFIG);
            expect(result).toEqual({
                accessToken: 'access',
                expiresIn: 3600
            });
        });

        it('handles YouTube callback', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    access_token: 'yt-access',
                    refresh_token: 'yt-refresh',
                    expires_in: 3600
                })
            } as any));

            const result = await service.handleYouTubeCallback('code', PLATFORM_CONFIG);
            expect(result).toEqual({
                accessToken: 'yt-access',
                refreshToken: 'yt-refresh',
                expiresIn: 3600
            });
        });

        it('handles Twitter callback', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    access_token: 'tw-access',
                    refresh_token: 'tw-refresh',
                    expires_in: 7200
                })
            } as any));

            const result = await service.handleTwitterCallback('code', PLATFORM_CONFIG);
            expect(result).toEqual({
                accessToken: 'tw-access',
                refreshToken: 'tw-refresh',
                expiresIn: 7200
            });
        });

        it('handles TikTok callback', async () => {
            const mockedPost = vi.mocked((axios as any).post, true);
            mockedPost.mockResolvedValueOnce({
                data: {
                    access_token: 'tk-access',
                    refresh_token: 'tk-refresh',
                    expires_in: 3600
                }
            });

            const result = await service.handleTikTokCallback('code', PLATFORM_CONFIG);
            expect(result).toEqual({
                accessToken: 'tk-access',
                refreshToken: 'tk-refresh',
                expiresIn: 3600
            });
            expect(mockedPost).toHaveBeenCalled();
        });
    });
});
