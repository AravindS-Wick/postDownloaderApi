/**
 * URL detection & normalisation tests.
 * Uses the exact URLs from the project brief:
 *   - https://youtu.be/MaMswoJy9bg?si=nrVLIeLdkPDsCRP9
 *   - https://youtube.com/shorts/j1lKMiA9Ofg?si=VlntNHusqhdX128X
 *   - https://www.instagram.com/reel/DQj3Ba5iPgo/?utm_source=ig_web_copy_link
 *   - https://x.com/ZohranKMamdani/status/1985899742044262838
 */
import { describe, it, expect } from 'vitest';
import { isYouTubeUrl, normalizeYouTubeUrl } from '../utils/download-utils.js';

// ── Helpers that mirror what the API does to classify URLs ───────────────────
function detectPlatform(url: string): 'youtube' | 'instagram' | 'twitter' | 'unknown' {
    if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
    if (/instagram\.com/i.test(url)) return 'instagram';
    if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
    return 'unknown';
}

function extractYouTubeVideoId(url: string): string | null {
    try {
        const parsed = new URL(normalizeYouTubeUrl(url));
        return parsed.searchParams.get('v');
    } catch {
        return null;
    }
}

function extractInstagramPostId(url: string): string | null {
    const m = url.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
}

function extractTwitterStatusId(url: string): string | null {
    const m = url.match(/(?:twitter|x)\.com\/\S+\/status\/(\d+)/);
    return m ? m[1] : null;
}

// ── isYouTubeUrl ─────────────────────────────────────────────────────────────
describe('isYouTubeUrl', () => {
    it('recognises youtu.be short link', () => {
        expect(isYouTubeUrl('https://youtu.be/MaMswoJy9bg?si=nrVLIeLdkPDsCRP9')).toBe(true);
    });

    it('recognises youtube.com/shorts', () => {
        expect(isYouTubeUrl('https://youtube.com/shorts/j1lKMiA9Ofg?si=VlntNHusqhdX128X')).toBe(true);
    });

    it('recognises www.youtube.com/watch', () => {
        expect(isYouTubeUrl('https://www.youtube.com/watch?v=MaMswoJy9bg')).toBe(true);
    });

    it('rejects instagram URL', () => {
        expect(isYouTubeUrl('https://www.instagram.com/reel/DQj3Ba5iPgo/')).toBe(false);
    });

    it('rejects x.com URL', () => {
        expect(isYouTubeUrl('https://x.com/ZohranKMamdani/status/1985899742044262838')).toBe(false);
    });
});

// ── normalizeYouTubeUrl ──────────────────────────────────────────────────────
describe('normalizeYouTubeUrl', () => {
    it('converts youtu.be to youtube.com/watch', () => {
        const normalized = normalizeYouTubeUrl('https://youtu.be/MaMswoJy9bg?si=nrVLIeLdkPDsCRP9');
        expect(normalized).toContain('youtube.com/watch');
        expect(normalized).toContain('v=MaMswoJy9bg');
    });

    it('preserves youtube.com/watch URLs', () => {
        const url = 'https://www.youtube.com/watch?v=MaMswoJy9bg';
        expect(normalizeYouTubeUrl(url)).toContain('v=MaMswoJy9bg');
    });

    it('handles Shorts URL (no normalisation needed)', () => {
        const url = 'https://youtube.com/shorts/j1lKMiA9Ofg?si=VlntNHusqhdX128X';
        expect(normalizeYouTubeUrl(url)).toContain('shorts/j1lKMiA9Ofg');
    });

    it('returns raw string for unparseable input', () => {
        expect(normalizeYouTubeUrl('not-a-url')).toBe('not-a-url');
    });
});

