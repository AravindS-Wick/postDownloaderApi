/**
 * Tests for validation utilities (formerly downloader.service.test.ts)
 * The old DownloaderService was removed; these tests cover the validation
 * and password-strength logic that all routes depend on.
 */
import { describe, it, expect } from 'vitest';
import { validatePasswordStrength, VALID_DOWNLOAD_TYPES, VALID_LOG_STATUSES, MAX_META_SIZE } from '../utils/validation.js';

describe('validatePasswordStrength', () => {
    it('rejects passwords shorter than 8 characters', () => {
        expect(validatePasswordStrength('Ab1')).toEqual({ valid: false, error: expect.stringContaining('8') });
    });

    it('rejects passwords with no uppercase letter', () => {
        expect(validatePasswordStrength('password1')).toEqual({ valid: false, error: expect.stringContaining('uppercase') });
    });

    it('rejects passwords with no lowercase letter', () => {
        expect(validatePasswordStrength('PASSWORD1')).toEqual({ valid: false, error: expect.stringContaining('lowercase') });
    });

    it('rejects passwords with no digit', () => {
        expect(validatePasswordStrength('Password!')).toEqual({ valid: false, error: expect.stringContaining('number') });
    });

    it('accepts a strong password', () => {
        expect(validatePasswordStrength('Password1!')).toEqual({ valid: true });
    });

    it('accepts a complex password with special chars', () => {
        expect(validatePasswordStrength('Str0ng!Pass#2024')).toEqual({ valid: true });
    });

    it('rejects non-string input', () => {
        expect(validatePasswordStrength(null as any)).toEqual({ valid: false, error: expect.any(String) });
    });
});

describe('VALID_DOWNLOAD_TYPES', () => {
    it('contains video, audio, image', () => {
        expect(VALID_DOWNLOAD_TYPES).toContain('video');
        expect(VALID_DOWNLOAD_TYPES).toContain('audio');
        expect(VALID_DOWNLOAD_TYPES).toContain('image');
    });

    it('does not contain unexpected types', () => {
        expect((VALID_DOWNLOAD_TYPES as readonly string[]).includes('document')).toBe(false);
    });
});

describe('VALID_LOG_STATUSES', () => {
    it('contains attempt, complete, consent', () => {
        expect(VALID_LOG_STATUSES).toContain('attempt');
        expect(VALID_LOG_STATUSES).toContain('complete');
        expect(VALID_LOG_STATUSES).toContain('consent');
    });
});

describe('MAX_META_SIZE', () => {
    it('is 10240 bytes (10KB)', () => {
        expect(MAX_META_SIZE).toBe(10240);
    });
});
