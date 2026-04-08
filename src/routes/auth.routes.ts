import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createAuthService } from '../services/auth.service.js';
import { authConfig } from '../config/auth.config.js';
import { isValidPlatform, validateOAuthState } from '../services/platform.service.js';
import type { JwtPayload, UserRole } from '../types/auth.types.js';
import bcrypt from 'bcryptjs';
import db, {
    getUser, createUser, userExists, setUserRole, setUserBlocked,
    listAllUsers, clearAllDownloadLogs, getDbStats, deleteUserDownloads,
} from '../db/database.js';
import { validatePasswordStrength } from '../utils/validation.js';

// Middleware: verify JWT and enforce minimum role
// Role hierarchy: admin > owner > tester > user
const ROLE_LEVEL: Record<UserRole, number> = { admin: 4, owner: 3, tester: 2, user: 1 };

function requireRole(minRole: UserRole) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            await request.jwtVerify();
            const payload = request.user as JwtPayload;
            const userLevel = ROLE_LEVEL[payload.role] ?? 0;
            if (userLevel < ROLE_LEVEL[minRole]) {
                return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
            }
        } catch {
            return reply.code(401).send({ success: false, error: 'Authentication required' });
        }
    };
}

export async function authRoutes(fastify: FastifyInstance) {
    const authService = createAuthService(fastify);

    // ── Public: Register ──────────────────────────────────────────────────────
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
            createUser(email, hash, 'user'); // new self-registered users always get 'user' role
            return reply.send({ success: true });
        } catch (error) {
            request.log.error(error, 'Register error');
            return reply.code(500).send({ success: false, message: 'Internal server error' });
        }
    });

    // ── Public: Login ─────────────────────────────────────────────────────────
    fastify.post<{ Body: { email: string; password: string } }>('/login', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const { email, password } = request.body;
        try {
            const { token, user } = await authService.login(email, password);
            return { success: true, token, user };
        } catch (error: any) {
            request.log.warn({ event: 'auth_failure', email, ip: request.ip }, 'Failed login attempt');
            reply.code(401);
            return { success: false, error: error.message === 'Account is blocked' ? 'Account is blocked' : 'Invalid credentials' };
        }
    });

    // ── Authenticated: Token refresh ──────────────────────────────────────────
    fastify.post('/refresh', { preHandler: requireRole('user') }, async (request, reply) => {
        const { userId, email, role: _role } = request.user as JwtPayload;
        const user = getUser(email);
        if (!user) return reply.code(401).send({ success: false, error: 'User not found' });
        const newToken = fastify.jwt.sign({ userId, email, role: user.role });
        return { success: true, token: newToken };
    });

    // ── Authenticated: Get current user ───────────────────────────────────────
    fastify.get('/me', { preHandler: requireRole('user') }, async (request, reply) => {
        try {
            const { userId } = request.user as JwtPayload;
            const user = await authService.getCurrentUser(userId);
            return { success: true, user };
        } catch {
            return reply.code(401).send({ success: false, error: 'Not authenticated' });
        }
    });

    // ── Authenticated: Logout (client-side token invalidation) ───────────────
    fastify.post('/logout', { preHandler: requireRole('user') }, async () => {
        // JWT is stateless — client drops the token. Return 200 so the UI can clean up state.
        return { success: true, message: 'Logged out' };
    });

    // ── Authenticated: Change password ────────────────────────────────────────
    fastify.post<{ Body: { oldPassword: string; newPassword: string } }>('/change-password', {
        preHandler: requireRole('user'),
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const { oldPassword, newPassword } = request.body;
        const { email } = request.user as JwtPayload;
        if (!oldPassword || !newPassword) {
            return reply.code(400).send({ success: false, message: 'Old and new passwords required' });
        }
        const pwCheck = validatePasswordStrength(newPassword);
        if (!pwCheck.valid) {
            return reply.code(400).send({ success: false, message: pwCheck.error });
        }
        const user = getUser(email);
        if (!user) return reply.code(404).send({ success: false, message: 'User not found' });
        const match = await bcrypt.compare(oldPassword, user.password);
        if (!match) return reply.code(401).send({ success: false, message: 'Current password is incorrect' });
        const hash = await bcrypt.hash(newPassword, 10);
        db.prepare('UPDATE users SET password = ? WHERE email = ?').run(hash, email);
        return { success: true, message: 'Password changed successfully' };
    });

    // ── Authenticated: Forgot / Reset password ────────────────────────────────
    fastify.post<{ Body: { email: string } }>('/forgot-password', {
        config: { rateLimit: { max: 3, timeWindow: '1 minute' } }
    }, async () => {
        // Generic response to prevent email enumeration
        return { success: true, message: 'If an account with that email exists, a reset token has been sent.' };
    });

    fastify.post<{ Body: { email: string; resetToken: string; newPassword: string } }>('/reset-password', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    }, async (_request, reply) => {
        return reply.code(501).send({ success: false, message: 'Reset via email not yet configured. Use change-password.' });
    });

    // ── Admin: List all users ─────────────────────────────────────────────────
    fastify.get('/admin/users', { preHandler: requireRole('admin') }, async () => {
        return { success: true, users: listAllUsers() };
    });

    // ── Admin: Set user role ──────────────────────────────────────────────────
    fastify.post<{ Body: { email: string; role: UserRole } }>('/admin/users/role', {
        preHandler: requireRole('admin')
    }, async (request, reply) => {
        const { email, role } = request.body;
        const validRoles: UserRole[] = ['admin', 'owner', 'tester', 'user'];
        if (!email || !validRoles.includes(role)) {
            return reply.code(400).send({ success: false, message: 'Valid email and role required' });
        }
        if (!userExists(email)) {
            return reply.code(404).send({ success: false, message: 'User not found' });
        }
        setUserRole(email, role);
        return { success: true, message: `Role updated to ${role} for ${email}` };
    });

    // ── Admin: Block / Unblock user ───────────────────────────────────────────
    fastify.post<{ Body: { email: string; blocked: boolean } }>('/admin/users/block', {
        preHandler: requireRole('admin')
    }, async (request, reply) => {
        const { email, blocked } = request.body;
        if (!email || typeof blocked !== 'boolean') {
            return reply.code(400).send({ success: false, message: 'email and blocked (boolean) required' });
        }
        if (!userExists(email)) {
            return reply.code(404).send({ success: false, message: 'User not found' });
        }
        setUserBlocked(email, blocked);
        return { success: true, message: `User ${email} ${blocked ? 'blocked' : 'unblocked'}` };
    });

    // ── Admin: Delete user's download logs ────────────────────────────────────
    fastify.delete<{ Params: { email: string } }>('/admin/users/:email/logs', {
        preHandler: requireRole('admin')
    }, async (request, reply) => {
        const { email } = request.params;
        if (!userExists(email)) {
            return reply.code(404).send({ success: false, message: 'User not found' });
        }
        deleteUserDownloads(email);
        return { success: true, message: `Download logs cleared for ${email}` };
    });

    // ── Admin: Clear ALL download logs ────────────────────────────────────────
    fastify.delete('/admin/logs', { preHandler: requireRole('admin') }, async () => {
        clearAllDownloadLogs();
        return { success: true, message: 'All download logs cleared' };
    });

    // ── Admin: DB stats ───────────────────────────────────────────────────────
    fastify.get('/admin/stats', { preHandler: requireRole('admin') }, async () => {
        return { success: true, stats: getDbStats() };
    });

    // ── Platform OAuth routes ─────────────────────────────────────────────────
    fastify.get<{ Params: { platform: string } }>('/auth-url/:platform', async (request, reply) => {
        const { platform } = request.params;
        if (!isValidPlatform(platform)) {
            return reply.code(400).send({ success: false, error: `Unsupported platform: ${platform}` });
        }
        try {
            const authUrl = await authService.getAuthUrl(platform);
            return { success: true, authUrl };
        } catch {
            return reply.code(400).send({ success: false, error: 'Failed to get auth URL' });
        }
    });

    fastify.get<{ Params: { platform: string } }>('/check-platform/:platform', async (request, reply) => {
        const { platform } = request.params;
        if (!isValidPlatform(platform)) {
            return reply.code(400).send({ success: false, error: `Unsupported platform: ${platform}` });
        }
        try {
            return { success: true, isLoggedIn: await authService.checkPlatformLogin(platform) };
        } catch {
            return reply.code(400).send({ success: false, error: 'Failed to check platform login status' });
        }
    });

    fastify.post<{ Params: { platform: string }; Body: { code: string } }>('/connect/:platform', async (request, reply) => {
        const { platform } = request.params;
        const { code } = request.body;
        if (!isValidPlatform(platform)) {
            return reply.code(400).send({ success: false, error: `Unsupported platform: ${platform}` });
        }
        if (!code || typeof code !== 'string' || code.length > 2048) {
            return reply.code(400).send({ success: false, error: 'Invalid authorization code' });
        }
        try {
            return { success: true, platform: await authService.connectPlatform(platform, code) };
        } catch {
            return reply.code(400).send({ success: false, error: 'Failed to connect platform' });
        }
    });

    fastify.post<{ Params: { platform: string } }>('/disconnect/:platform', async (request, reply) => {
        const { platform } = request.params;
        if (!isValidPlatform(platform)) {
            return reply.code(400).send({ success: false, error: `Unsupported platform: ${platform}` });
        }
        try {
            await authService.disconnectPlatform(platform);
            return { success: true };
        } catch {
            return reply.code(400).send({ success: false, error: 'Failed to disconnect platform' });
        }
    });

    fastify.get<{ Params: { platform: string }; Querystring: { code: string; state: string } }>(
        '/callback/:platform', async (request, reply) => {
            const { platform } = request.params;
            const { code, state } = request.query;
            if (!isValidPlatform(platform)) {
                return reply.code(400).send({ success: false, error: 'Invalid platform' });
            }
            const stateValidation = validateOAuthState(state);
            if (!stateValidation.valid) {
                return reply.code(403).send({ success: false, error: 'Invalid OAuth state. Possible CSRF attack.' });
            }
            try {
                const connectedPlatform = await authService.connectPlatform(platform, code, stateValidation.codeVerifier);
                const redirectUri = authConfig.platforms[platform]?.redirectUri;
                if (redirectUri) return reply.redirect(`${redirectUri}?success=true&platform=${platform}`);
                return { success: true, platform: connectedPlatform };
            } catch (error: any) {
                const errorMessage = error?.message || 'Failed to connect platform';
                const redirectUri = authConfig.platforms[platform]?.redirectUri;
                if (redirectUri) return reply.redirect(`${redirectUri}?error=${encodeURIComponent(errorMessage)}`);
                return reply.code(400).send({ success: false, error: errorMessage });
            }
        }
    );
}
