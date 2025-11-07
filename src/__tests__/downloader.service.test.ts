import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DownloaderService from '../services/downloader.service.js';

vi.mock('googleapis', () => ({
    google: {
        youtube: () => ({
            videos: {
                list: vi.fn()
            }
        })
    }
}));

vi.mock('youtube-dl-exec', () => ({
    default: {
        create: vi.fn(() => vi.fn())
    }
}));

describe('DownloaderService', () => {
    const originalConsoleError = console.error;

    beforeEach(() => {
        console.error = vi.fn();
    });

    afterEach(() => {
        console.error = originalConsoleError;
        vi.clearAllMocks();
    });

    it('throws when YouTube URL is invalid', async () => {
        const service = new DownloaderService();
        await expect(service.downloadYouTube('https://example.com/video'))
            .rejects
            .toThrow('Invalid YouTube URL');
    });
});
