import type { FastifyRequest, FastifyReply } from 'fastify';
import { createAuthService } from '../services/auth.service.js';

export const login = async (request: FastifyRequest<{ Body: { email: string; password: string } }>, reply: FastifyReply) => {
    try {
        const { email, password } = request.body;
        const authService = createAuthService(request.server);
        const { token, user } = await authService.login(email, password);
        return { success: true, token, user };
    } catch (error) {
        reply.code(401);
        return { success: false, error: 'Invalid credentials' };
    }
};

export const getAuthUrl = async (request: FastifyRequest<{ Params: { platform: string } }>, reply: FastifyReply) => {
    try {
        const { platform } = request.params;
        const authService = createAuthService(request.server);
        const authUrl = await authService.getAuthUrl(platform);
        return { success: true, authUrl };
    } catch (error) {
        reply.code(400);
        return { success: false, error: 'Failed to get auth URL' };
    }
};

export const checkPlatformLogin = async (request: FastifyRequest<{ Params: { platform: string } }>, reply: FastifyReply) => {
    try {
        const { platform } = request.params;
        const authService = createAuthService(request.server);
        const isLoggedIn = await authService.checkPlatformLogin(platform);
        return { success: true, isLoggedIn };
    } catch (error) {
        reply.code(400);
        return { success: false, error: 'Failed to check platform login status' };
    }
};

export const connectPlatform = async (request: FastifyRequest<{ Params: { platform: string }; Body: { code: string } }>, reply: FastifyReply) => {
    try {
        const { platform } = request.params;
        const { code } = request.body;
        const authService = createAuthService(request.server);
        const connectedPlatform = await authService.connectPlatform(platform, code);
        return { success: true, platform: connectedPlatform };
    } catch (error) {
        reply.code(400);
        return { success: false, error: 'Failed to connect platform' };
    }
};

export const disconnectPlatform = async (request: FastifyRequest<{ Params: { platform: string } }>, reply: FastifyReply) => {
    try {
        const { platform } = request.params;
        const authService = createAuthService(request.server);
        await authService.disconnectPlatform(platform);
        return { success: true };
    } catch (error) {
        reply.code(400);
        return { success: false, error: 'Failed to disconnect platform' };
    }
};

export const getCurrentUser = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
        const user = request.user as import('../types/auth.types.js').JwtPayload | undefined;
        const userId = user?.userId;
        if (!userId) {
            reply.code(401);
            return { success: false, error: 'Not authenticated' };
        }
        const authService = createAuthService(request.server);
        const userProfile = await authService.getCurrentUser(userId);
        return { success: true, user: userProfile };
    } catch (error) {
        reply.code(401);
        return { success: false, error: 'Not authenticated' };
    }
}; 
