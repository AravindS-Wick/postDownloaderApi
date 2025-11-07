import fastify, { type FastifyRequest, type FastifyReply, type HookHandlerDoneFunction } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { TwitterApi } from 'twitter-api-v2';
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
import {
    buildDownloadFilename,
    isYouTubeUrl,
    normalizeYouTubeUrl,
    sanitizeFilenameComponent
} from './utils/download-utils.js';

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
        'http://localhost:8082',
        'http://localhost:19006', // Add web client origin
        'exp://localhost:2100',
        'exp://127.0.0.1:2100',
        'exp://127.0.0.1:8081',
        'exp://127.0.0.1:8082'
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
    quality?: string;
};

// Define request body type
interface DownloadRequest {
    url: string;
    type: DownloadType;
    format?: string;
    quality?: string;
    useAutoFormat?: boolean;
    preferProgressive?: boolean;
    maxHeight?: number;
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


// YouTube download handler
async function downloadYouTube(url: string, type: DownloadType, options?: {
    preferredFormat?: string;
    fallbackToAuto?: boolean;
    allowProgressiveOnly?: boolean;
    allowAdaptive?: boolean;
    quality?: string;
    preferProgressive?: boolean;
    maxHeight?: number;
}): Promise<DownloadResult> {
    let outputPath = ''; // Initialize with empty string
    try {
        console.log(`Starting YouTube download for URL: ${url}`);

        const cleanUrl = normalizeYouTubeUrl(url);
        console.log(`Normalized URL: ${cleanUrl}`);

        const ext = type === 'audio' ? 'm4a' : 'mp4';

        const infoCommand = `yt-dlp "${cleanUrl}" --dump-json --no-warnings`;
        console.log(`Executing info command: ${infoCommand}`);

        let videoInfo: any = null;
        try {
            const { stdout: infoJson } = await execAsync(infoCommand);
            videoInfo = JSON.parse(infoJson);
            console.log('Video info retrieved successfully');
        } catch (infoError) {
            console.error('Error getting video info:', infoError);
            throw new Error('Could not get video information. The video might be private or restricted.');
        }

        let selectedFormat: string | null = null;
        let selectedQualityLabel: string | undefined;

        interface YtFormat {
            format_id: string;
            height?: number;
            acodec: string;
            vcodec: string;
            ext: string;
            filesize?: number;
            abr?: number;
            tbr?: number;
            format_note?: string;
            resolution?: string;
        }

        const formats = (videoInfo?.formats ?? []) as YtFormat[];
        const progressiveFormats = formats.filter(f => f.acodec !== 'none' && f.vcodec !== 'none');
        const adaptiveFormats = formats.filter(f => f.acodec === 'none' || f.vcodec === 'none');

        const qualityPreference = options?.quality;
        const preferredFormat = options?.preferredFormat;
        const allowAdaptive = options?.allowAdaptive !== false;
        const normalizedQualityPreference = qualityPreference ? qualityPreference.toLowerCase().trim() : null;

        const parseQualityHeight = (value: string): number | null => {
            const digits = value.match(/\d+/g);
            if (!digits || !digits.length) {
                return null;
            }
            const numeric = parseInt(digits[0], 10);
            return Number.isFinite(numeric) ? numeric : null;
        };

        const numericQualityPreference = normalizedQualityPreference
            ? parseQualityHeight(normalizedQualityPreference)
            : null;

        if (preferredFormat) {
            const preferred = formats.find(f => f.format_id === preferredFormat || f.format_note === preferredFormat);
            if (preferred) {
                if (preferred.acodec !== 'none' && preferred.vcodec !== 'none') {
                    selectedFormat = preferred.format_id;
                } else if (allowAdaptive) {
                    const matchingAudio = adaptiveFormats.find(f => f.acodec !== 'none');
                    if (matchingAudio) {
                        selectedFormat = `${preferred.format_id}+${matchingAudio.format_id}`;
                    }
                }
            }
        }

        const pickByQuality = (candidateFormats: YtFormat[]) => {
            if (!candidateFormats.length) {
                return null;
            }
            const sorted = candidateFormats.sort((a, b) => ((b.height ?? 0) - (a.height ?? 0)) || ((b.filesize ?? 0) - (a.filesize ?? 0)) || ((b.tbr ?? 0) - (a.tbr ?? 0)));
            if (!normalizedQualityPreference) {
                return sorted[0];
            }

            if (normalizedQualityPreference === 'best') {
                return sorted[0];
            }

            if (numericQualityPreference && numericQualityPreference > 0) {
                const exactHeight = sorted.find(f => (f.height ?? 0) === numericQualityPreference);
                if (exactHeight) {
                    return exactHeight;
                }

                const bestBelowOrEqual = sorted.find(f => (f.height ?? 0) > 0 && (f.height ?? 0) <= numericQualityPreference);
                if (bestBelowOrEqual) {
                    return bestBelowOrEqual;
                }
            }

            const byHeightLabel = sorted.find(f => (f.height ? `${f.height}p` : '').toLowerCase() === normalizedQualityPreference);
            if (byHeightLabel) {
                return byHeightLabel;
            }

            const byNote = sorted.find(f => (f.format_note || '').toLowerCase() === normalizedQualityPreference);
            if (byNote) {
                return byNote;
            }

            return sorted[0];
        };

        const deriveQualityLabel = (format: YtFormat | null): string | undefined => {
            if (!format) {
                return undefined;
            }
            if (format.height) {
                return `${format.height}p`;
            }
            if (format.format_note) {
                return format.format_note;
            }
            if (format.abr) {
                return `${format.abr}kbps`;
            }
            if (format.tbr) {
                return `${Math.round(format.tbr)}kbps`;
            }
            return format.resolution;
        };

        if (!selectedFormat && type === 'audio') {
            const audioFormat = pickByQuality(adaptiveFormats.filter(f => f.acodec !== 'none'));
            if (audioFormat) {
                selectedFormat = audioFormat.format_id;
                selectedQualityLabel = deriveQualityLabel(audioFormat);
            }
        }

        if (!selectedFormat && type !== 'audio') {
            const progressiveSelection = pickByQuality(progressiveFormats);
            if (progressiveSelection) {
                const progressiveHeight = progressiveSelection.height ?? null;
                const needsHigherThanProgressive = Boolean(
                    numericQualityPreference &&
                    progressiveHeight &&
                    progressiveHeight < numericQualityPreference
                );
                if (!needsHigherThanProgressive || !allowAdaptive) {
                    selectedFormat = progressiveSelection.format_id;
                    selectedQualityLabel = deriveQualityLabel(progressiveSelection);
                }
            }
        }

        if (!selectedFormat && type !== 'audio' && allowAdaptive) {
            const videoOnlySorted = adaptiveFormats.filter(f => f.vcodec !== 'none' && f.acodec === 'none');
            const audioOnlySorted = adaptiveFormats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');
            const videoSelection = pickByQuality(videoOnlySorted);
            const audioSelection = pickByQuality(audioOnlySorted);
            if (videoSelection && audioSelection) {
                selectedFormat = `${videoSelection.format_id}+${audioSelection.format_id}`;
                selectedQualityLabel = deriveQualityLabel(videoSelection) || deriveQualityLabel(audioSelection);
            }
        }

        if (!selectedFormat) {
            selectedFormat = type === 'audio'
                ? 'bestaudio[ext=m4a]/bestaudio/best'
                : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
        }

        if (!selectedQualityLabel && typeof videoInfo?.requested_downloads === 'object') {
            const requested = Array.isArray(videoInfo.requested_downloads)
                ? videoInfo.requested_downloads[0]
                : videoInfo.requested_downloads;
            if (requested && requested.format_note) {
                selectedQualityLabel = requested.format_note;
            }
        }

        console.log(`Selected format: ${selectedFormat}`);
        const tempFilename = `youtube_${Date.now()}.${ext}`;
        outputPath = path.join(downloadsDir, tempFilename);
        console.log(`Output path: ${outputPath}`);
        const command = `yt-dlp "${cleanUrl}" -f "${selectedFormat}" -o "${outputPath}" --write-info-json --no-warnings --progress --newline`;
        console.log(`Executing download command: ${command}`);

        const { stderr } = await execAsync(command);

        if (stderr && stderr.includes('ERROR')) {
            console.error('YouTube download error:', stderr);
            throw new Error('Failed to download from YouTube: ' + stderr);
        }

        // Wait a moment to ensure file is written
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify the downloaded file
        if (!fs.existsSync(outputPath)) {
            console.error('File not found at path:', outputPath);
            throw new Error('Downloaded file not found');
        }
        if (!selectedQualityLabel) {
            const pathParts = outputPath.split('.');
            const infoJsonPath = `${pathParts.slice(0, -1).join('.')}.info.json`;
            if (fs.existsSync(infoJsonPath)) {
                try {
                    const info = JSON.parse(fs.readFileSync(infoJsonPath, 'utf8'));
                    if (info.format_note) {
                        selectedQualityLabel = info.format_note;
                    } else if (info.height) {
                        selectedQualityLabel = `${info.height}p`;
                    } else if (info.abr) {
                        selectedQualityLabel = `${info.abr}kbps`;
                    }
                } catch (qualityError) {
                    console.warn('Could not determine quality from info json:', qualityError);
                }
            }
        }

        const stats = fs.statSync(outputPath);
        console.log(`Downloaded file size: ${stats.size} bytes`);

        if (stats.size < 1000) { // Less than 1KB
            console.error('File too small:', stats.size);
            throw new Error('Downloaded file is too small, download may have failed');
        }

        // Try to read metadata from the info json file
        let meta = {
            title: typeof videoInfo?.title === 'string' ? videoInfo.title : 'YouTube Video',
            thumbnail: typeof videoInfo?.thumbnail === 'string' ? videoInfo.thumbnail : '',
            channel: typeof videoInfo?.uploader === 'string' ? videoInfo.uploader : '',
            hashtags: Array.isArray(videoInfo?.tags) ? videoInfo.tags : [],
            length: typeof videoInfo?.duration_string === 'string' ? videoInfo.duration_string : (typeof videoInfo?.duration === 'number' ? String(videoInfo.duration) : ''),
            ageRestriction: Boolean(typeof videoInfo?.age_limit === 'number' && videoInfo.age_limit > 0),
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
                if (!selectedQualityLabel) {
                    if (info.format_note) {
                        selectedQualityLabel = info.format_note;
                    } else if (info.height) {
                        selectedQualityLabel = `${info.height}p`;
                    } else if (info.abr) {
                        selectedQualityLabel = `${info.abr}kbps`;
                    }
                }
                // Clean up the info json file
                fs.unlinkSync(infoJsonPath);
            }
        } catch (e) {
            console.warn('Could not read metadata:', e);
            // Continue with default metadata
        }

        const finalFilename = buildDownloadFilename(downloadsDir, meta.title, selectedQualityLabel, ext);
        const finalPath = path.join(downloadsDir, finalFilename);
        fs.renameSync(outputPath, finalPath);

        console.log('Download completed successfully');
        return {
            success: true,
            downloadUrl: `/downloads/${finalFilename}`,
            filename: finalFilename,
            quality: selectedQualityLabel,
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

        const finalFilename = buildDownloadFilename(downloadsDir, meta.title, undefined, ext);
        const finalPath = path.join(downloadsDir, finalFilename);
        fs.renameSync(outputPath, finalPath);

        console.log('Download completed successfully');
        return {
            success: true,
            downloadUrl: `/downloads/${finalFilename}`,
            filename: finalFilename,
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

        const finalFilename = buildDownloadFilename(downloadsDir, meta.title, undefined, ext);
        const finalPath = path.join(downloadsDir, finalFilename);
        fs.renameSync(outputPath, finalPath);

        console.log('Download completed successfully');
        return {
            success: true,
            downloadUrl: `/downloads/${finalFilename}`,
            filename: finalFilename,
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
        
        // ✅ Validate input
        if (!url) {
            return reply.code(400).send({
                success: false,
                error: 'URL is required'
            });
        }
        
        if (!type || !['video', 'audio'].includes(type)) {
            return reply.code(400).send({
                success: false,
                error: 'Type must be "video" or "audio"'
            });
        }

        let result: DownloadResult;

        if (isYouTubeUrl(url)) {
            result = await downloadYouTube(url, type, {
                preferredFormat: request.body.format,
                fallbackToAuto: request.body.useAutoFormat,
                quality: request.body.quality
            });
        } else if (url.includes('instagram.com')) {
            result = await downloadInstagram(url, type);
        } else if (url.includes('twitter.com') || url.includes('x.com')) {
            result = await downloadTwitter(url, type);
        } else {
            return reply.code(400).send({
                success: false,
                error: 'Unsupported platform. Supported: YouTube, Instagram, Twitter/X'
            });
        }

        if (!result.filename) {
            const inferredName = buildDownloadFilename(downloadsDir, result.title || 'download', result.quality, type === 'audio' ? 'm4a' : 'mp4');
            const inferredPath = path.join(downloadsDir, inferredName);
            const originalPath = path.join(downloadsDir, result.downloadUrl.replace('/downloads/', ''));
            if (fs.existsSync(originalPath)) {
                fs.renameSync(originalPath, inferredPath);
                result.filename = inferredName;
                result.downloadUrl = `/downloads/${inferredName}`;
            } else {
                result.filename = inferredName;
            }
        }

        return reply.send(result);
    } catch (error: unknown) {
        console.error('Download error:', error);
        
        // ✅ Return consistent error format
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error('Error details:', errorMessage);
        
        return reply.code(500).send({
            success: false,
            error: errorMessage,
            ...(isDownloadError(error) && error.filename ? { filename: error.filename } : {})
        });
    }
});

// Serve downloaded files with proper headers
app.get('/downloads/:filename', async (request, reply) => {
    try {
        const { filename } = request.params as { filename: string };
        const filepath = path.join(downloadsDir, filename);

        if (!fs.existsSync(filepath)) {
            console.error('❌ File not found:', filepath);
            return reply.code(404).send({ success: false, error: 'File not found' });
        }

        const stats = fs.statSync(filepath);
        if (stats.size < 1000) {
            console.error('❌ File too small:', stats.size, 'bytes');
            return reply.code(500).send({ success: false, error: 'File is too small, download may have failed' });
        }

        console.log('✅ Serving file:', filename, 'Size:', stats.size, 'bytes');
        
        // Set headers
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.header('Content-Type', filename.endsWith('.mp4') ? 'video/mp4' : 'audio/mp4');
        reply.header('Content-Length', stats.size);
        reply.header('Access-Control-Expose-Headers', 'Content-Disposition');

        // Create a read stream and pipe it to the response
        const stream = fs.createReadStream(filepath);
        return reply.send(stream);
    } catch (error) {
        console.error('❌ Error serving file:', error);
        return reply.code(500).send({
            success: false,
            error: 'Error serving file: ' + (error instanceof Error ? error.message : 'Unknown error')
        });
    }
});

const infoHandler = async (request: FastifyRequest<{ Querystring: { url: string } }>, reply: FastifyReply) => {
    try {
        const { url } = request.query;
        if (!url) {
            return reply.code(400).send({
                success: false,
                error: 'URL is required'
            });
        }

        let info: any = {};
        if (isYouTubeUrl(url)) {
            const command = `yt-dlp "${url}" --dump-json --no-warnings`;
            console.log(`Executing info command: ${command}`);

            try {
                const { stdout: infoJson } = await execAsync(command);
                const videoInfo = JSON.parse(infoJson);

                const extractHeightValue = (label: string): number => {
                    const match = label.match(/\d+/);
                    return match ? parseInt(match[0], 10) : -1;
                };

                const qualityCandidates = (videoInfo.formats || [])
                    .filter((format: any) => format?.vcodec && format.vcodec !== 'none')
                    .map((format: any) => {
                        if (typeof format.height === 'number' && format.height > 0) {
                            return `${format.height}p`;
                        }
                        if (typeof format.format_note === 'string' && format.format_note.trim()) {
                            return format.format_note.trim();
                        }
                        if (typeof format.resolution === 'string' && format.resolution.trim()) {
                            return format.resolution.trim();
                        }
                        return null;
                    })
                    .filter((label: string | null): label is string => Boolean(label))
                    .map((label: string) => {
                        const numeric = extractHeightValue(label);
                        return numeric > 0 ? `${numeric}p` : label;
                    });

                const videoQualities = Array.from(new Set<string>(qualityCandidates)).sort((a: string, b: string) => {
                    const heightDiff = extractHeightValue(b) - extractHeightValue(a);
                    return heightDiff !== 0 ? heightDiff : b.localeCompare(a);
                });

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
                    })),
                    qualities: videoQualities,
                };
            } catch (error) {
                console.error('Error getting video info:', error);
                throw new Error('Could not get video information. The video might be private or restricted.');
            }
        } else if (url.includes('instagram.com')) {
            info = {
                title: 'Instagram Post',
                duration: 'N/A',
                thumbnail: '',
                author: 'Instagram User',
                formats: []
            };
        } else if (url.includes('twitter.com') || url.includes('x.com')) {
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
};

app.get('/api/info', infoHandler);
app.get('/api/media/info', infoHandler);

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
        const port = Number(process.env.PORT ?? 2500);
        const host = process.env.HOST ?? '0.0.0.0';
        await app.listen({ port, host });
        console.log(`Server is running on ${host}:${port}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    app.log.error({ err }, 'Uncaught Exception');
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    app.log.error({ err }, 'Unhandled Rejection');
    process.exit(1);
});

if (process.env.NODE_ENV !== 'test') {
    start();
}
