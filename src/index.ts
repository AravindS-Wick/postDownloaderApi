import fastify, { type FastifyRequest, type FastifyReply, type HookHandlerDoneFunction } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { TwitterApi } from 'twitter-api-v2';
import { IgApiClient } from 'instagram-private-api';
import ytdl from 'ytdl-core';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import util from 'util';
import crypto from 'crypto';
import { authRoutes } from './routes/auth.routes.js';
import { authConfig } from './config/auth.config.js';
import { appConfig, isProduction } from './config/app.config.js';
import jwt from '@fastify/jwt';
import { fileURLToPath } from 'url';
import fastifyStatic from '@fastify/static';
import { temporaryFile, temporaryDirectory } from 'tempy';

// Import plugins
import rateLimitPlugin from './plugins/rate-limit.js';
import securityPlugin from './plugins/security.js';
import healthPlugin from './plugins/health.js';
import { errorHandler } from './utils/error-handler.js';

const execAsync = util.promisify(exec);
const app = fastify({
    logger: {
        level: appConfig.logLevel,
        transport: isProduction ? undefined : {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname'
            }
        }
    },
    trustProxy: appConfig.trustProxy,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    genReqId: () => crypto.randomUUID()
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register error handler
app.setErrorHandler(errorHandler);

// Register plugins
app.register(securityPlugin);
app.register(rateLimitPlugin);
app.register(healthPlugin);

// Enable CORS with production-ready options
app.register(cors, {
    origin: appConfig.corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Content-Disposition', 'Accept', 'Origin', 'X-Requested-With', 'X-Request-ID'],
    exposedHeaders: ['Content-Disposition', 'Content-Length', 'Content-Type', 'X-Request-ID'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400 // 24 hours
});

// Register JWT
app.register(jwt, {
    secret: authConfig.jwtSecret,
    sign: {
        expiresIn: authConfig.jwtExpiresIn
    }
});

// Swagger documentation (only in development)
if (appConfig.enableSwagger) {
    app.register(swagger, {
        swagger: {
            info: {
                title: 'Social Media Downloader API',
                description: 'API for downloading content from various social media platforms',
                version: '1.0.0'
            },
            host: `localhost:${appConfig.port}`,
            schemes: ['http'],
            consumes: ['application/json'],
            produces: ['application/json']
        }
    });

    app.register(swaggerUi, {
        routePrefix: '/documentation',
        uiConfig: {
            docExpansion: 'list',
            deepLinking: false
        }
    });
}

// Create temporary downloads directory
const tempDownloadsDir = temporaryDirectory();
console.log(`Temporary downloads directory: ${tempDownloadsDir}`);

// Temporary file management constants
const TEMP_FILE_CLEANUP_INTERVAL = 15 * 60 * 1000; // 15 minutes
const TEMP_FILE_MAX_AGE = 15 * 60 * 1000; // 15 minutes

// Temporary file management
interface TempFileInfo {
    filePath: string;
    filename: string;
    createdAt: number;
    platform: string;
}

const tempFiles = new Map<string, TempFileInfo>();

// Cleanup function for temporary files
function cleanupTempFiles() {
    const now = Date.now();
    const filesToDelete: string[] = [];
    
    for (const [fileId, fileInfo] of tempFiles.entries()) {
        if (now - fileInfo.createdAt > TEMP_FILE_MAX_AGE) {
            try {
                if (fs.existsSync(fileInfo.filePath)) {
                    fs.unlinkSync(fileInfo.filePath);
                    console.log(`Cleaned up temporary file: ${fileInfo.filename}`);
                }
                filesToDelete.push(fileId);
            } catch (error) {
                console.error(`Error cleaning up file ${fileInfo.filename}:`, error);
            }
        }
    }
    
    // Remove from tracking map
    filesToDelete.forEach(fileId => tempFiles.delete(fileId));
}

// Start cleanup interval
setInterval(cleanupTempFiles, TEMP_FILE_CLEANUP_INTERVAL);

// Serve temporary files
app.register(fastifyStatic, {
    root: tempDownloadsDir,
    prefix: '/temp/',
    setHeaders: (res, filePath) => {
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    }
});

// Initialize platform-specific clients
const twitterClient = new TwitterApi(process.env.TWITTER_BEARER_TOKEN || '');
const ig = new IgApiClient();

// Register routes
app.register(authRoutes, { prefix: '/api/auth' });

// Define types for download functions
type DownloadType = 'video' | 'audio';

// Define request body type
interface DownloadRequest {
    url: string;
    type: DownloadType;
}

// Define response type
interface DownloadResult {
    success: boolean;
    downloadUrl: string;
    filename: string;
    title?: string;
    thumbnail?: string;
    channel?: string;
    hashtags?: string[];
    length?: string;
    ageRestriction?: boolean;
}


// Helper function to clean filename
function cleanFilename(filename: string): string {
    return filename.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
}

// Download to temporary file and return JSON response
async function downloadToTempFile(url: string, type: DownloadType, platform: string): Promise<DownloadResult> {
    let tempFilePath: string | null = null;
    
    try {
        console.log(`Downloading ${platform} content to temporary file`);
        
        // Create temporary file in our temp directory
        const ext = type === 'audio' ? 'm4a' : 'mp4';
        const timestamp = Date.now();
        const filename = `${platform}_${timestamp}.${ext}`;
        tempFilePath = path.join(tempDownloadsDir, filename);
        
        // Select format based on type with 1080p priority
        let format: string;
        if (type === 'audio') {
            format = 'bestaudio[ext=m4a]/bestaudio/best';
        } else {
            console.log(platform,' platform data')
            // For video, prioritize 1080p, then fall back to best available
            if (platform === 'youtube') {
                format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
                // format = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best[ext=mp4]/best';
            } else {
                // For Instagram/Twitter, use simpler format as they may not have 1080p options
                format = 'best[height<=1080][ext=mp4]/best[ext=mp4]/best';
            }
        }
        
        // Download to temporary file
        const command = `yt-dlp "${url}" -f "${format}" -o "${tempFilePath}" --no-warnings --quiet --write-info-json`;
        console.log(`Executing download command: ${command}`);
        
        await execAsync(command);
        
        // Check if file exists and has content
        if (!fs.existsSync(tempFilePath)) {
            throw new Error('Downloaded file was not created');
        }
        
        const stats = fs.statSync(tempFilePath);
        if (stats.size < 1000) {
            throw new Error('Downloaded file is too small');
        }
        
        // Try to read metadata from info json file
        console.log(`Download completed: ${filename}`);
        console.log(`Reading metadata from ${tempFilePath }.info.json`);
        console.log(platform,'platform data')
        let meta = {
            title: `${platform} content`,
            thumbnail: '',
            channel: '',
            hashtags: [],
            length: '',
            ageRestriction: false,
        };
        
        try {
            const infoJsonPath = tempFilePath + '.info.json';
            if (fs.existsSync(infoJsonPath)) {
                const info = JSON.parse(fs.readFileSync(infoJsonPath, 'utf8'));
                meta = {
                    title: info.title || `${platform} content`,
                    thumbnail: info.thumbnail || '',
                    channel: info.uploader || info.channel || '',
                    hashtags: info.tags || [],
                    length: info.duration_string || '',
                    ageRestriction: info.age_limit > 0 || false,
                };
                // Clean up the info json file
                fs.unlinkSync(infoJsonPath);
            }
        } catch (e) {
            console.warn('Could not read metadata:', e);
        }
        
        // Generate unique file ID and track the file
        const fileId = crypto.randomUUID();
        tempFiles.set(fileId, {
            filePath: tempFilePath,
            filename,
            createdAt: Date.now(),
            platform
        });
        
        console.log(`${platform} download completed successfully: ${filename}`);
        
        return {
            success: true,
            downloadUrl: `/temp/${filename}`,
            filename,
            ...meta,
        };
        
    } catch (error) {
        console.error(`${platform} download error:`, error);
        
        // Clean up temp file on error
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
        
        throw error;
    }
}

// Helper function to check if URL is from YouTube
function isYouTubeURL(url: string): boolean {
    return url.includes('youtube.com') || url.includes('youtu.be');
}

// YouTube download handler
async function downloadYouTube(url: string, type: DownloadType): Promise<DownloadResult> {
    return await downloadToTempFile(url, type, 'youtube');
}

// Instagram download handler
async function downloadInstagram(url: string, type: DownloadType): Promise<DownloadResult> {
    return await downloadToTempFile(url, type, 'instagram');
}

// Twitter download handler
async function downloadTwitter(url: string, type: DownloadType): Promise<DownloadResult> {
    return await downloadToTempFile(url, type, 'twitter');
}

// Download route - Returns JSON with temporary download URL
app.post('/api/download', async (request: FastifyRequest<{ Body: DownloadRequest }>, reply: FastifyReply) => {
    try {
        // Validate request body
        if (!request.body) {
            return reply.code(400).send({
                success: false,
                error: 'Request body is required'
            });
        }

        const { url, type } = request.body;

        // Validate required fields
        if (!url || typeof url !== 'string') {
            return reply.code(400).send({
                success: false,
                error: 'URL is required and must be a string'
            });
        }

        if (!type || typeof type !== 'string') {
            return reply.code(400).send({
                success: false,
                error: 'Type is required and must be either "video" or "audio"'
            });
        }

        if (type !== 'video' && type !== 'audio') {
            return reply.code(400).send({
                success: false,
                error: 'Type must be either "video" or "audio"'
            });
        }

        // Validate URL format
        if (!url.trim()) {
            return reply.code(400).send({
                success: false,
                error: 'URL cannot be empty'
            });
        }

        let result: DownloadResult;

        if (isYouTubeURL(url)) {
            result = await downloadYouTube(url, type);
        } else if (url.includes('instagram.com')) {
            result = await downloadInstagram(url, type);
        } else if (url.includes('twitter.com') || url.includes('x.com')) {
            result = await downloadTwitter(url, type);
        } else {
            return reply.code(400).send({
                success: false,
                error: 'Unsupported platform. Supported platforms: YouTube, Instagram, Twitter/X'
            });
        }

        return reply.send(result);
    } catch (error: unknown) {
        console.error('Download error:', error);
        return reply.code(500).send({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        });
    }
});

// Note: Temporary files are served via /temp/ endpoint and cleaned up automatically

// Info route to get video information
app.get('/api/info', async (request: FastifyRequest<{ Querystring: { url: string } }>, reply: FastifyReply) => {
    try {
        const { url } = request.query;
        if (!url) {
            return reply.code(400).send({
                success: false,
                error: 'URL is required'
            });
        }

        let info: any = {};
        if (isYouTubeURL(url)) {
            // Use yt-dlp to get video info
            const command = `yt-dlp "${url}" --dump-json --no-warnings`;
            console.log(`Executing info command: ${command}`);

            try {
                const { stdout: infoJson } = await execAsync(command);
                const videoInfo = JSON.parse(infoJson);

                info = {
                    title: videoInfo.title,
                    duration: videoInfo.duration,
                    thumbnail: videoInfo.thumbnail,
                    author: videoInfo.uploader,
                    formats: videoInfo.formats.map((format: any) => ({
                        quality: format.format_note || format.height,
                        mimeType: format.ext,
                        hasAudio: format.acodec !== 'none',
                        hasVideo: format.vcodec !== 'none',
                        container: format.ext,
                        contentLength: format.filesize,
                    }))
                };
            } catch (error) {
                console.error('Error getting video info:', error);
                throw new Error('Could not get video information. The video might be private or restricted.');
            }
        } else if (url.includes('instagram.com')) {
            // Instagram info will be fetched during download
            info = {
                title: 'Instagram Post',
                duration: 'N/A',
                thumbnail: '',
                author: 'Instagram User',
                formats: []
            };
        } else if (url.includes('twitter.com') || url.includes('x.com')) {
            // Twitter info will be fetched during download
            info = {
                title: 'Twitter Post',
                duration: 'N/A',
                thumbnail: '',
                author: 'Twitter User',
                formats: []
            };
        } else {
            return reply.code(400).send({
                success: false,
                error: 'Unsupported platform'
            });
        }

        return reply.send({
            success: true,
            ...info
        });
    } catch (error) {
        console.error('Info error:', error);
        return reply.code(500).send({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        });
    }
});

// Add root route handler
app.get('/', async (request, reply) => {
    return { message: 'Social Media Downloader API is running' }
});

// Health check route removed to avoid conflict with healthPlugin

// Start server
const start = async () => {
    try {
        await app.listen({ 
            port: appConfig.port, 
            host: appConfig.host 
        });
        
        app.log.info({
            port: appConfig.port,
            host: appConfig.host,
            environment: appConfig.nodeEnv,
            swagger: appConfig.enableSwagger ? `http://${appConfig.host}:${appConfig.port}/documentation` : 'disabled'
        }, 'Server started successfully');
        
    } catch (err) {
        app.log.error(err, 'Failed to start server');
        process.exit(1);
    }
};

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, starting graceful shutdown...`);
    
    try {
        await app.close();
        app.log.info('Server closed successfully');
        process.exit(0);
    } catch (err) {
        app.log.error(err, 'Error during graceful shutdown');
        process.exit(1);
    }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    app.log.error({ err }, 'Uncaught Exception');
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    app.log.error({ reason, promise }, 'Unhandled Rejection');
    process.exit(1);
});

// Start the server
start();

