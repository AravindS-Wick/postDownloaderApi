import { vi } from 'vitest';

export const mockPlatformService = {
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
}; 