// ── Platform detection ───────────────────────────────────────────────────────
describe('detectPlatform', () => {
    it('detects youtu.be as youtube', () => {
        expect(detectPlatform('https://youtu.be/MaMswoJy9bg?si=nrVLIeLdkPDsCRP9')).toBe('youtube');
    });

    it('detects YouTube Shorts as youtube', () => {
        expect(detectPlatform('https://youtube.com/shorts/j1lKMiA9Ofg?si=VlntNHusqhdX128X')).toBe('youtube');
    });

    it('detects Instagram reel as instagram', () => {
        expect(detectPlatform('https://www.instagram.com/reel/DQj3Ba5iPgo/?utm_source=ig_web_copy_link')).toBe('instagram');
    });

    it('detects x.com/status as twitter', () => {
        expect(detectPlatform('https://x.com/ZohranKMamdani/status/1985899742044262838')).toBe('twitter');
    });

    it('detects twitter.com/status as twitter', () => {
        expect(detectPlatform('https://twitter.com/user/status/12345')).toBe('twitter');
    });

    it('returns unknown for unrelated URLs', () => {
        expect(detectPlatform('https://example.com/video')).toBe('unknown');
        expect(detectPlatform('https://tiktok.com/@user/video/12345')).toBe('unknown');
    });
});

// ── ID extraction ────────────────────────────────────────────────────────────
describe('extractYouTubeVideoId', () => {
    it('extracts ID from youtu.be link', () => {
        expect(extractYouTubeVideoId('https://youtu.be/MaMswoJy9bg?si=nrVLIeLdkPDsCRP9')).toBe('MaMswoJy9bg');
    });

    it('extracts ID from youtube.com/watch', () => {
        expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=MaMswoJy9bg')).toBe('MaMswoJy9bg');
    });

    it('returns null for non-watch YouTube URL (Shorts)', () => {
        // Shorts have a path-based ID, not ?v= param
        expect(extractYouTubeVideoId('https://youtube.com/shorts/j1lKMiA9Ofg')).toBeNull();
    });
});

describe('extractInstagramPostId', () => {
    it('extracts ID from reel URL', () => {
        expect(extractInstagramPostId('https://www.instagram.com/reel/DQj3Ba5iPgo/?utm_source=ig_web_copy_link'))
            .toBe('DQj3Ba5iPgo');
    });

    it('extracts ID from post URL', () => {
        expect(extractInstagramPostId('https://www.instagram.com/p/DQj3Ba5iPgo/')).toBe('DQj3Ba5iPgo');
    });

    it('returns null for non-instagram URL', () => {
        expect(extractInstagramPostId('https://youtube.com/watch?v=abc')).toBeNull();
    });
});

describe('extractTwitterStatusId', () => {
    it('extracts status ID from x.com URL', () => {
        expect(extractTwitterStatusId('https://x.com/ZohranKMamdani/status/1985899742044262838'))
            .toBe('1985899742044262838');
    });

    it('extracts status ID from twitter.com URL', () => {
        expect(extractTwitterStatusId('https://twitter.com/user/status/12345')).toBe('12345');
    });

    it('returns null for non-status URL', () => {
        expect(extractTwitterStatusId('https://x.com/home')).toBeNull();
    });
});

// ── Full-stack URL pipeline ──────────────────────────────────────────────────
describe('Full URL pipeline (detect → normalise → extract)', () => {
    const cases = [
        {
            label: 'YouTube youtu.be link',
            url: 'https://youtu.be/MaMswoJy9bg?si=nrVLIeLdkPDsCRP9',
            platform: 'youtube' as const,
            id: 'MaMswoJy9bg',
        },
        {
            label: 'YouTube Shorts',
            url: 'https://youtube.com/shorts/j1lKMiA9Ofg?si=VlntNHusqhdX128X',
            platform: 'youtube' as const,
            id: null, // Shorts use path-based ID, not ?v=
        },
        {
            label: 'Instagram reel',
            url: 'https://www.instagram.com/reel/DQj3Ba5iPgo/?utm_source=ig_web_copy_link',
            platform: 'instagram' as const,
            id: 'DQj3Ba5iPgo',
        },
        {
            label: 'Twitter/X status',
            url: 'https://x.com/ZohranKMamdani/status/1985899742044262838',
            platform: 'twitter' as const,
            id: '1985899742044262838',
        },
    ];

    for (const { label, url, platform, id } of cases) {
        it(`handles ${label}`, () => {
            expect(detectPlatform(url)).toBe(platform);

            if (platform === 'youtube') {
                expect(isYouTubeUrl(url)).toBe(true);
                const extracted = extractYouTubeVideoId(url);
                expect(extracted).toBe(id);
            } else if (platform === 'instagram') {
                expect(extractInstagramPostId(url)).toBe(id);
            } else if (platform === 'twitter') {
                expect(extractTwitterStatusId(url)).toBe(id);
            }
        });
    }
});
