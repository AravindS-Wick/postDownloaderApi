import fastify, { type FastifyRequest, type FastifyReply, type HookHandlerDoneFunction } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import util from 'util';
import { authRoutes } from './routes/auth.routes.js';
import { authConfig } from './config/auth.config.js';
import dotenv from 'dotenv';
import jwt from '@fastify/jwt';
import { fileURLToPath } from 'url';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { closeDatabase, getGuestDownloadCount, logGuestDownload } from './db/database.js';
import {
    buildDownloadFilename,
    isYouTubeUrl,
    normalizeYouTubeUrl,
} from './utils/download-utils.js';
import userRoutes from './routes/user.js';
import { getInstagramUserPosts } from './services/instagram.service.js';
import { getTwitterUserPosts } from './services/twitter.service.js';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`FATAL: Required environment variable ${envVar} is not set.`);
        if (process.env.NODE_ENV === 'production') {
            process.exit(1);
        } else {
            console.warn(`WARNING: Using insecure default for ${envVar} in development mode.`);
        }
    }
}

const execFileAsync = util.promisify(execFile);
const isDev = process.env.NODE_ENV !== 'production';

const MIN_DOWNLOAD_SIZE_BYTES = 1000;
const YTDLP_TIMEOUT_MS = 300_000; // 5 minutes
const YTDLP_MAX_BUFFER = 10 * 1024 * 1024; // 10MB
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// Cookie support — allows yt-dlp to access login-restricted content (age-gated, private, etc.)
// Option 1: COOKIES_FROM_BROWSER=chrome  (local dev only — browser must be on same machine)
// Option 2: COOKIES_FILE=/path/to/cookies.txt  (Netscape-format file)
// Option 3: COOKIES_CONTENT=<full contents of cookies.txt>  (for Railway/cloud deployments)
const COOKIES_FROM_BROWSER = process.env.COOKIES_FROM_BROWSER || '';

// If COOKIES_CONTENT env var is set (cloud deployment), write it to a temp file once at startup
let COOKIES_FILE = '';
const _rawCookiesFile = process.env.COOKIES_FILE || '';
if (process.env.COOKIES_CONTENT) {
    const tmpCookiesPath = path.join('/tmp', 'cookies.txt');
    fs.writeFileSync(tmpCookiesPath, process.env.COOKIES_CONTENT, 'utf8');
    COOKIES_FILE = tmpCookiesPath;
    console.log('Cookies loaded from COOKIES_CONTENT env var →', tmpCookiesPath);
} else if (_rawCookiesFile) {
    COOKIES_FILE = path.isAbsolute(_rawCookiesFile)
        ? _rawCookiesFile
        : path.resolve(process.cwd(), _rawCookiesFile);
}

function getYtdlpCookieArgs(): string[] {
    if (COOKIES_FROM_BROWSER) {
        return ['--cookies-from-browser', COOKIES_FROM_BROWSER];
    }
    if (COOKIES_FILE && fs.existsSync(COOKIES_FILE)) {
        return ['--cookies', COOKIES_FILE];
    }
    return [];
}

// Freemium config — set FREEMIUM_ENABLED=true in .env to gate downloads after the limit
const FREEMIUM_ENABLED = process.env.FREEMIUM_ENABLED === 'true';
const FREEMIUM_LIMIT = Number(process.env.FREEMIUM_LIMIT) || 10;

const app = fastify({
    logger: {
        level: 'info',
        transport: isDev ? { target: 'pino-pretty' } : undefined
    },
    bodyLimit: 1048576, // 1MB
    connectionTimeout: 0,  // disable connection timeout
    requestTimeout: 0,     // disable request timeout (Railway proxy handles it)
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

// Rate limiting
await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
});

// Enable CORS
const devOrigins = [
    'http://localhost:2000',
    'http://localhost:2500',
    'http://localhost:8081',
    'http://localhost:8082',
    'http://localhost:19006',
    'exp://localhost:2100',
    'exp://127.0.0.1:2100',
    'exp://127.0.0.1:8081',
    'exp://127.0.0.1:8082'
];

