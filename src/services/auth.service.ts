import type { FastifyInstance } from 'fastify';
import type { AuthConfig, UserProfile, SocialPlatform, JwtPayload } from '../types/auth.types.js';
import { PlatformService } from './platform.service.js';

export class AuthService {
    private fastify: FastifyInstance;
    private config: AuthConfig;
    private platformService: PlatformService;

    constructor(fastify: FastifyInstance, config: AuthConfig) {
        this.fastify = fastify;
        this.config = config;
        this.platformService = new PlatformService(fastify);
    }

    async login(email: string, password: string): Promise<{ token: string; user: UserProfile }> {
        // TODO: Implement actual user authentication
        const user: UserProfile = {
            id: '1',
            email,
            name: 'Test User',
            connectedPlatforms: []
        };
        const payload: JwtPayload = { userId: user.id };
        const token = this.fastify.jwt.sign(payload);
        return { token, user };
    }

    async getAuthUrl(platform: string): Promise<string> {
        const platformConfig = this.config.platforms[platform.toLowerCase()];
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

    async connectPlatform(platform: string, code: string): Promise<SocialPlatform> {
        const platformConfig = this.config.platforms[platform.toLowerCase()];
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
                authResponse = await this.platformService.handleTwitterCallback(code, platformConfig);
                break;
            case 'tiktok':
                authResponse = await this.platformService.handleTikTokCallback(code, platformConfig);
                break;
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }

        // Store the tokens in the database or session
        // TODO: Implement token storage

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
        // TODO: Remove platform connection and tokens
    }

    async getCurrentUser(userId: string): Promise<UserProfile> {
        // TODO: Get user profile from database
        return {
            id: userId,
            email: 'user@example.com',
            name: 'Test User',
            connectedPlatforms: []
        };
    }
}

export const createAuthService = (fastify: FastifyInstance) => {
    return new AuthService(fastify, {
        jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
        jwtExpiresIn: '24h',
        platforms: {
            instagram: {
                clientId: process.env.INSTAGRAM_CLIENT_ID || '',
                clientSecret: process.env.INSTAGRAM_CLIENT_SECRET || '',
                redirectUri: process.env.INSTAGRAM_REDIRECT_URI || 'http://localhost:5173/auth/callback/instagram',
                scope: ['basic', 'user_profile'],
                authUrl: 'https://api.instagram.com/oauth/authorize'
            },
            youtube: {
                clientId: process.env.YOUTUBE_CLIENT_ID || '',
                clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
                redirectUri: process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:5173/auth/callback/youtube',
                scope: ['https://www.googleapis.com/auth/youtube.readonly'],
                authUrl: 'https://accounts.google.com/o/oauth2/v2/auth'
            },
            twitter: {
                clientId: process.env.TWITTER_CLIENT_ID || '',
                clientSecret: process.env.TWITTER_CLIENT_SECRET || '',
                redirectUri: process.env.TWITTER_REDIRECT_URI || 'http://localhost:5173/auth/callback/twitter',
                scope: ['tweet.read', 'users.read'],
                authUrl: 'https://twitter.com/i/oauth2/authorize'
            },
            tiktok: {
                clientId: process.env.TIKTOK_CLIENT_ID || '',
                clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
                redirectUri: process.env.TIKTOK_REDIRECT_URI || 'http://localhost:5173/auth/callback/tiktok',
                scope: ['user.info.basic'],
                authUrl: 'https://www.tiktok.com/auth/authorize'
            }
        }
    });
}; 
