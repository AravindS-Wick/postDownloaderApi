import dotenv from 'dotenv';

dotenv.config();

export const appConfig = {
  // Server Configuration
  port: parseInt(process.env.PORT || '2500', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // CORS Configuration
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:8081',
    'http://localhost:19006'
  ],
  
  // File Configuration
  maxFileSize: process.env.MAX_FILE_SIZE || '100MB',
  downloadTimeout: parseInt(process.env.DOWNLOAD_TIMEOUT || '300000', 10),
  
  // Logging
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
  
  // Rate Limiting
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10), // 15 minutes
  
  // Health Check
  healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000', 10),
  
  // Security
  trustProxy: process.env.NODE_ENV === 'production',
  
  // Feature Flags
  enableSwagger: process.env.NODE_ENV !== 'production',
  enableDetailedErrors: process.env.NODE_ENV !== 'production',
} as const;

export const isProduction = appConfig.nodeEnv === 'production';
export const isDevelopment = appConfig.nodeEnv === 'development';