app.register(cors, {
    origin: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
        : (isDev ? devOrigins : []),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Content-Disposition', 'Accept', 'Origin', 'X-Requested-With'],
    exposedHeaders: ['Content-Disposition', 'Content-Length', 'Content-Type'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400
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

// Use DATA_DIR env var when deployed (e.g. Fly.io persistent volume at /data)
// Falls back to project root for local development
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');

// Create downloads directory if it doesn't exist
const downloadsDir = path.join(DATA_DIR, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
}

// Create db directory if it doesn't exist (also handled in database.ts)
const dbDir = path.join(DATA_DIR, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Serve static files from the downloads directory with proper headers
app.register(fastifyStatic, {
    root: downloadsDir,
    prefix: '/downloads/',
    setHeaders: (res, filePath) => {
        const rawName = path.basename(filePath);
        // ASCII-safe fallback (strips emoji, non-latin chars) for the filename= param
        const safeName = rawName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
        // UTF-8 encoded name for clients that support RFC 5987 filename*=
        const encodedName = encodeURIComponent(rawName);
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`);
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    }
});

// Register routes
app.register(authRoutes, { prefix: '/api/auth' });
app.register(userRoutes, { prefix: '/api/user' });

// ── Types ──────────────────────────────────────────────────────────────

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

interface DownloadRequest {
    url: string;
    type: DownloadType;
    format?: string;
    quality?: string;
    useAutoFormat?: boolean;
}

interface DownloadError extends Error {
    filename?: string;
}

function isDownloadError(error: unknown): error is DownloadError {
    return error instanceof Error && 'filename' in error;
}

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

interface DownloadOptions {
    quality?: string;
    preferredFormat?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

async function waitForFile(filePath: string, maxAttempts = 10, intervalMs = 300): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            await fs.promises.access(filePath, fs.constants.F_OK);
            return true;
        } catch {
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
    }
    return false;
}

function validateUrl(url: string): { valid: boolean; error?: string } {
    if (!url || typeof url !== 'string') {
        return { valid: false, error: 'URL is required' };
    }
    if (url.length > 2048) {
        return { valid: false, error: 'URL is too long (max 2048 characters)' };
    }
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { valid: false, error: 'URL must use http or https protocol' };
        }
        return { valid: true };
    } catch {
        return { valid: false, error: 'Invalid URL format' };
    }
}

function clientErrorMessage(error: unknown): string {
    if (isDev && error instanceof Error) {
        return error.message;
    }
    if (error instanceof Error) {
        const safeMessages = [
            'Could not get video information',
            'Downloaded file not found',
            'Downloaded file is too small',
            'Failed to download from',
            'Unsupported platform',
            'This video is unavailable',
            'This video is private',
            'This video is age-restricted',
            'This URL is not supported',
            'Download timed out',
        ];
        for (const safe of safeMessages) {
            if (error.message.includes(safe)) {
                return error.message;
            }
        }
    }
    return 'An error occurred while processing your request';
}

/** Parse yt-dlp stderr into a user-friendly error message */
function parseYtdlpError(stderr: string, platform: string): string {
    const lower = stderr.toLowerCase();
    if (lower.includes('video unavailable') || lower.includes('is not available')) {
        return 'This video is unavailable or has been removed';
    }
    if (lower.includes('private video')) {
        return 'This video is private. The owner has not made it publicly available';
    }
    if (lower.includes('sign in to confirm your age') || lower.includes('age-restricted')) {
        return 'This video is age-restricted. Set COOKIES_FROM_BROWSER in .env to access restricted content';
    }
    if (lower.includes('inappropriate') || lower.includes('unavailable for certain audiences')) {
        return 'This content is restricted by the platform. Set COOKIES_FROM_BROWSER in .env to access it';
    }
    if (lower.includes('no video could be found') || lower.includes('no video in this tweet') || lower.includes('no formats found')) {
        return 'No video found in this post. This may be a text or image-only post';
    }
    if (lower.includes('unsupported url')) {
        return 'This URL is not supported for downloading';
    }
    if (lower.includes('unable to extract') || lower.includes('unable to download')) {
        return `Failed to download from ${platform}. The content may have been removed or is not accessible`;
    }
    return `Failed to download from ${platform}`;
}


// ── ffmpeg post-download resize ────────────────────────────────────────

/** Probe actual video height using ffprobe */
async function probeVideoHeight(filePath: string): Promise<number | null> {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=height',
            '-of', 'csv=p=0',
            filePath,
        ], { timeout: 15_000 });
        const height = parseInt(stdout.trim(), 10);
        return Number.isFinite(height) ? height : null;
    } catch {
        return null;
    }
}

/** Resize video to target height using ffmpeg (maintains aspect ratio) */
async function resizeVideo(
    inputPath: string,
    targetHeight: number,
): Promise<void> {
    const tmpPath = inputPath + '.resizing.mp4';
    try {
        await execFileAsync('ffmpeg', [
            '-i', inputPath,
            '-vf', `scale=-2:${targetHeight}`,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-c:a', 'copy',
            '-movflags', '+faststart',
            '-y',
            tmpPath,
        ], { timeout: YTDLP_TIMEOUT_MS, maxBuffer: YTDLP_MAX_BUFFER });

        // Replace original with resized version
        fs.unlinkSync(inputPath);
        fs.renameSync(tmpPath, inputPath);
    } catch (err) {
        // Cleanup temp file on failure, keep original
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
        console.warn('ffmpeg resize failed, keeping original quality:', err);
    }
}

// ── Format selection (shared across all platforms) ─────────────────────

function parseQualityHeight(value: string): number | null {
    const digits = value.match(/\d+/g);
    if (!digits || !digits.length) return null;
    const numeric = parseInt(digits[0], 10);
    return Number.isFinite(numeric) ? numeric : null;
}

function pickByQuality(
    candidateFormats: YtFormat[],
    normalizedQuality: string | null,
    numericQuality: number | null
): YtFormat | null {
    if (!candidateFormats.length) return null;

    const sorted = [...candidateFormats].sort((a, b) =>
        ((b.height ?? 0) - (a.height ?? 0)) ||
        ((b.filesize ?? 0) - (a.filesize ?? 0)) ||
        ((b.tbr ?? 0) - (a.tbr ?? 0))
    );

    if (!normalizedQuality || normalizedQuality === 'best') {
        return sorted[0];
    }

    if (numericQuality && numericQuality > 0) {
        const exact = sorted.find(f => (f.height ?? 0) === numericQuality);
        if (exact) return exact;

        const bestBelow = sorted.find(f => (f.height ?? 0) > 0 && (f.height ?? 0) <= numericQuality);
        if (bestBelow) return bestBelow;
    }

    const byLabel = sorted.find(f => (f.height ? `${f.height}p` : '').toLowerCase() === normalizedQuality);
    if (byLabel) return byLabel;

    const byNote = sorted.find(f => (f.format_note || '').toLowerCase() === normalizedQuality);
    if (byNote) return byNote;

    return sorted[0];
}

function deriveQualityLabel(format: YtFormat | null): string | undefined {
    if (!format) return undefined;
    if (format.height) return `${format.height}p`;
    if (format.format_note) return format.format_note;
    if (format.abr) return `${format.abr}kbps`;
    if (format.tbr) return `${Math.round(format.tbr)}kbps`;
    return format.resolution;
}

/** Select format based on quality preference and available formats */
function selectFormat(
    formats: YtFormat[],
    type: DownloadType,
    options?: DownloadOptions
): { formatArg: string; qualityLabel?: string } {
    const progressiveFormats = formats.filter(f => f.acodec !== 'none' && f.vcodec !== 'none');
    const adaptiveFormats = formats.filter(f => f.acodec === 'none' || f.vcodec === 'none');

    const normalizedQuality = options?.quality ? options.quality.toLowerCase().trim() : null;
    const numericQuality = normalizedQuality ? parseQualityHeight(normalizedQuality) : null;

    let selectedFormat: string | null = null;
    let qualityLabel: string | undefined;

    // Try preferred format ID first
    if (options?.preferredFormat) {
        const preferred = formats.find(f =>
            f.format_id === options.preferredFormat || f.format_note === options.preferredFormat
        );
        if (preferred) {
            if (preferred.acodec !== 'none' && preferred.vcodec !== 'none') {
                selectedFormat = preferred.format_id;
                qualityLabel = deriveQualityLabel(preferred);
            } else {
                const matchingAudio = adaptiveFormats.find(f => f.acodec !== 'none');
                if (matchingAudio) {
                    selectedFormat = `${preferred.format_id}+${matchingAudio.format_id}`;
                    qualityLabel = deriveQualityLabel(preferred);
                }
            }
        }
    }

    // Audio selection
    if (!selectedFormat && type === 'audio') {
        const audioFormat = pickByQuality(
            adaptiveFormats.filter(f => f.acodec !== 'none'),
            normalizedQuality, numericQuality
        );
        if (audioFormat) {
            selectedFormat = audioFormat.format_id;
            qualityLabel = deriveQualityLabel(audioFormat);
        }
    }

    // Video: try progressive first
    if (!selectedFormat && type !== 'audio') {
        const progressiveSelection = pickByQuality(progressiveFormats, normalizedQuality, numericQuality);
        if (progressiveSelection) {
            const progressiveHeight = progressiveSelection.height ?? null;
            const needsHigher = Boolean(
                numericQuality && progressiveHeight && progressiveHeight < numericQuality
            );
            if (!needsHigher) {
                selectedFormat = progressiveSelection.format_id;
                qualityLabel = deriveQualityLabel(progressiveSelection);
            }
        }
    }

    // Video: try adaptive (separate video + audio streams)
    if (!selectedFormat && type !== 'audio') {
        const videoOnly = adaptiveFormats.filter(f => f.vcodec !== 'none' && f.acodec === 'none');
        const audioOnly = adaptiveFormats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');
        const videoSelection = pickByQuality(videoOnly, normalizedQuality, numericQuality);
        const audioSelection = pickByQuality(audioOnly, null, null);
        if (videoSelection && audioSelection) {
            selectedFormat = `${videoSelection.format_id}+${audioSelection.format_id}`;
            qualityLabel = deriveQualityLabel(videoSelection) || deriveQualityLabel(audioSelection);
        }
    }

    // Fallback to yt-dlp auto selection
    if (!selectedFormat) {
        selectedFormat = type === 'audio'
            ? 'bestaudio[ext=m4a]/bestaudio/best'
            : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    }

    return { formatArg: selectedFormat, qualityLabel };
}

/** Extract available video qualities from yt-dlp format list */
function extractQualities(formats: any[]): string[] {
    const extractHeightValue = (label: string): number => {
        const match = label.match(/\d+/);
        return match ? parseInt(match[0], 10) : -1;
    };

    const candidates = formats
        .filter((f: any) => f?.vcodec && f.vcodec !== 'none')
        .map((f: any) => {
            if (typeof f.height === 'number' && f.height > 0) return `${f.height}p`;
            if (typeof f.format_note === 'string' && f.format_note.trim()) return f.format_note.trim();
            if (typeof f.resolution === 'string' && f.resolution.trim()) return f.resolution.trim();
            return null;
        })
        .filter((label: string | null): label is string => Boolean(label))
        .map((label: string) => {
            const numeric = extractHeightValue(label);
            return numeric > 0 ? `${numeric}p` : label;
        });

    return Array.from(new Set<string>(candidates)).sort((a, b) => {
        const heightDiff = extractHeightValue(b) - extractHeightValue(a);
        return heightDiff !== 0 ? heightDiff : b.localeCompare(a);
    });
}

/** Check if a yt-dlp format is audio-only */
function isAudioOnlyFormat(f: any): boolean {
    // yt-dlp marks audio-only formats in various ways
    if (f.resolution === 'audio only') return true;
    if (f.vcodec === 'none' && f.acodec && f.acodec !== 'none') return true;
    // No height and has an audio codec or format_note mentions audio
    if (!f.height && f.acodec && f.acodec !== 'none') return true;
    if (typeof f.format_note === 'string' && f.format_note.toLowerCase().includes('audio')) return true;
    return false;
}

/** Extract available audio qualities from yt-dlp format list */
function extractAudioQualities(formats: any[]): string[] {
    const audioFormats = formats.filter(isAudioOnlyFormat);

    if (!audioFormats.length) return [];

    // Even if abr is missing, presence of audio formats means we can offer quality tiers
    const qualities: string[] = ['high', 'medium', 'low'];
    return qualities;
}

// ── Generic download handler ───────────────────────────────────────────

async function downloadMedia(
    url: string,
    type: DownloadType,
    platform: string,
    options?: DownloadOptions
): Promise<DownloadResult> {
    let outputPath = '';
    try {
        console.log(`Starting ${platform} download for URL: ${url}`);

        const cleanUrl = isYouTubeUrl(url) ? normalizeYouTubeUrl(url) : url;
        const ext = type === 'audio' ? 'm4a' : 'mp4';
        const tempFilename = `${platform.toLowerCase()}_${Date.now()}.${ext}`;
        outputPath = path.join(downloadsDir, tempFilename);

        // Fetch metadata via yt-dlp
        let videoInfo: any = null;
        try {
            const { stdout: infoJson } = await execFileAsync('yt-dlp', [
                cleanUrl, '--dump-json', '--no-warnings', ...getYtdlpCookieArgs()
            ], { timeout: YTDLP_TIMEOUT_MS, maxBuffer: YTDLP_MAX_BUFFER });
            videoInfo = JSON.parse(infoJson);
            console.log(`${platform} info retrieved successfully`);
        } catch (infoError: any) {
            if (infoError?.killed) {
                throw new Error('Download timed out. The video may be too large or the server may be busy');
            }
            const stderr = infoError?.stderr || '';
            if (stderr) {
                throw new Error(parseYtdlpError(stderr, platform));
            }
            throw new Error('Could not get video information. The video might be private or restricted.');
        }

        // Select format based on quality preference and available formats
        const formats = (videoInfo?.formats ?? []) as YtFormat[];
        const { formatArg, qualityLabel: selectedQualityLabel } = selectFormat(formats, type, options);
        let qualityLabel = selectedQualityLabel;

        console.log(`Selected format: ${formatArg}`);

        // Build download args
        const dlArgs = [
            cleanUrl,
            '-f', formatArg,
            '-o', outputPath,
            '--no-warnings',
            '--progress',
            '--newline',
            ...getYtdlpCookieArgs(),
        ];

        // For video with adaptive formats (video+audio merge), ensure mp4 output
        if (type === 'video' && formatArg.includes('+')) {
            dlArgs.push('--merge-output-format', 'mp4');
        }

        // YouTube: write info json for extra metadata
        if (isYouTubeUrl(url)) {
            dlArgs.push('--write-info-json');
        }

        // Execute download
        try {
            const { stderr } = await execFileAsync('yt-dlp', dlArgs, {
                timeout: YTDLP_TIMEOUT_MS,
                maxBuffer: YTDLP_MAX_BUFFER,
            });

            if (stderr && stderr.includes('ERROR')) {
                console.error(`${platform} download error:`, stderr);
                throw new Error(parseYtdlpError(stderr, platform));
            }
        } catch (dlError: any) {
            if (dlError?.killed) {
                throw new Error('Download timed out. The video may be too large or the server may be busy');
            }
            if (dlError?.stderr) {
                console.error(`yt-dlp stderr for ${platform}:`, dlError.stderr);
                throw new Error(parseYtdlpError(dlError.stderr, platform));
            }
            throw dlError;
        }

        // Wait for file with polling
        const fileExists = await waitForFile(outputPath);
        if (!fileExists) {
            console.error('File not found at path:', outputPath);
            throw new Error('Downloaded file not found');
        }

        const stats = fs.statSync(outputPath);
        console.log(`Downloaded file size: ${stats.size} bytes`);

        if (stats.size < MIN_DOWNLOAD_SIZE_BYTES) {
            console.error('File too small:', stats.size);
            throw new Error('Downloaded file is too small, download may have failed');
        }

        // Post-download resize: if user requested a lower quality than what was downloaded
        if (type === 'video' && options?.quality) {
            const requestedHeight = parseQualityHeight(options.quality);
            if (requestedHeight && requestedHeight > 0) {
                const actualHeight = await probeVideoHeight(outputPath);
                if (actualHeight && actualHeight > requestedHeight) {
                    console.log(`Resizing video from ${actualHeight}p to ${requestedHeight}p`);
                    await resizeVideo(outputPath, requestedHeight);
                    qualityLabel = `${requestedHeight}p`;
                }
            }
        }

        // Extract metadata
        const meta = {
            title: videoInfo?.title || `${platform} Post`,
            thumbnail: videoInfo?.thumbnail || '',
            channel: videoInfo?.uploader || '',
            hashtags: videoInfo?.tags || [],
            length: videoInfo?.duration_string || (typeof videoInfo?.duration === 'number' ? String(videoInfo.duration) : ''),
            ageRestriction: Boolean(videoInfo?.age_limit && videoInfo.age_limit > 0),
        };

        // Try to read quality from .info.json (YouTube writes this)
        try {
            const infoJsonPath = outputPath + '.info.json';
            if (fs.existsSync(infoJsonPath)) {
                const info = JSON.parse(fs.readFileSync(infoJsonPath, 'utf8'));
                if (info.title) meta.title = info.title;
                if (info.thumbnail) meta.thumbnail = info.thumbnail;
                if (info.uploader) meta.channel = info.uploader;
                if (info.tags) meta.hashtags = info.tags;
                if (info.duration_string) meta.length = info.duration_string;
                if (info.age_limit > 0) meta.ageRestriction = true;

                if (!qualityLabel) {
                    if (info.format_note) qualityLabel = info.format_note;
                    else if (info.height) qualityLabel = `${info.height}p`;
                    else if (info.abr) qualityLabel = `${info.abr}kbps`;
                }
                fs.unlinkSync(infoJsonPath);
            }
        } catch (e) {
            console.warn('Could not read info.json metadata:', e);
        }

        // Rename to final filename
        const finalFilename = buildDownloadFilename(downloadsDir, meta.title, qualityLabel, ext);
        const finalPath = path.join(downloadsDir, finalFilename);
        fs.renameSync(outputPath, finalPath);

        console.log(`${platform} download completed: ${finalFilename}`);
        return {
            success: true,
            downloadUrl: `/downloads/${encodeURIComponent(finalFilename)}`,
            filename: finalFilename,
            quality: qualityLabel,
            ...meta,
        };
    } catch (error: unknown) {
        console.error(`${platform} download error:`, error);
        // Cleanup temp files
        try {
            if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            const infoJsonPath = outputPath + '.info.json';
            if (fs.existsSync(infoJsonPath)) fs.unlinkSync(infoJsonPath);
        } catch (cleanupError) {
            console.error('Error cleaning up files:', cleanupError);
        }
        throw error;
    }
}

// ── Routes ─────────────────────────────────────────────────────────────

// Download route
app.post('/api/download', {
    preHandler: async (request, reply) => {
        if (!FREEMIUM_ENABLED) return; // all downloads free when disabled

        // Authenticated users bypass the guest limit
        try {
            await request.jwtVerify();
            return; // valid JWT — allow
        } catch {
            // No valid JWT — check guest limit
        }

        const count = getGuestDownloadCount(request.ip);
        if (count >= FREEMIUM_LIMIT) {
            return reply.code(403).send({
                success: false,
                error: 'Free download limit reached. Please sign up to continue.',
                requiresAuth: true,
                downloadsUsed: count,
            });
        }
    },
    config: {
        rateLimit: {
            max: 10,
            timeWindow: '1 minute'
        }
    }
}, async (request: FastifyRequest<{ Body: DownloadRequest }>, reply: FastifyReply) => {
    try {
        const { url, type } = request.body;

        const urlValidation = validateUrl(url);
        if (!urlValidation.valid) {
            return reply.code(400).send({ success: false, error: urlValidation.error });
        }

        if (!type || !['video', 'audio'].includes(type)) {
            return reply.code(400).send({ success: false, error: 'Type must be "video" or "audio"' });
        }

        const downloadOptions: DownloadOptions = {
            quality: request.body.quality,
            preferredFormat: request.body.format,
        };

        let platform: string;
        if (isYouTubeUrl(url)) {
            platform = 'YouTube';
        } else if (url.includes('instagram.com')) {
            platform = 'Instagram';
        } else if (url.includes('twitter.com') || url.includes('x.com')) {
            platform = 'Twitter';
        } else {
            return reply.code(400).send({
                success: false,
                error: 'Unsupported platform. Supported: YouTube, Instagram, Twitter/X'
            });
        }

        const result = await downloadMedia(url, type, platform, downloadOptions);

        // Track guest download for freemium limiting
        if (FREEMIUM_ENABLED) {
            let isGuest = true;
            try {
                await request.jwtVerify();
                isGuest = false;
            } catch { /* no valid JWT — guest user */ }
            if (isGuest) {
                logGuestDownload(request.ip);
            }
        }

        return reply.send(result);
    } catch (error: unknown) {
        console.error('Download error:', error);
        const msg = clientErrorMessage(error);
        // User-facing errors (bad URL, no video, private, etc.) → 422; unexpected → 500
        const isUserError = [
            'No video found', 'unavailable', 'private', 'age-restrict',
            'restricted', 'not supported', 'timed out', 'too small',
            'not found', 'Failed to download'
        ].some(k => msg.toLowerCase().includes(k.toLowerCase()));
        return reply.code(isUserError ? 422 : 500).send({
            success: false,
            error: msg,
            ...(isDownloadError(error) && error.filename ? { filename: error.filename } : {})
        });
    }
});

// File serving handled by @fastify/static (registered with prefix '/downloads/')

// Media info endpoint
const infoHandler = async (request: FastifyRequest<{ Querystring: { url: string } }>, reply: FastifyReply) => {
    try {
        const { url } = request.query;

        const urlValidation = validateUrl(url);
        if (!urlValidation.valid) {
            return reply.code(400).send({ success: false, error: urlValidation.error });
        }

        // Determine platform
        const isYT = isYouTubeUrl(url);
        const isInsta = url.includes('instagram.com');
        const isTwitter = url.includes('twitter.com') || url.includes('x.com');

        if (!isYT && !isInsta && !isTwitter) {
            return reply.code(400).send({ success: false, error: 'Unsupported platform' });
        }

        const cleanUrl = isYT ? normalizeYouTubeUrl(url) : url;
        const platformName = isYT ? 'YouTube' : isInsta ? 'Instagram' : 'Twitter';

        let videoInfo: any;
        try {
            const { stdout: infoJson } = await execFileAsync('yt-dlp', [
                cleanUrl, '--dump-json', '--no-warnings', ...getYtdlpCookieArgs()
            ], { timeout: YTDLP_TIMEOUT_MS, maxBuffer: YTDLP_MAX_BUFFER });
            videoInfo = JSON.parse(infoJson);
        } catch (infoError: any) {
            if (infoError?.killed) {
                throw new Error('Download timed out. The video may be too large or the server may be busy');
            }
            const stderr = infoError?.stderr || '';
            if (stderr) {
                throw new Error(parseYtdlpError(stderr, platformName));
            }
            throw new Error('Could not get video information. The video might be private or restricted.');
        }

        const rawFormats = videoInfo.formats || [];
        const nativeQualities = extractQualities(rawFormats);
        const audioQualities = extractAudioQualities(rawFormats);

        // Add standard downscale tiers below the highest native quality
        const standardTiers = [1080, 720, 480, 360];
        const maxNativeHeight = nativeQualities.length > 0
            ? parseQualityHeight(nativeQualities[0]) ?? 0
            : 0;
        const qualities = maxNativeHeight > 0
            ? Array.from(new Set([
                ...nativeQualities,
                ...standardTiers
                    .filter(h => h < maxNativeHeight)
                    .map(h => `${h}p`),
            ])).sort((a, b) => {
                const ha = parseQualityHeight(a) ?? 0;
                const hb = parseQualityHeight(b) ?? 0;
                return hb - ha;
            })
            : nativeQualities;

        const info: any = {
            title: videoInfo.title || `${platformName} Post`,
            duration: videoInfo.duration,
            thumbnail: videoInfo.thumbnail || '',
            author: videoInfo.uploader || 'Unknown',
            qualities,
            audioQualities,
        };

        // Include detailed format list for YouTube (UI uses it for format selection)
        if (isYT) {
            info.formats = rawFormats.map((format: any) => ({
                quality: format.format_note || format.height,
                mimeType: format.ext,
                hasAudio: format.acodec !== 'none',
                hasVideo: format.vcodec !== 'none',
                container: format.ext,
                contentLength: format.filesize,
            }));
        }

        return reply.send({ success: true, ...info });
    } catch (error) {
        console.error('Info error:', error);
        const msg = clientErrorMessage(error);
        const isUserError = [
            'No video found', 'unavailable', 'private', 'age-restrict',
            'restricted', 'not supported', 'timed out', 'Failed to download'
        ].some(k => msg.toLowerCase().includes(k.toLowerCase()));
        return reply.code(isUserError ? 422 : 500).send({ success: false, error: msg });
    }
};

app.get('/api/info', infoHandler);
app.get('/api/media/info', infoHandler);

// Download status endpoint (downloads are synchronous, so this is a stub for UI compatibility)
app.get('/api/media/status/:downloadId', async (request, reply) => {
    const { downloadId } = request.params as { downloadId: string };
    return reply.send({
        success: true,
        downloadId,
        status: 'completed',
        progress: 100,
    });
});

// Channel posts endpoint — fetch creator posts with pagination (12 per page)
app.post('/api/channel-posts', {
    config: {
        rateLimit: { max: 10, timeWindow: '1 minute' }
    }
}, async (request: FastifyRequest<{ Body: { url: string; page?: number } }>, reply: FastifyReply) => {
    try {
        const { url, page = 1 } = request.body;
        const PAGE_SIZE = 12;

        const urlValidation = validateUrl(url);
        if (!urlValidation.valid) {
            return reply.code(400).send({ success: false, error: urlValidation.error });
        }

        const isYT = isYouTubeUrl(url);
        const isInsta = url.includes('instagram.com');
        const isTwitter = url.includes('twitter.com') || url.includes('x.com');
        const isTikTok = url.includes('tiktok.com');
        const isFacebook = url.includes('facebook.com') || url.includes('fb.com');

        // Determine platform name for URLs
        const platformName = isYT ? 'YouTube' : isInsta ? 'Instagram' : isTwitter ? 'Twitter/X' : isTikTok ? 'TikTok' : isFacebook ? 'Facebook' : 'Unknown';

        // Instagram — uses mobile API (no auth required)
        if (isInsta) {
            let profileUrl = url;

            // If given a reel/post URL (not a profile URL), resolve the uploader's profile via yt-dlp
            const isReelOrPost = /instagram\.com\/(reel|p|tv)\//.test(url);
            if (isReelOrPost) {
                try {
                    // yt-dlp returns 'NA' for uploader_url on Instagram; use 'channel' field instead
                    const { stdout: channelLine } = await execFileAsync('yt-dlp', [
                        url.split('?')[0], // strip query params
                        '--print', 'channel',
                        '--no-warnings',
                        '--no-download',
                        '--playlist-items', '1',
                        ...getYtdlpCookieArgs(),
                    ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
                    const username = channelLine.trim().toLowerCase();
                    if (username && username !== 'na' && username !== 'none') {
                        profileUrl = `https://www.instagram.com/${username}`;
                    }
                } catch {
                    // Fall through to using original URL (will fail gracefully in getInstagramUserPosts)
                }
            }

            const result = await getInstagramUserPosts(profileUrl, page, PAGE_SIZE);
            if (result.error) {
                return reply.send({ success: true, posts: [], hasMore: false, comingSoon: false, message: result.error });
            }
            return reply.send({ success: true, posts: result.posts, hasMore: result.hasMore, comingSoon: false });
        }

        // Twitter/X — uses syndication API (no auth required)
        if (isTwitter) {
            const result = await getTwitterUserPosts(url, page, PAGE_SIZE);
            if (result.error) {
                return reply.send({ success: true, posts: [], hasMore: false, comingSoon: false, message: result.error });
            }
            return reply.send({ success: true, posts: result.posts, hasMore: result.hasMore, comingSoon: false });
        }

        // TikTok, Facebook: batch not yet supported
        if (!isYT) {
            return reply.send({
                success: true,
                posts: [],
                hasMore: false,
                comingSoon: true,
                message: `Batch downloads from ${platformName} are coming soon. Individual downloads still work!`,
            });
        }

        // Calculate playlist item range for pagination
        const startItem = (page - 1) * PAGE_SIZE + 1;
        const endItem = page * PAGE_SIZE;
        // Fetch one extra to know if there's a next page
        const fetchEnd = endItem + 1;

        // YouTube only from here — resolve channel URL via yt-dlp
        // Use --print to extract only channel_url (avoids massive --dump-json output)
        let creatorUrl: string;
        try {
            const normalizedUrl = normalizeYouTubeUrl(url);

            // If URL is already a channel/user URL, use it directly
            if (/youtube\.com\/(channel|c|user|@)/.test(normalizedUrl)) {
                creatorUrl = normalizedUrl.replace(/\/$/, '') + '/videos';
            } else {
                // It's a video URL — extract channel_url with lightweight --print
                const { stdout: channelUrl } = await execFileAsync('yt-dlp', [
                    normalizedUrl, '--print', 'channel_url', '--no-warnings', '--no-download', '--playlist-items', '1',
                    ...getYtdlpCookieArgs(),
                ], { timeout: YTDLP_TIMEOUT_MS, maxBuffer: 1024 * 1024 });

                creatorUrl = channelUrl.trim();
                if (creatorUrl) {
                    creatorUrl = creatorUrl.replace(/\/$/, '') + '/videos';
                }
            }

            if (!creatorUrl) {
                return reply.send({ success: true, posts: [], hasMore: false, comingSoon: false });
            }
        } catch (err) {
            console.error('Failed to resolve YouTube channel URL:', err);
            return reply.send({ success: true, posts: [], hasMore: false, comingSoon: false });
        }

        // Step 2: Fetch posts from the creator's page with pagination
        // Try /videos first; if channel has no videos tab (e.g. Shorts-only), fall back to /shorts
        const ytdlpPlaylistArgs = [
            '--flat-playlist',
            '--dump-json',
            '--no-warnings',
            '--playlist-items', `${startItem}:${fetchEnd}`,
            ...getYtdlpCookieArgs(),
        ];

        let stdout: string;
        try {
            ({ stdout } = await execFileAsync('yt-dlp', [creatorUrl, ...ytdlpPlaylistArgs], {
                timeout: YTDLP_TIMEOUT_MS,
                maxBuffer: YTDLP_MAX_BUFFER,
            }));
        } catch (err: any) {
            const errMsg = (err?.stderr || err?.message || '').toLowerCase();
            if (errMsg.includes('does not have a videos tab') || errMsg.includes('no videos')) {
                // Retry with /shorts tab
                const shortsUrl = creatorUrl.replace(/\/videos$/, '/shorts');
                ({ stdout } = await execFileAsync('yt-dlp', [shortsUrl, ...ytdlpPlaylistArgs], {
                    timeout: YTDLP_TIMEOUT_MS,
                    maxBuffer: YTDLP_MAX_BUFFER,
                }));
            } else {
                throw err;
            }
        }

        const allParsed = stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line: string) => {
                try {
                    const entry = JSON.parse(line);
                    const entryId = entry.id || '';

                    // Build YouTube URL if not already a full URL
                    let postUrl = entry.url || entry.webpage_url || '';
                    if (!postUrl.startsWith('http')) {
                        postUrl = `https://www.youtube.com/watch?v=${entryId}`;
                    }

                    return {
                        id: entryId,
                        title: entry.title || 'Untitled',
                        thumbnail: entry.thumbnail || entry.thumbnails?.[0]?.url || '',
                        duration: entry.duration || null,
                        url: postUrl,
                        platform: platformName,
                    };
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        // Check if there are more pages
        const hasMore = allParsed.length > PAGE_SIZE;
        const posts = allParsed.slice(0, PAGE_SIZE);

        return reply.send({ success: true, posts, hasMore, comingSoon: false });
    } catch (error) {
        console.error('Channel posts error:', error);
        return reply.code(500).send({ success: false, error: clientErrorMessage(error) });
    }
});

// Guest remaining downloads endpoint
app.get('/api/downloads/remaining', async (request, reply) => {
    const used = getGuestDownloadCount(request.ip);
    return reply.send({
        freemiumEnabled: FREEMIUM_ENABLED,
        total: FREEMIUM_LIMIT,
        used,
        remaining: Math.max(0, FREEMIUM_LIMIT - used),
    });
});

// Root route
app.get('/', async () => {
    return { message: 'Social Media Downloader API is running' };
});

// Health check route
app.get('/health', async () => {
    const checks: Record<string, string> = { status: 'ok' };

    try {
        await fs.promises.access(downloadsDir, fs.constants.W_OK);
        checks.downloadsDir = 'writable';
    } catch {
        checks.downloadsDir = 'not writable';
        checks.status = 'degraded';
    }

    try {
        await execFileAsync('yt-dlp', ['--version']);
        checks.ytDlp = 'available';
    } catch {
        checks.ytDlp = 'not found';
        checks.status = 'degraded';
    }

    return checks;
});

// ── Download cleanup scheduler ─────────────────────────────────────────

function cleanupOldDownloads() {
    try {
        const files = fs.readdirSync(downloadsDir);
        const now = Date.now();
        let cleaned = 0;

        for (const file of files) {
            const filePath = path.join(downloadsDir, file);
            try {
                const stats = fs.statSync(filePath);
                if (stats.isFile() && (now - stats.mtimeMs) > CLEANUP_MAX_AGE_MS) {
                    fs.unlinkSync(filePath);
                    cleaned++;
                }
            } catch { /* skip files we can't stat */ }
        }

        if (cleaned > 0) {
            console.log(`Cleanup: removed ${cleaned} file(s) older than 1 hour`);
        }
    } catch (error) {
        console.error('Cleanup error:', error);
    }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

// ── Server lifecycle ───────────────────────────────────────────────────

const start = async () => {
    try {
        const port = Number(process.env.PORT ?? 2500);
        const host = process.env.HOST ?? '0.0.0.0';
        await app.listen({ port, host });
        console.log(`Server is running on ${host}:${port}`);

        // Start cleanup scheduler
        cleanupTimer = setInterval(cleanupOldDownloads, CLEANUP_INTERVAL_MS);
        // Run once on startup
        cleanupOldDownloads();
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

// Graceful shutdown
async function gracefulShutdown(signal: string) {
    console.log(`Received ${signal}, shutting down gracefully...`);
    if (cleanupTimer) clearInterval(cleanupTimer);
    try {
        closeDatabase();
        await app.close();
        console.log('Server closed');
    } catch (err) {
        console.error('Error during shutdown:', err);
    }
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    app.log.error({ err }, 'Uncaught Exception');
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (err) => {
    app.log.error({ err }, 'Unhandled Rejection');
    gracefulShutdown('unhandledRejection');
});

if (process.env.NODE_ENV !== 'test') {
    start();
}
