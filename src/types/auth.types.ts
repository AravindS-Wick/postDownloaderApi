export interface SocialPlatform {
    id: string;
    name: string;
    icon: string;
    isConnected: boolean;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
}

export interface UserProfile {
    id: string;
    email: string;
    name: string;
    platforms: SocialPlatform[];
}

export interface PlatformAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scope: string[];
    authUrl?: string;
}

export interface PlatformAuthResponse {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
}

export interface AuthConfig {
    jwtSecret: string;
    jwtExpiresIn: string;
    platforms: {
        [key: string]: PlatformAuthConfig;
    };
}

export interface JwtPayload {
    userId: string;
    email: string;
} 
