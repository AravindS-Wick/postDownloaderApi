import fs from 'fs';
import path from 'path';

export function sanitizeFilenameComponent(component: string): string {
    return component
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function buildDownloadFilename(
    baseDir: string,
    title: string,
    qualityLabel: string | undefined,
    extension: string
): string {
    const safeTitle = sanitizeFilenameComponent(title) || 'YouTube Video';
    const safeQuality = sanitizeFilenameComponent(qualityLabel ?? '');
    const formattedQuality = safeQuality ? safeQuality.toUpperCase() : '';
    const base = formattedQuality ? `${safeTitle} - ${formattedQuality}` : safeTitle;
    let candidate = `${base}.${extension}`;
    let counter = 1;

    while (fs.existsSync(path.join(baseDir, candidate))) {
        candidate = `${base} (${counter}).${extension}`;
        counter += 1;
    }

    return candidate;
}

export function isYouTubeUrl(url: string): boolean {
    return url.includes('youtube.com') || url.includes('youtu.be');
}

export function normalizeYouTubeUrl(rawUrl: string): string {
    try {
        const trimmed = rawUrl.trim();
        if (!trimmed) {
            return trimmed;
        }

        const parsed = new URL(trimmed);
        if (parsed.hostname === 'youtu.be') {
            const id = parsed.pathname.replace('/', '');
            const normalized = new URL(`https://www.youtube.com/watch?v=${id}`);
            parsed.searchParams.forEach((value, key) => {
                normalized.searchParams.set(key, value);
            });
            return normalized.toString();
        }

        return parsed.toString();
    } catch {
        return rawUrl;
    }
}
