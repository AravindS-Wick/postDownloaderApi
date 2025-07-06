import type { FastifyInstance } from 'fastify';
import { downloadContent } from '../controllers/downloader.controller.js';
import { Readable } from 'stream';
import DownloaderService from '../services/downloader.service.js';

const downloaderService = new DownloaderService();

interface StreamRequest {
    url: string;
    itag: string;
}

export default async function downloaderRoutes(fastify: FastifyInstance) {
    // Get video info endpoint
    fastify.post('/download', downloadContent);

    // Stream video endpoint
    fastify.get('/stream', async (request, reply) => {
        try {
            const { url, itag } = request.query as StreamRequest;

            if (!url || !itag) {
                return reply.status(400).send({ error: 'URL and itag are required' });
            }

            const stream = await downloaderService.getVideoStream(url, itag);

            // Set appropriate headers
            reply.header('Content-Type', 'video/mp4');
            reply.header('Transfer-Encoding', 'chunked');

            // Pipe the stream to the response
            return reply.send(stream);
        } catch (error: unknown) {
            console.error('Stream error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to stream video';
            return reply.status(500).send({ error: errorMessage });
        }
    });
} 
