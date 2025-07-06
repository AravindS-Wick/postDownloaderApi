import type { FastifyRequest, FastifyReply } from 'fastify';
import DownloaderService from '../services/downloader.service';

const downloaderService = new DownloaderService();

interface DownloadRequest {
    url: string;
    type: 'video' | 'audio';
}

export async function downloadContent(request: FastifyRequest<{ Body: DownloadRequest }>, reply: FastifyReply) {
    try {
        const { url } = request.body;

        if (!url) {
            return reply.status(400).send({ error: 'URL is required' });
        }

        const result = await downloaderService.downloadYouTube(url);
        return reply.send(result);
    } catch (error) {
        console.error('Download error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to download content';
        return reply.status(500).send({ error: errorMessage });
    }
} 
