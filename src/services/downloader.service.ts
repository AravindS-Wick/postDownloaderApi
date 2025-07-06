import { google } from 'googleapis';
import youtubeDl from 'youtube-dl-exec';
import { Readable } from 'stream';
import path from 'path';

interface VideoFormat {
    quality: string;
    itag: string;
    mimeType: string;
    hasAudio: boolean;
    hasVideo: boolean;
    container: string;
    contentLength: string;
    url: string;
}

interface VideoInfo {
    title: string;
    description: string;
    thumbnail: string;
    duration: string;
    author: string;
    publishedAt: string;
    videoId: string;
    formats: {
        video: VideoFormat[];
        audio: VideoFormat[];
    };
}

export default class DownloaderService {
    private youtube;
    private youtubeDl;

    constructor() {
        this.youtube = google.youtube('v3');
        this.youtubeDl = youtubeDl.create({
            binaryPath: '/opt/homebrew/bin/yt-dlp'
        } as any); // Type assertion needed due to incorrect type definitions
    }

    async downloadYouTube(url: string): Promise<VideoInfo> {
        try {
            const videoId = this.extractVideoId(url);
            if (!videoId) {
                throw new Error('Invalid YouTube URL');
            }

            // Get video details from YouTube API
            const response = await this.youtube.videos.list({
                part: ['snippet', 'contentDetails'],
                id: [videoId],
                key: process.env.YOUTUBE_API_KEY
            });

            const video = response.data.items?.[0];
            if (!video) {
                throw new Error('Video not found');
            }

            // Get available formats using youtube-dl
            const formats = await this.youtubeDl(url, {
                dumpSingleJson: true,
                noWarnings: true,
                callHome: false,
                preferFreeFormats: true,
                youtubeSkipDashManifest: true
            });

            // Process formats
            const videoFormats = formats.formats
                .filter((f: any) => f.hasVideo)
                .map((f: any) => ({
                    quality: f.format_note || f.height + 'p',
                    itag: f.format_id,
                    mimeType: f.ext,
                    hasAudio: f.hasAudio,
                    hasVideo: f.hasVideo,
                    container: f.ext,
                    contentLength: f.filesize?.toString() || '0',
                    url: f.url
                }));

            const audioFormats = formats.formats
                .filter((f: any) => f.hasAudio && !f.hasVideo)
                .map((f: any) => ({
                    quality: f.format_note || f.abr + 'kbps',
                    itag: f.format_id,
                    mimeType: f.ext,
                    hasAudio: f.hasAudio,
                    hasVideo: f.hasVideo,
                    container: f.ext,
                    contentLength: f.filesize?.toString() || '0',
                    url: f.url
                }));

            return {
                title: video.snippet?.title || '',
                description: video.snippet?.description || '',
                thumbnail: video.snippet?.thumbnails?.high?.url || '',
                duration: video.contentDetails?.duration || '',
                author: video.snippet?.channelTitle || '',
                publishedAt: video.snippet?.publishedAt || '',
                videoId,
                formats: {
                    video: videoFormats,
                    audio: audioFormats
                }
            };
        } catch (error) {
            console.error('YouTube download error:', error);
            throw error instanceof Error ? error : new Error('Failed to download YouTube video');
        }
    }

    async getVideoStream(url: string, itag: string): Promise<Readable> {
        try {
            const formats = await this.youtubeDl(url, {
                dumpSingleJson: true,
                noWarnings: true,
                callHome: false,
                preferFreeFormats: true,
                youtubeSkipDashManifest: true
            });

            const format = formats.formats.find((f: any) => f.format_id === itag);
            if (!format) {
                throw new Error('Format not found');
            }

            return new Readable({
                read() {
                    // Implementation will be handled by the stream
                }
            });
        } catch (error) {
            console.error('Stream error:', error);
            throw error instanceof Error ? error : new Error('Failed to get video stream');
        }
    }

    private extractVideoId(url: string): string | null {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    // Placeholder methods for other platforms
    async downloadInstagram(url: string): Promise<never> {
        throw new Error('Instagram downloads not implemented');
    }

    async downloadFacebook(url: string): Promise<never> {
        throw new Error('Facebook downloads not implemented');
    }

    async downloadTwitter(url: string): Promise<never> {
        throw new Error('Twitter downloads not implemented');
    }

    async downloadLinkedIn(url: string): Promise<never> {
        throw new Error('LinkedIn downloads not implemented');
    }
} 
