import type { AuthConfig } from '../types/auth.types.js';

export const authConfig: AuthConfig = {
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
    jwtExpiresIn: '24h',
    platforms: {
        instagram: {
            clientId: process.env.INSTAGRAM_CLIENT_ID || '',
            clientSecret: process.env.INSTAGRAM_CLIENT_SECRET || '',
            redirectUri: 'http://localhost:5173/auth/callback/instagram',
            scope: ['basic', 'user_profile']
        },
        youtube: {
            clientId: process.env.YOUTUBE_CLIENT_ID || '',
            clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
            redirectUri: 'http://localhost:5173/auth/callback/youtube',
            scope: ['https://www.googleapis.com/auth/youtube.readonly']
        },
        tiktok: {
            clientId: process.env.TIKTOK_CLIENT_ID || '',
            clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
            redirectUri: 'http://localhost:5173/auth/callback/tiktok',
            scope: ['user.info.basic']
        },
        twitter: {
            clientId: process.env.TWITTER_CLIENT_ID || '',
            clientSecret: process.env.TWITTER_CLIENT_SECRET || '',
            redirectUri: 'http://localhost:5173/auth/callback/twitter',
            scope: ['tweet.read', 'users.read']
        }
    }
}; 
