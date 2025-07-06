import type { FastifyInstance } from 'fastify';
import type { PlatformAuthConfig, PlatformAuthResponse, SocialPlatform } from '../types/auth.types.js';
import axios from 'axios';

export class PlatformService {
    private fastify: FastifyInstance;

    constructor(fastify: FastifyInstance) {
        this.fastify = fastify;
    }

    async getInstagramAuthUrl(config: PlatformAuthConfig): Promise<string> {
        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            scope: config.scope.join(' '),
            response_type: 'code'
        });
        return `https://api.instagram.com/oauth/authorize?${params.toString()}`;
    }

    async getYouTubeAuthUrl(config: PlatformAuthConfig): Promise<string> {
        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            scope: config.scope.join(' '),
            response_type: 'code',
            access_type: 'offline',
            prompt: 'consent'
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    async getTikTokAuthUrl(config: PlatformAuthConfig): Promise<string> {
        const params = new URLSearchParams({
            client_key: config.clientId,
            redirect_uri: config.redirectUri,
            scope: config.scope.join(','),
            response_type: 'code',
            state: this.generateState()
        });
        return `https://www.tiktok.com/auth/authorize/?${params.toString()}`;
    }

    async getTwitterAuthUrl(config: PlatformAuthConfig): Promise<string> {
        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            scope: config.scope.join(' '),
            response_type: 'code',
            code_challenge_method: 'S256',
            code_challenge: 'challenge' // TODO: Generate proper challenge
        });
        return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
    }

    async handleInstagramCallback(code: string, config: PlatformAuthConfig): Promise<PlatformAuthResponse> {
        const params = new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'authorization_code',
            redirect_uri: config.redirectUri,
            code
        });

        const response = await fetch('https://api.instagram.com/oauth/access_token', {
            method: 'POST',
            body: params
        });

        if (!response.ok) {
            throw new Error('Failed to get Instagram access token');
        }

        const data = await response.json();
        return {
            accessToken: data.access_token,
            expiresIn: data.expires_in
        };
    }

    async handleYouTubeCallback(code: string, config: PlatformAuthConfig): Promise<PlatformAuthResponse> {
        const params = new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'authorization_code',
            redirect_uri: config.redirectUri,
            code
        });

        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            body: params
        });

        if (!response.ok) {
            throw new Error('Failed to get YouTube access token');
        }

        const data = await response.json();
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in
        };
    }

    async handleTikTokCallback(code: string, config: PlatformAuthConfig): Promise<PlatformAuthResponse> {
        const params = new URLSearchParams({
            client_key: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'authorization_code',
            redirect_uri: config.redirectUri,
            code
        });

        const response = await axios.post('https://open-api.tiktok.com/oauth/access_token/', params);
        return {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresIn: response.data.expires_in
        };
    }

    async handleTwitterCallback(code: string, config: PlatformAuthConfig): Promise<PlatformAuthResponse> {
        const params = new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'authorization_code',
            redirect_uri: config.redirectUri,
            code,
            code_verifier: 'verifier' // TODO: Use proper verifier
        });

        const response = await fetch('https://api.twitter.com/2/oauth2/token', {
            method: 'POST',
            body: params
        });

        if (!response.ok) {
            throw new Error('Failed to get Twitter access token');
        }

        const data = await response.json();
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in
        };
    }

    private generateState(): string {
        return Math.random().toString(36).substring(2, 15);
    }
} 
