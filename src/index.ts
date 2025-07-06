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
import express from 'express';
import { authRoutes } from './routes/auth.routes.js';
import { authConfig } from './config/auth.config.js';
import dotenv from 'dotenv';
import jwt from '@fastify/jwt';
import { fileURLToPath } from 'url';
import fastifyStatic from '@fastify/static';

dotenv.config();

const execAsync = util.promisify(exec);
const app = fastify({
    logger: {
        level: 'info',
        transport: {
            target: 'pino-pretty'
        }
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Add request logging
app.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    console.log(`[${new Date().toISOString()}] ${request.method} ${request.url}`);
    done();
});

// Add response logging
app.addHook('onResponse', (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    console.log(`[${new Date().toISOString()}] ${request.method} ${request.url} - ${reply.statusCode}`);
    done();
});

// Enable CORS with more specific options
app.register(cors, {
    origin: [
        'http://localhost:2000',
        'http://localhost:8081',
        'http://localhost:19006', // Add web client origin
        'exp://localhost:2100',
        'exp://127.0.0.1:2100',
        'exp://127.0.0.1:8081'
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Content-Disposition', 'Accept', 'Origin', 'X-Requested-With'],
    exposedHeaders: ['Content-Disposition', 'Content-Length', 'Content-Type'],
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

// Swagger documentation
app.register(swagger, {
    swagger: {
        info: {
            title: 'Social Media Downloader API',
            description: 'API for downloading content from various social media platforms',
            version: '1.0.0'
        }
    }
});

app.register(swaggerUi, {
    routePrefix: '/documentation'
});

// Create downloads directory if it doesn't exist
const downloadsDir = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

// Serve static files from the downloads directory with proper headers
app.register(fastifyStatic, {
    root: downloadsDir,
    prefix: '/downloads/',
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
type DownloadResult = {
    success: boolean;
    downloadUrl: string;
    filename: string;
    title?: string;
    thumbnail?: string;
    channel?: string;
    hashtags?: string[];
    length?: string;
    ageRestriction?: boolean;
};

// Define request body type
interface DownloadRequest {
    url: string;
    type: DownloadType;
}

// Define error types
interface DownloadError extends Error {
    filename?: string;
}

function isDownloadError(error: unknown): error is DownloadError {
    return error instanceof Error && 'filename' in error;
}

// Helper function to generate unique filename
const generateFilename = (platform: string, type: string, extension: string): string => {
    return `${platform}-${type}-${Date.now()}.${extension}`;
};

// Helper function to clean filename
function cleanFilename(filename: string): string {
    return filename.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
}

// Helper function to check if URL is from YouTube
function isYouTubeURL(url: string): boolean {
    return url.includes('youtube.com') || url.includes('youtu.be');
}

// YouTube download handler
async function downloadYouTube(url: string, type: DownloadType): Promise<DownloadResult> {
    let outputPath = ''; // Initialize with empty string
    try {
        console.log(`Starting YouTube download for URL: ${url}`);

        // Clean the URL by removing any query parameters
        const cleanUrl = url.split('?')[0];
        console.log(`Cleaned URL: ${cleanUrl}`);

        // Select format based on type
        let format: string;
        if (type === 'audio') {
            format = 'bestaudio[ext=m4a]/bestaudio/best';
        } else {
            format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
        }
        console.log(`Selected format: ${format}`);

        const timestamp = Date.now();
        const ext = type === 'audio' ? 'm4a' : 'mp4';
        const filename = `youtube_${timestamp}.${ext}`;
        outputPath = path.join(downloadsDir, filename);
        console.log(`Output path: ${outputPath}`);

        // First, try to get video info
        const infoCommand = `yt-dlp "${cleanUrl}" --dump-json --no-warnings`;
        console.log(`Executing info command: ${infoCommand}`);

        try {
            const { stdout: infoJson } = await execAsync(infoCommand);
            const info = JSON.parse(infoJson);
            console.log('Video info retrieved successfully');
        } catch (infoError) {
            console.error('Error getting video info:', infoError);
            throw new Error('Could not get video information. The video might be private or restricted.');
        }

        // Single command to download and get metadata
        const command = `yt-dlp "${cleanUrl}" -f "${format}" -o "${outputPath}" --write-info-json --no-warnings --progress --newline`;
        console.log(`Executing download command: ${command}`);

        const { stdout, stderr } = await execAsync(command);

        if (stderr) {
            console.error('YouTube download error:', stderr);
            throw new Error('Failed to download from YouTube');
        }

        // Wait a moment to ensure file is written
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify the downloaded file
        if (!fs.existsSync(outputPath)) {
            console.error('File not found at path:', outputPath);
            throw new Error('Downloaded file not found');
        }

        const stats = fs.statSync(outputPath);
        console.log(`Downloaded file size: ${stats.size} bytes`);

        if (stats.size < 1000) { // Less than 1KB
            console.error('File too small:', stats.size);
            throw new Error('Downloaded file is too small, download may have failed');
        }

        // Try to read metadata from the info json file
        let meta = {
            title: 'YouTube Video',
            thumbnail: '',
            channel: '',
            hashtags: [],
            length: '',
            ageRestriction: false,
        };

        try {
            const infoJsonPath = outputPath + '.info.json';
            if (fs.existsSync(infoJsonPath)) {
                const info = JSON.parse(fs.readFileSync(infoJsonPath, 'utf8'));
                meta = {
                    title: info.title || 'YouTube Video',
                    thumbnail: info.thumbnail || '',
                    channel: info.uploader || '',
                    hashtags: info.tags || [],
                    length: info.duration_string || '',
                    ageRestriction: info.age_limit > 0,
                };
                // Clean up the info json file
                fs.unlinkSync(infoJsonPath);
            }
        } catch (e) {
            console.warn('Could not read metadata:', e);
            // Continue with default metadata
        }

        console.log('Download completed successfully');
        return {
            success: true,
            downloadUrl: `/downloads/${filename}`,
            filename,
            ...meta,
        };
    } catch (error: unknown) {
        console.error('YouTube download error:', error);
        // Clean up any partial download
        try {
            if (outputPath && fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
            // Also clean up info json if it exists
            const infoJsonPath = outputPath + '.info.json';
            if (fs.existsSync(infoJsonPath)) {
                fs.unlinkSync(infoJsonPath);
            }
        } catch (cleanupError) {
            console.error('Error cleaning up files:', cleanupError);
        }
        throw error;
    }
}

// Instagram download handler
async function downloadInstagram(url: string, type: DownloadType): Promise<DownloadResult> {
    try {
        console.log(`Starting Instagram download for URL: ${url}`);

        const timestamp = Date.now();
        const ext = type === 'audio' ? 'm4a' : 'mp4';
        const filename = `instagram_${timestamp}.${ext}`;
        const outputPath = path.join(downloadsDir, filename);
        console.log(`Output path: ${outputPath}`);

        // Select format based on type
        let format;
        if (type === 'audio') {
            format = 'bestaudio[ext=m4a]/bestaudio/best';
        } else {
            format = 'best[ext=mp4]/best';
        }
        console.log(`Selected format: ${format}`);

        // Build the command with additional options
        const command = `yt-dlp "${url}" -f "${format}" -o "${outputPath}" --no-warnings --progress --newline`;
        console.log(`Executing command: ${command}`);

        const { stdout, stderr } = await execAsync(command);

        if (stderr) {
            console.error('Instagram download error:', stderr);
            throw new Error('Failed to download from Instagram');
        }

        // Verify the downloaded file
        if (!fs.existsSync(outputPath)) {
            throw new Error('Downloaded file not found');
        }

        const stats = fs.statSync(outputPath);
        console.log(`Downloaded file size: ${stats.size} bytes`);

        if (stats.size < 1000) { // Less than 1KB
            throw new Error('Downloaded file is too small, download may have failed');
        }

        // Mock metadata for Instagram
        const meta = {
            title: `Instagram Post ${timestamp}`,
            thumbnail: '',
            channel: '',
            hashtags: [],
            length: '',
            ageRestriction: false,
        };

        console.log('Download completed successfully');
        return {
            success: true,
            downloadUrl: `/downloads/${filename}`,
            filename,
            ...meta,
        };
    } catch (error) {
        console.error('Instagram download error:', error);
        throw error;
    }
}

// Twitter/X download handler
async function downloadTwitter(url: string, type: DownloadType): Promise<DownloadResult> {
    try {
        console.log(`Starting Twitter download for URL: ${url}`);

        const timestamp = Date.now();
        const ext = type === 'audio' ? 'm4a' : 'mp4';
        const filename = `twitter_${timestamp}.${ext}`;
        const outputPath = path.join(downloadsDir, filename);
        console.log(`Output path: ${outputPath}`);

        // Select format based on type
        let format;
        if (type === 'audio') {
            format = 'bestaudio[ext=m4a]/bestaudio/best';
        } else {
            format = 'best[ext=mp4]/best';
        }
        console.log(`Selected format: ${format}`);

        // Build the command with additional options
        const command = `yt-dlp "${url}" -f "${format}" -o "${outputPath}" --no-warnings --progress --newline`;
        console.log(`Executing command: ${command}`);

        const { stdout, stderr } = await execAsync(command);

        if (stderr) {
            console.error('Twitter download error:', stderr);
            throw new Error('Failed to download from Twitter');
        }

        // Verify the downloaded file
        if (!fs.existsSync(outputPath)) {
            throw new Error('Downloaded file not found');
        }

        const stats = fs.statSync(outputPath);
        console.log(`Downloaded file size: ${stats.size} bytes`);

        if (stats.size < 1000) { // Less than 1KB
            throw new Error('Downloaded file is too small, download may have failed');
        }

        // Mock metadata for Twitter
        const meta = {
            title: `Twitter Post ${timestamp}`,
            thumbnail: '',
            channel: '',
            hashtags: [],
            length: '',
            ageRestriction: false,
        };

        console.log('Download completed successfully');
        return {
            success: true,
            downloadUrl: `/downloads/${filename}`,
            filename,
            ...meta,
        };
    } catch (error) {
        console.error('Twitter download error:', error);
        throw error;
    }
}

// Download route
app.post('/api/download', async (request: FastifyRequest<{ Body: DownloadRequest }>, reply: FastifyReply) => {
    try {
        const { url, type } = request.body;
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
                error: 'Unsupported platform'
            });
        }

        return reply.send(result);
    } catch (error: unknown) {
        console.error('Download error:', error);
        if (isDownloadError(error)) {
            return reply.code(500).send({
                success: false,
                error: error.message || 'Unknown error occurred',
                filename: error.filename
            });
        }
        return reply.code(500).send({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        });
    }
});

// Serve downloaded files with proper headers
app.get('/downloads/:filename', async (request, reply) => {
    try {
        const { filename } = request.params as { filename: string };
        const filepath = path.join(downloadsDir, filename);

        if (!fs.existsSync(filepath)) {
            return reply.code(404).send({ success: false, message: 'File not found' });
        }

        const stats = fs.statSync(filepath);
        if (stats.size < 1000) {
            return reply.code(500).send({ success: false, message: 'File is too small, download may have failed' });
        }

        // Set headers
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.header('Content-Type', filename.endsWith('.mp4') ? 'video/mp4' : 'audio/mp4');
        reply.header('Content-Length', stats.size);
        reply.header('Access-Control-Expose-Headers', 'Content-Disposition');

        // Create a read stream and pipe it to the response
        const stream = fs.createReadStream(filepath);
        return reply.send(stream);
    } catch (error) {
        console.error('Error serving file:', error);
        return reply.code(500).send({
            success: false,
            message: 'Error serving file: ' + (error instanceof Error ? error.message : 'Unknown error')
        });
    }
});

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

// Health check route
app.get('/health', async () => {
    return { status: 'ok' };
});

// Start server
const start = async () => {
    try {
        await app.listen({ port: 2500, host: '0.0.0.0' });
        console.log('Server is running on port 2500');
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    app.log.error('Uncaught Exception:', err);
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    app.log.error('Unhandled Rejection:', err);
    process.exit(1);
});

start();

