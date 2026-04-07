import type { FastifyInstance } from 'fastify';
import { createAuthService } from '../services/auth.service.js';
import { authConfig } from '../config/auth.config.js';
import { isValidPlatform, validateOAuthState } from '../services/platform.service.js';
import type { JwtPayload } from '../types/auth.types.js';
import bcrypt from 'bcryptjs';
import { getUser, createUser, userExists, setVerificationCode, markEmailVerified, updatePassword, revokeAllUserRefreshTokens, setPasswordResetToken, validatePasswordResetToken, clearPasswordResetToken } from '../db/database.js';
import { validatePasswordStrength, validateEmail, normalizeEmail } from '../utils/validation.js';
import { generateVerificationCode, sendVerificationEmail } from '../services/email.service.js';

export async function authRoutes(fastify: FastifyInstance) {
    const authService = createAuthService(fastify);

    // Register route (UI calls POST /api/auth/register)
    fastify.post<{ Body: { email: string; password: string; username?: string } }>('/register', {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const { email: rawEmail, password } = request.body;

        const emailCheck = validateEmail(rawEmail);
        if (!emailCheck.valid) {
            return reply.code(400).send({ success: false, message: emailCheck.error });
        }
        if (!password) {
            return reply.code(400).send({ success: false, message: 'Password is required' });
        }

        const pwCheck = validatePasswordStrength(password);
        if (!pwCheck.valid) {
            return reply.code(400).send({ success: false, message: pwCheck.error });
        }

        const email = normalizeEmail(rawEmail);

        try {
            if (userExists(email)) {
                // Generic message — avoids leaking which emails are registered
                return reply.code(409).send({ success: false, message: 'An account with that email already exists or the email is unavailable' });
            }
            const hash = await bcrypt.hash(password, 12);
            createUser(email, hash);

            // Generate and send verification code
            const code = generateVerificationCode();
            const expiresAt = Date.now() + authConfig.verificationCodeExpiresIn;
            setVerificationCode(email, code, expiresAt);

            try {
                await sendVerificationEmail(email, code);
            } catch (emailErr) {
                console.error('Failed to send verification email:', emailErr);
            }

            return reply.send({ success: true, message: 'Account created. Please check your email for a verification code.' });
        } catch (error) {
            console.error('Register error:', error);
            return reply.code(500).send({ success: false, message: 'Internal server error' });
        }
    });

    // Login route
    fastify.post<{ Body: { email: string; password: string } }>('/login', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const { email: rawEmail, password } = request.body;
        const email = normalizeEmail(rawEmail ?? '');
        try {
            const { token, refreshToken, user } = await authService.login(email, password);
            return { success: true, token, refreshToken, user };
        } catch (error: any) {
            if (error?.message === 'EMAIL_NOT_VERIFIED') {
                return reply.code(403).send({ success: false, error: 'Please verify your email before logging in', code: 'EMAIL_NOT_VERIFIED' });
            }
            request.log.warn({
                event: 'auth_failure',
                email,
                ip: request.ip,
                timestamp: new Date().toISOString(),
            }, 'Failed login attempt');
            reply.code(401);
            return { success: false, error: 'Invalid credentials' };
        }
    });

    // Token refresh — uses refresh token (not JWT), rotates tokens
    fastify.post<{ Body: { refreshToken: string } }>('/refresh', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const { refreshToken } = request.body;
        if (!refreshToken) {
            return reply.code(400).send({ success: false, error: 'Refresh token is required' });
        }
        try {
            const result = await authService.refreshAccessToken(refreshToken);
            return { success: true, token: result.token, refreshToken: result.refreshToken };
        } catch {
            return reply.code(401).send({ success: false, error: 'Invalid or expired refresh token' });
        }
    });

    // Verify email
    fastify.post<{ Body: { email: string; code: string } }>('/verify', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const { email: rawEmail, code } = request.body;
        if (!rawEmail || !code) {
            return reply.code(400).send({ success: false, message: 'Email and code are required' });
        }

        const email = normalizeEmail(rawEmail);
        const user = getUser(email);

        if (!user) {
            return reply.code(400).send({ success: false, message: 'Invalid verification request' });
        }
        if (user.is_verified) {
            return reply.send({ success: true, message: 'Email already verified' });
        }
        if (!user.verification_code || !user.verification_expires) {
            return reply.code(400).send({ success: false, message: 'No verification code found. Request a new one.' });
        }
        if (Date.now() > user.verification_expires) {
            return reply.code(400).send({ success: false, message: 'Verification code expired. Request a new one.' });
        }
        if (user.verification_code !== code) {
            return reply.code(400).send({ success: false, message: 'Invalid verification code' });
        }

        markEmailVerified(email);
        return reply.send({ success: true, message: 'Email verified successfully' });
    });

    // Resend verification code
    fastify.post<{ Body: { email: string } }>('/resend-verification', {
        config: { rateLimit: { max: 3, timeWindow: '5 minutes' } }
    }, async (request, reply) => {
        const { email: rawEmail } = request.body;
        if (!rawEmail) {
            return reply.code(400).send({ success: false, message: 'Email is required' });
        }

        const email = normalizeEmail(rawEmail);
        const user = getUser(email);

        // Generic response to prevent email enumeration
        if (!user || user.is_verified) {
            return reply.send({ success: true, message: 'If an unverified account exists, a new code has been sent.' });
        }

        const code = generateVerificationCode();
        const expiresAt = Date.now() + authConfig.verificationCodeExpiresIn;
        setVerificationCode(email, code, expiresAt);

        try {
            await sendVerificationEmail(email, code);
        } catch (emailErr) {
            console.error('Failed to send verification email:', emailErr);
        }

        return reply.send({ success: true, message: 'If an unverified account exists, a new code has been sent.' });
    });

    // Logout — revoke all refresh tokens
    fastify.post('/logout', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        try {
            await request.jwtVerify();
            const { email } = request.user as JwtPayload;
            await authService.logoutUser(email);
            return { success: true, message: 'Logged out successfully' };
        } catch {
            // Even if JWT is expired, return success — client should clear tokens
            return { success: true, message: 'Logged out' };
        }
    });

    // Change password
    fastify.post<{ Body: { oldPassword: string; newPassword: string } }>('/change-password', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        try {
            await request.jwtVerify();
            const { email } = request.user as JwtPayload;
            const { oldPassword, newPassword } = request.body;

            // Validate inputs
            if (!oldPassword || !newPassword) {
                return reply.code(400).send({ success: false, message: 'Old password and new password are required' });
            }

            if (oldPassword === newPassword) {
                return reply.code(400).send({ success: false, message: 'New password must be different from old password' });
            }

            // Validate new password strength
            const pwCheck = validatePasswordStrength(newPassword);
            if (!pwCheck.valid) {
                return reply.code(400).send({ success: false, message: pwCheck.error });
            }

            // Get user
            const user = getUser(email);
            if (!user) {
                return reply.code(401).send({ success: false, message: 'User not found' });
            }

            // Verify old password
            const passwordMatch = await bcrypt.compare(oldPassword, user.password);
            if (!passwordMatch) {
                return reply.code(401).send({ success: false, message: 'Current password is incorrect' });
            }

            // Hash new password and update
            const newHash = await bcrypt.hash(newPassword, 12);
            updatePassword(email, newHash);

            // Revoke all refresh tokens (force re-login)
            revokeAllUserRefreshTokens(email);

            return reply.send({ success: true, message: 'Password changed successfully. Please log in again.' });
        } catch (error) {
            console.error('Change password error:', error);
            return reply.code(500).send({ success: false, message: 'Failed to change password' });
        }
    });

    // Forgot password — request reset token
    fastify.post<{ Body: { email: string } }>('/forgot-password', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        try {
            const { email: rawEmail } = request.body;

            if (!rawEmail) {
                return reply.code(400).send({ success: false, message: 'Email is required' });
            }

            const email = normalizeEmail(rawEmail);
            const user = getUser(email);

            if (!user) {
                // Generic message — avoid leaking which emails exist
                return reply.send({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
            }

            // Generate reset token (8 alphanumeric characters)
            const resetToken = Math.random().toString(36).substring(2, 10).toUpperCase();
            const expiresAt = Date.now() + (15 * 60 * 1000); // 15 minutes

            setPasswordResetToken(email, resetToken, expiresAt);

            try {
                await sendVerificationEmail(email, resetToken, 'password-reset');
            } catch (emailErr) {
                console.error('Failed to send password reset email:', emailErr);
                // Don't fail — let user try again
            }

            return reply.send({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });
        } catch (error) {
            console.error('Forgot password error:', error);
            return reply.code(500).send({ success: false, message: 'Failed to process password reset request' });
        }
    });

    // Reset password — verify token and set new password
    fastify.post<{ Body: { email: string; resetToken: string; newPassword: string } }>('/reset-password', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        try {
            const { email: rawEmail, resetToken, newPassword } = request.body;

            if (!rawEmail || !resetToken || !newPassword) {
                return reply.code(400).send({ success: false, message: 'Email, reset token, and new password are required' });
            }

            const email = normalizeEmail(rawEmail);

            // Validate reset token
            if (!validatePasswordResetToken(email, resetToken)) {
                return reply.code(400).send({ success: false, message: 'Invalid or expired reset token' });
            }

            // Validate password strength
            const pwCheck = validatePasswordStrength(newPassword);
            if (!pwCheck.valid) {
                return reply.code(400).send({ success: false, message: pwCheck.error });
            }

            // Hash and update password
            const newHash = await bcrypt.hash(newPassword, 12);
            updatePassword(email, newHash);

            // Clear reset token and revoke all refresh tokens
            clearPasswordResetToken(email);
            revokeAllUserRefreshTokens(email);

            return reply.send({ success: true, message: 'Password reset successfully. Please log in with your new password.' });
        } catch (error) {
            console.error('Reset password error:', error);
            return reply.code(500).send({ success: false, message: 'Failed to reset password' });
        }
    });

    // Get platform auth URL
    fastify.get<{ Params: { platform: string } }>('/auth-url/:platform', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { platform } = request.params;

        if (!isValidPlatform(platform)) {
            reply.code(400);
            return { success: false, error: `Unsupported platform: ${platform}. Supported: instagram, youtube, twitter` };
        }

        try {
            const authUrl = await authService.getAuthUrl(platform);
            return { success: true, authUrl };
        } catch (error) {
            reply.code(400);
            return { success: false, error: 'Failed to get auth URL' };
        }
    });

    // Check platform login status
    fastify.get<{ Params: { platform: string } }>('/check-platform/:platform', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { platform } = request.params;

        if (!isValidPlatform(platform)) {
            reply.code(400);
            return { success: false, error: `Unsupported platform: ${platform}` };
        }

        try {
            const isLoggedIn = await authService.checkPlatformLogin(platform);
            return { success: true, isLoggedIn };
        } catch (error) {
            reply.code(400);
            return { success: false, error: 'Failed to check platform login status' };
        }
    });

    // Connect platform
    fastify.post<{ Params: { platform: string }; Body: { code: string } }>('/connect/:platform', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { platform } = request.params;
        const { code } = request.body;

        if (!isValidPlatform(platform)) {
            reply.code(400);
            return { success: false, error: `Unsupported platform: ${platform}` };
        }

        if (!code || typeof code !== 'string' || code.length > 2048) {
            reply.code(400);
            return { success: false, error: 'Invalid authorization code' };
        }

        try {
            const connectedPlatform = await authService.connectPlatform(platform, code);
            return { success: true, platform: connectedPlatform };
        } catch (error) {
            reply.code(400);
            return { success: false, error: 'Failed to connect platform' };
        }
    });

    // Disconnect platform
    fastify.post<{ Params: { platform: string } }>('/disconnect/:platform', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { platform } = request.params;

        if (!isValidPlatform(platform)) {
            reply.code(400);
            return { success: false, error: `Unsupported platform: ${platform}` };
        }

        try {
            await authService.disconnectPlatform(platform);
            return { success: true };
        } catch (error) {
            reply.code(400);
            return { success: false, error: 'Failed to disconnect platform' };
        }
    });

    // Get current user — requires JWT
    fastify.get('/me', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
        try {
            await request.jwtVerify();
            const { userId } = request.user as JwtPayload;
            const user = await authService.getCurrentUser(userId);
            return { success: true, user };
        } catch (error) {
            reply.code(401);
            return { success: false, error: 'Not authenticated' };
        }
    });

    // Platform OAuth callbacks — validates state parameter
    fastify.get<{ Params: { platform: string }; Querystring: { code: string; state: string } }>(
        '/callback/:platform',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        async (request, reply) => {
            const { platform } = request.params;
            const { code, state } = request.query;

            if (!isValidPlatform(platform)) {
                return reply.code(400).send({ success: false, error: 'Invalid platform' });
            }

            // Validate OAuth state to prevent CSRF
            const stateValidation = validateOAuthState(state);
            if (!stateValidation.valid) {
                return reply.code(403).send({ success: false, error: 'Invalid OAuth state. Possible CSRF attack.' });
            }

            try {
                const connectedPlatform = await authService.connectPlatform(platform, code, stateValidation.codeVerifier);
                const redirectUri = authConfig.platforms[platform]?.redirectUri;
                if (redirectUri) {
                    return reply.redirect(`${redirectUri}?success=true&platform=${platform}`);
                }
                return { success: true, platform: connectedPlatform };
            } catch (error: any) {
                const errorMessage = error?.message || 'Failed to connect platform';
                const redirectUri = authConfig.platforms[platform]?.redirectUri;
                if (redirectUri) {
                    return reply.redirect(`${redirectUri}?error=${encodeURIComponent(errorMessage)}`);
                }
                reply.code(400);
                return { success: false, error: errorMessage };
            }
        }
    );
}
