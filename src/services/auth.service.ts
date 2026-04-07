import type { FastifyInstance } from 'fastify';
import type { UserProfile, SocialPlatform, JwtPayload } from '../types/auth.types.js';
import { PlatformService } from './platform.service.js';
import { authConfig } from '../config/auth.config.js';
import bcrypt from 'bcryptjs';
import { getUser } from '../db/database.js';

export class AuthService {
    private fastify: FastifyInstance;
    private platformService: PlatformService;

    constructor(fastify: FastifyInstance) {
        this.fastify = fastify;
        this.platformService = new PlatformService(fastify);
    }

    async login(email: string, password: string): Promise<{ token: string; user: UserProfile }> {
        const storedUser = getUser(email);

        if (!storedUser) {
            throw new Error('Invalid credentials');
        }

        if (storedUser.is_blocked) {
            throw new Error('Account is blocked');
        }

        const passwordMatch = await bcrypt.compare(password, storedUser.password);
        if (!passwordMatch) {
            throw new Error('Invalid credentials');
        }

        const user: UserProfile = {
            id: email,
            email: storedUser.email,
            name: storedUser.email.split('@')[0],
            role: storedUser.role,
            platforms: []
        };

        const payload: JwtPayload = { userId: user.id, email: user.email, role: user.role };
        const token = this.fastify.jwt.sign(payload);
        return { token, user };
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
            case 'tiktok':
                return this.platformService.getTikTokAuthUrl(platformConfig);
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }

    async checkPlatformLogin(platform: string): Promise<boolean> {
        // TODO: Check if the platform is connected and token is valid
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
            case 'tiktok':
                authResponse = await this.platformService.handleTikTokCallback(code, platformConfig);
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
        const storedUser = getUser(userId);

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
