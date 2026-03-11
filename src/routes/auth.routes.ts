import type { FastifyInstance } from 'fastify';
import { createAuthService } from '../services/auth.service.js';
import { authConfig } from '../config/auth.config.js';
import { isValidPlatform, validateOAuthState } from '../services/platform.service.js';
import type { JwtPayload } from '../types/auth.types.js';
import bcrypt from 'bcryptjs';
import { getUser, createUser, userExists } from '../db/database.js';
import { validatePasswordStrength } from '../utils/validation.js';

export async function authRoutes(fastify: FastifyInstance) {
    const authService = createAuthService(fastify);

    // Register route (UI calls POST /api/auth/register)
    fastify.post<{ Body: { email: string; password: string; username?: string } }>('/register', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const { email, password } = request.body;
        if (!email || !password) {
            return reply.code(400).send({ success: false, message: 'Email and password required' });
        }
        if (typeof email !== 'string' || email.length > 255 || !email.includes('@')) {
            return reply.code(400).send({ success: false, message: 'Invalid email format' });
        }
        const pwCheck = validatePasswordStrength(password);
        if (!pwCheck.valid) {
            return reply.code(400).send({ success: false, message: pwCheck.error });
        }
        try {
            if (userExists(email)) {
                return reply.code(409).send({ success: false, message: 'User already exists' });
            }
            const hash = await bcrypt.hash(password, 10);
            createUser(email, hash);
            return reply.send({ success: true });
        } catch (error) {
            console.error('Register error:', error);
            return reply.code(500).send({ success: false, message: 'Internal server error' });
        }
    });

    // Login route
    fastify.post<{ Body: { email: string; password: string } }>('/login', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const { email, password } = request.body;
        try {
            const { token, user } = await authService.login(email, password);
            return { success: true, token, user };
        } catch (error) {
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

    // Token refresh — issues a new JWT with fresh role from DB
    fastify.post('/refresh', async (request, reply) => {
        try {
            await request.jwtVerify();
            const { userId, email } = request.user as JwtPayload;

            const user = getUser(email);
            if (!user) {
                return reply.code(401).send({ success: false, error: 'User not found' });
            }

            if (user.is_blocked) {
                return reply.code(403).send({ success: false, error: 'Your account has been blocked' });
            }

            // Re-read role from DB so any role changes take effect immediately on next refresh
            const newToken = fastify.jwt.sign({ userId, email, role: user.role } as JwtPayload);
            return { success: true, token: newToken };
        } catch {
            return reply.code(401).send({ success: false, error: 'Invalid or expired token' });
        }
    });

    // Get platform auth URL
    fastify.get<{ Params: { platform: string } }>('/auth-url/:platform', async (request, reply) => {
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
    fastify.get<{ Params: { platform: string } }>('/check-platform/:platform', async (request, reply) => {
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
    fastify.post<{ Params: { platform: string }; Body: { code: string } }>('/connect/:platform', async (request, reply) => {
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
    fastify.post<{ Params: { platform: string } }>('/disconnect/:platform', async (request, reply) => {
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
    fastify.get('/me', async (request, reply) => {
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
