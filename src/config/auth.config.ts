import type { AuthConfig } from '../types/auth.types.js';
import crypto from 'crypto';

const isDev = process.env.NODE_ENV !== 'production';

if (!process.env.JWT_SECRET && !isDev) {
    throw new Error('FATAL: JWT_SECRET environment variable is required in production');
}

const generatedDevSecret = crypto.randomBytes(64).toString('hex');
if (!process.env.JWT_SECRET && isDev) {
    console.warn('WARNING: No JWT_SECRET set — using a random secret for this process. Tokens will not persist across restarts.');
}

export const authConfig: AuthConfig = {
    jwtSecret: process.env.JWT_SECRET || (isDev ? generatedDevSecret : ''),
    jwtExpiresIn: '24h',
    platforms: {
        instagram: {
            clientId: process.env.INSTAGRAM_CLIENT_ID || '',
            clientSecret: process.env.INSTAGRAM_CLIENT_SECRET || '',
            redirectUri: process.env.INSTAGRAM_REDIRECT_URI || (isDev ? 'http://localhost:5173/auth/callback/instagram' : ''),
            scope: ['basic', 'user_profile']
        },
        youtube: {
            clientId: process.env.YOUTUBE_CLIENT_ID || '',
            clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
            redirectUri: process.env.YOUTUBE_REDIRECT_URI || (isDev ? 'http://localhost:5173/auth/callback/youtube' : ''),
            scope: ['https://www.googleapis.com/auth/youtube.readonly']
        },
        tiktok: {
            clientId: process.env.TIKTOK_CLIENT_ID || '',
            clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
            redirectUri: process.env.TIKTOK_REDIRECT_URI || (isDev ? 'http://localhost:5173/auth/callback/tiktok' : ''),
            scope: ['user.info.basic']
        },
        twitter: {
            clientId: process.env.TWITTER_CLIENT_ID || '',
            clientSecret: process.env.TWITTER_CLIENT_SECRET || '',
            redirectUri: process.env.TWITTER_REDIRECT_URI || (isDev ? 'http://localhost:5173/auth/callback/twitter' : ''),
            scope: ['tweet.read', 'users.read']
        }
    }
};
