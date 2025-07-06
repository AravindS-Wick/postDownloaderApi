import type { FastifyInstance } from 'fastify';
import { createAuthService } from '../services/auth.service.js';
import { authConfig } from '../config/auth.config.js';

export async function authRoutes(fastify: FastifyInstance) {
    const authService = createAuthService(fastify);

    // Login route
    fastify.post<{ Body: { email: string; password: string } }>('/login', async (request, reply) => {
        const { email, password } = request.body;
        try {
            const { token, user } = await authService.login(email, password);
            return { success: true, token, user };
        } catch (error) {
            reply.code(401);
            return { success: false, error: 'Invalid credentials' };
        }
    });

    // Get platform auth URL
    fastify.get<{ Params: { platform: string } }>('/auth-url/:platform', async (request, reply) => {
        const { platform } = request.params;
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
        try {
            await authService.disconnectPlatform(platform);
            return { success: true };
        } catch (error) {
            reply.code(400);
            return { success: false, error: 'Failed to disconnect platform' };
        }
    });

    // Get current user
    fastify.get('/me', async (request, reply) => {
        try {
            // TODO: Get actual user ID from JWT token
            const userId = '1';
            const user = await authService.getCurrentUser(userId);
            return { success: true, user };
        } catch (error) {
            reply.code(401);
            return { success: false, error: 'Not authenticated' };
        }
    });

    // Platform OAuth callbacks
    fastify.get<{ Params: { platform: string }; Querystring: { code: string; state: string } }>(
        '/callback/:platform',
        async (request, reply) => {
            const { platform } = request.params;
            const { code, state } = request.query;
            try {
                const connectedPlatform = await authService.connectPlatform(platform, code);
                // Redirect to frontend with success message
                reply.redirect(`${authConfig.platforms[platform].redirectUri}?success=true&platform=${platform}`);
            } catch (error: any) {
                // Redirect to frontend with error message
                const errorMessage = error?.message || 'Failed to connect platform';
                reply.redirect(`${authConfig.platforms[platform].redirectUri}?error=${encodeURIComponent(errorMessage)}`);
            }
        }
    );
} 
