import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    buildDownloadFilename,
    isYouTubeUrl,
    normalizeYouTubeUrl,
    sanitizeFilenameComponent
} from '../utils/download-utils.js';

let tempDir = '';

function ensureTempDir(): string {
    if (!tempDir) {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-utils-'));
    }
    return tempDir;
}

afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        tempDir = '';
    }
});

describe('sanitizeFilenameComponent', () => {
    it('removes reserved characters and trims whitespace', () => {
        const result = sanitizeFilenameComponent('  My*Video<>  ');
        expect(result).toBe('MyVideo');
    });
});

describe('buildDownloadFilename', () => {
    it('returns unique filenames when duplicates exist', () => {
        const dir = ensureTempDir();
        const first = buildDownloadFilename(dir, 'Sample', '1080p', 'mp4');
        fs.writeFileSync(path.join(dir, first), '');
        const second = buildDownloadFilename(dir, 'Sample', '1080p', 'mp4');
        expect(second).not.toBe(first);
        expect(second).toContain('(1)');
    });
});

describe('normalizeYouTubeUrl', () => {
    it('normalizes youtu.be URLs to youtube.com', () => {
        const normalized = normalizeYouTubeUrl('https://youtu.be/abc123?t=10');
        expect(normalized).toBe('https://www.youtube.com/watch?v=abc123&t=10');
    });

    it('returns original string when parsing fails', () => {
        expect(normalizeYouTubeUrl('not-a-url')).toBe('not-a-url');
    });
});

describe('isYouTubeUrl', () => {
    it('detects YouTube domains', () => {
        expect(isYouTubeUrl('https://youtube.com/watch?v=abc')).toBe(true);
        expect(isYouTubeUrl('https://example.com')).toBe(false);
    });
});
