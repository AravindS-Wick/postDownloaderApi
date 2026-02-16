import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { getUser, createUser, userExists, logDownload, getUserDownloads } from '../db/database.js';

interface SignupRequest {
    email: string;
    password: string;
}

interface LogRequest {
    email?: string;
    type: string;
    status: 'attempt' | 'complete' | 'consent';
    meta: any;
    ageConsent: boolean;
}

export default async function userRoutes(fastify: FastifyInstance) {
    // Signup
    fastify.post<{ Body: SignupRequest }>('/signup', async (request: FastifyRequest<{ Body: SignupRequest }>, reply: FastifyReply) => {
        const { email, password } = request.body;
        if (!email || !password) {
            return reply.code(400).send({ message: 'Email and password required' });
        }

        if (typeof email !== 'string' || email.length > 255 || !email.includes('@')) {
            return reply.code(400).send({ message: 'Invalid email format' });
        }

        if (typeof password !== 'string' || password.length < 6) {
            return reply.code(400).send({ message: 'Password must be at least 6 characters' });
        }

        try {
            if (userExists(email)) {
                return reply.code(409).send({ message: 'User already exists' });
            }

            const hash = await bcrypt.hash(password, 10);
            createUser(email, hash);
            reply.send({ success: true });
        } catch (error) {
            console.error('Signup error:', error);
            return reply.code(500).send({ message: 'Internal server error' });
        }
    });

    // Get profile — supports JWT auth header OR ?email= query param
    fastify.get('/profile', async (request: FastifyRequest<{ Querystring: { email?: string } }>, reply: FastifyReply) => {
        let email = request.query.email;

        // If no email query param, try JWT auth
        if (!email) {
            try {
                await request.jwtVerify();
                const payload = request.user as { userId: string; email: string };
                email = payload.email;
            } catch {
                return reply.code(401).send({ message: 'Email query param or Authorization header required' });
            }
        }

        try {
            const user = getUser(email!);
            if (!user) {
                return reply.code(404).send({ message: 'User not found' });
            }
            const downloads = getUserDownloads(user.email);
            reply.send({ email: user.email, created: user.created_at, downloads });
        } catch (error) {
            console.error('Profile error:', error);
            return reply.code(500).send({ message: 'Internal server error' });
        }
    });

    // Log download attempt/completion/consent
    fastify.post<{ Body: LogRequest }>('/log', async (request: FastifyRequest<{ Body: LogRequest }>, reply: FastifyReply) => {
        try {
            const { email, type, status, meta, ageConsent } = request.body;

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
