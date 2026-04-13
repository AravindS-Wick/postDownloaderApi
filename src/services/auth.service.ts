import type { FastifyInstance } from 'fastify';
import type { UserProfile, SocialPlatform, JwtPayload } from '../types/auth.types.js';
import { PlatformService } from './platform.service.js';
import { authConfig } from '../config/auth.config.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getUser, storeRefreshToken, getRefreshToken, revokeRefreshToken, revokeAllUserRefreshTokens } from '../db/database.js';

export class AuthService {
    private fastify: FastifyInstance;
    private platformService: PlatformService;

    constructor(fastify: FastifyInstance) {
        this.fastify = fastify;
        this.platformService = new PlatformService(fastify);
    }

    async login(email: string, password: string): Promise<{ token: string; refreshToken: string; user: UserProfile }> {
        const storedUser = await getUser(email.trim().toLowerCase());

        if (!storedUser) {
            throw new Error('Invalid credentials');
        }

        const passwordMatch = await bcrypt.compare(password, storedUser.password);
        if (!passwordMatch) {
            throw new Error('Invalid credentials');
        }

        if (!storedUser.is_verified) {
            throw new Error('EMAIL_NOT_VERIFIED');
        }

        if (storedUser.is_blocked) {
            throw new Error('Your account has been blocked');
        }

        const user: UserProfile = {
            id: email,
            email: storedUser.email,
            name: storedUser.email.split('@')[0],
            role: storedUser.role,
            platforms: []
        };

        const payload: JwtPayload = { userId: user.id, email: user.email, role: storedUser.role };
        const token = this.fastify.jwt.sign(payload);

        const refreshToken = crypto.randomBytes(64).toString('hex');
        const refreshExpiresAt = Date.now() + authConfig.refreshTokenExpiresIn;
        await storeRefreshToken(refreshToken, user.email, refreshExpiresAt);

        return { token, refreshToken, user };
    }

    async refreshAccessToken(refreshTokenValue: string): Promise<{ token: string; refreshToken: string }> {
        const storedToken = await getRefreshToken(refreshTokenValue);

        if (!storedToken || storedToken.revoked || storedToken.expires_at < Date.now()) {
            throw new Error('Invalid or expired refresh token');
        }

        const user = await getUser(storedToken.user_email);
        if (!user || user.is_blocked) {
            throw new Error('User not found or blocked');
        }

        // Rotate: revoke old, issue new
        await revokeRefreshToken(refreshTokenValue);

        const payload: JwtPayload = { userId: user.email, email: user.email, role: user.role };
        const newAccessToken = this.fastify.jwt.sign(payload);

        const newRefreshToken = crypto.randomBytes(64).toString('hex');
        const refreshExpiresAt = Date.now() + authConfig.refreshTokenExpiresIn;
        await storeRefreshToken(newRefreshToken, user.email, refreshExpiresAt);

        return { token: newAccessToken, refreshToken: newRefreshToken };
    }

    async logoutUser(email: string): Promise<void> {
        await revokeAllUserRefreshTokens(email);
    }

    async getAuthUrl(platform: string): Promise<string> {
        const platformConfig = authConfig.platforms[platform.toLowerCase()];
        if (!platformConfig) {
            throw new Error(`Unsupported platform: ${platform}`);
        }

        switch (platform.toLowerCase()) {
            case 'instagram':
                return this.platformService.getInstagramAuthUrl(platformConfig);
            case 'youtube':
                return this.platformService.getYouTubeAuthUrl(platformConfig);
            case 'twitter':
                return this.platformService.getTwitterAuthUrl(platformConfig);
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }

    async checkPlatformLogin(platform: string): Promise<boolean> {
        return false;
    }

    async connectPlatform(platform: string, code: string, codeVerifier?: string): Promise<SocialPlatform> {
        const platformConfig = authConfig.platforms[platform.toLowerCase()];
        if (!platformConfig) {
            throw new Error(`Unsupported platform: ${platform}`);
        }

        let authResponse;
        switch (platform.toLowerCase()) {
            case 'instagram':
                authResponse = await this.platformService.handleInstagramCallback(code, platformConfig);
                break;
            case 'youtube':
                authResponse = await this.platformService.handleYouTubeCallback(code, platformConfig);
                break;
            case 'twitter':
                authResponse = await this.platformService.handleTwitterCallback(code, platformConfig, codeVerifier);
                break;
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }

        return {
            id: platform.toLowerCase(),
            name: platform.charAt(0).toUpperCase() + platform.slice(1),
            icon: `/${platform.toLowerCase()}-icon.png`,
            isConnected: true,
            accessToken: authResponse.accessToken,
            refreshToken: authResponse.refreshToken,
            expiresAt: authResponse.expiresIn ? Date.now() + authResponse.expiresIn * 1000 : undefined
        };
    }

    async disconnectPlatform(platform: string): Promise<void> {
        // TODO: Remove platform connection and tokens from storage
    }

    async getCurrentUser(userId: string): Promise<UserProfile> {
        const storedUser = await getUser(userId);

        if (storedUser) {
            return {
                id: storedUser.email,
                email: storedUser.email,
                name: storedUser.email.split('@')[0],
                role: storedUser.role,
                platforms: []
            };
        }

        throw new Error('User not found');
    }
}

export const createAuthService = (fastify: FastifyInstance) => {
    return new AuthService(fastify);
};
