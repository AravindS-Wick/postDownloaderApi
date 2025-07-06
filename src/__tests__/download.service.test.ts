import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DownloadService } from '../services/download.service';
import { PlatformService } from '../services/platform.service';

vi.mock('../services/platform.service', () => ({
    PlatformService: {
        getInstagramMedia: vi.fn(),
        getYouTubeVideo: vi.fn(),
        getTwitterMedia: vi.fn(),
        getTikTokVideo: vi.fn()
    }
}));

describe('DownloadService', () => {
    let downloadService: DownloadService;
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
        downloadService = new DownloadService(platformService);
    });

    describe('downloadMedia', () => {
        it('should download Instagram media', async () => {
            const mockMedia = {
                url: 'https://instagram.com/media/123',
                type: 'image',
                title: 'Test Post'
            };

            (PlatformService.getInstagramMedia as jest.Mock).mockResolvedValue(mockMedia);

            const result = await downloadService.downloadMedia('https://instagram.com/p/123');
            expect(result).toEqual(mockMedia);
            expect(PlatformService.getInstagramMedia).toHaveBeenCalledWith('123');
        });

        it('should download YouTube video', async () => {
            const mockVideo = {
                url: 'https://youtube.com/watch?v=123',
                type: 'video',
                title: 'Test Video'
            };

            (PlatformService.getYouTubeVideo as jest.Mock).mockResolvedValue(mockVideo);

            const result = await downloadService.downloadMedia('https://youtube.com/watch?v=123');
            expect(result).toEqual(mockVideo);
            expect(PlatformService.getYouTubeVideo).toHaveBeenCalledWith('123');
        });

        it('should download Twitter media', async () => {
            const mockMedia = {
                url: 'https://twitter.com/status/123',
                type: 'image',
                title: 'Test Tweet'
            };

            (PlatformService.getTwitterMedia as jest.Mock).mockResolvedValue(mockMedia);

            const result = await downloadService.downloadMedia('https://twitter.com/status/123');
            expect(result).toEqual(mockMedia);
            expect(PlatformService.getTwitterMedia).toHaveBeenCalledWith('123');
        });

        it('should download TikTok video', async () => {
            const mockVideo = {
                url: 'https://tiktok.com/@user/video/123',
                type: 'video',
                title: 'Test TikTok'
            };

            (PlatformService.getTikTokVideo as jest.Mock).mockResolvedValue(mockVideo);

            const result = await downloadService.downloadMedia('https://tiktok.com/@user/video/123');
            expect(result).toEqual(mockVideo);
            expect(PlatformService.getTikTokVideo).toHaveBeenCalledWith('123');
        });

        it('should throw error for unsupported URL', async () => {
            await expect(downloadService.downloadMedia('https://unsupported.com/123'))
                .rejects
                .toThrow('Unsupported URL format');
        });

        it('should handle download errors', async () => {
            const error = new Error('Download failed');
            (PlatformService.getInstagramMedia as jest.Mock).mockRejectedValue(error);

            await expect(downloadService.downloadMedia('https://instagram.com/p/123'))
                .rejects
                .toThrow('Download failed');
        });
    });
}); 
