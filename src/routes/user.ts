import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getUser, logDownload, getUserDownloads } from '../db/database.js';
import { VALID_DOWNLOAD_TYPES, VALID_LOG_STATUSES, MAX_META_SIZE } from '../utils/validation.js';

interface LogRequest {
    email?: string;
    type: string;
    status: 'attempt' | 'complete' | 'consent';
    meta: any;
    ageConsent: boolean;
}

export default async function userRoutes(fastify: FastifyInstance) {
    // Signup — DEPRECATED: use /api/auth/register instead
    fastify.post('/signup', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        return reply.code(410).send({
            success: false,
            message: 'This endpoint is deprecated. Use POST /api/auth/register instead.'
        });
    });

    // Get profile — requires JWT auth
    fastify.get('/profile', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            await request.jwtVerify();
            const payload = request.user as { userId: string; email: string };
            const email = payload.email;

            const user = getUser(email);
            if (!user) {
                return reply.code(404).send({ message: 'User not found' });
            }
            const downloads = getUserDownloads(user.email);
            reply.send({ email: user.email, created: user.created_at, downloads });
        } catch {
            return reply.code(401).send({ message: 'Authentication required' });
        }
    });

    // Log download attempt/completion/consent — 60/min, high because it fires per download step
    fastify.post<{ Body: LogRequest }>('/log', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request: FastifyRequest<{ Body: LogRequest }>, reply: FastifyReply) => {
        try {
            const { email, type, status, meta, ageConsent } = request.body;

            if (!type || !(VALID_DOWNLOAD_TYPES as readonly string[]).includes(type)) {
                return reply.code(400).send({ message: `Invalid type. Must be one of: ${VALID_DOWNLOAD_TYPES.join(', ')}` });
            }
            if (!status || !(VALID_LOG_STATUSES as readonly string[]).includes(status)) {
                return reply.code(400).send({ message: `Invalid status. Must be one of: ${VALID_LOG_STATUSES.join(', ')}` });
            }
            if (meta && typeof meta === 'object' && JSON.stringify(meta).length > MAX_META_SIZE) {
                return reply.code(400).send({ message: 'Meta data too large' });
            }

            logDownload({
                userEmail: email || null,
                type,
                status,
                meta,
                ageConsent: !!ageConsent,
            });

            reply.send({ success: true });
        } catch (error) {
            console.error('Log error:', error);
            return reply.code(500).send({ message: 'Internal server error' });
        }
    });
}

export { userRoutes };
