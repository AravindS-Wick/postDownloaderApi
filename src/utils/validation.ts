export const VALID_DOWNLOAD_TYPES = ['video', 'audio', 'image'] as const;
export const VALID_LOG_STATUSES = ['attempt', 'complete', 'consent'] as const;
export const MAX_META_SIZE = 10240; // 10KB

// RFC 5322-based email regex — rejects obvious junk like "a@b", "test@", "@test.com"
const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

export function validateEmail(email: unknown): { valid: boolean; error?: string } {
    if (typeof email !== 'string') {
        return { valid: false, error: 'Email is required' };
    }
    const trimmed = email.trim();
    if (!trimmed) {
        return { valid: false, error: 'Email is required' };
    }
    if (trimmed.length > 255) {
        return { valid: false, error: 'Email is too long' };
    }
    if (!EMAIL_REGEX.test(trimmed)) {
        return { valid: false, error: 'Enter a valid email address (e.g. you@example.com)' };
    }
    return { valid: true };
}

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
    if (typeof password !== 'string' || password.length < 8) {
        return { valid: false, error: 'Password must be at least 8 characters' };
    }
    if (!/[A-Z]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one uppercase letter' };
    }
    if (!/[a-z]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one lowercase letter' };
    }
    if (!/\d/.test(password)) {
        return { valid: false, error: 'Password must contain at least one number' };
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one special character (!@#$%...)' };
    }
    return { valid: true };
}
