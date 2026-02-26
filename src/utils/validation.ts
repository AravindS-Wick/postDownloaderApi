export const VALID_DOWNLOAD_TYPES = ['video', 'audio', 'image'] as const;
export const VALID_LOG_STATUSES = ['attempt', 'complete', 'consent'] as const;
export const MAX_META_SIZE = 10240; // 10KB

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
        return { valid: false, error: 'Password must contain at least one digit' };
    }
    return { valid: true };
}
