import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

interface User {
    email: string;
    password: string;
    created: number;
    downloads: DownloadLog[];
}

interface DownloadLog {
    email: string | null;
    type: string;
    status: 'attempt' | 'complete' | 'consent';
    meta: any;
    ageConsent: boolean;
    date: number;
}

interface SignupRequest {
    email: string;
    password: string;
}

interface LoginRequest {
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

const USERS_DB = path.join(__dirname, '../../db/users.json');
const GUEST_LOG = path.join(__dirname, '../../db/guest_downloads.json');

function readUsers(): User[] {
    if (!fs.existsSync(USERS_DB)) return [];
    return JSON.parse(fs.readFileSync(USERS_DB, 'utf-8'));
}

function writeUsers(users: User[]): void {
    fs.writeFileSync(USERS_DB, JSON.stringify(users, null, 2));
}

function logGuestDownload(entry: DownloadLog): void {
    let logs: DownloadLog[] = [];
    if (fs.existsSync(GUEST_LOG)) {
        logs = JSON.parse(fs.readFileSync(GUEST_LOG, 'utf-8'));
    }
    logs.unshift(entry);
    fs.writeFileSync(GUEST_LOG, JSON.stringify(logs.slice(0, 1000), null, 2));
}

export default async function userRoutes(fastify: FastifyInstance) {
    // Signup
    fastify.post<{ Body: SignupRequest }>('/signup', async (request: FastifyRequest<{ Body: SignupRequest }>, reply: FastifyReply) => {
        const { email, password } = request.body;
        if (!email || !password) {
            return reply.code(400).send({ message: 'Email and password required' });
        }

        const users = readUsers();
        if (users.find(u => u.email === email)) {
            return reply.code(409).send({ message: 'User already exists' });
        }

        const hash = await bcrypt.hash(password, 10);
        users.push({ email, password: hash, created: Date.now(), downloads: [] });
        writeUsers(users);
        reply.send({ success: true });
    });

    // Login
    fastify.post<{ Body: LoginRequest }>('/login', async (request: FastifyRequest<{ Body: LoginRequest }>, reply: FastifyReply) => {
        const { email, password } = request.body;
        const users = readUsers();
        const user = users.find(u => u.email === email);
        if (!user) {
            return reply.code(401).send({ message: 'Invalid credentials' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return reply.code(401).send({ message: 'Invalid credentials' });
        }

        reply.send({ success: true, email });
    });

    // Get profile
    fastify.get('/profile', async (request: FastifyRequest<{ Querystring: { email: string } }>, reply: FastifyReply) => {
        const { email } = request.query;
        const users = readUsers();
        const user = users.find(u => u.email === email);
        if (!user) {
            return reply.code(404).send({ message: 'User not found' });
        }
        reply.send({ email: user.email, created: user.created, downloads: user.downloads });
    });

    // Social login stubs
    fastify.post('/connect/instagram', async (request: FastifyRequest, reply: FastifyReply) => {
        reply.send({ success: true, message: 'Instagram connect stub' });
    });

    fastify.post('/connect/twitter', async (request: FastifyRequest, reply: FastifyReply) => {
        reply.send({ success: true, message: 'Twitter connect stub' });
    });

    fastify.post('/connect/youtube', async (request: FastifyRequest, reply: FastifyReply) => {
        reply.send({ success: true, message: 'YouTube connect stub' });
    });

    // Log download attempt/completion/consent
    fastify.post<{ Body: LogRequest }>('/log', async (request: FastifyRequest<{ Body: LogRequest }>, reply: FastifyReply) => {
        const { email, type, status, meta, ageConsent } = request.body;
        const entry: DownloadLog = {
            email: email || null,
            type,
            status,
            meta,
            ageConsent: !!ageConsent,
            date: Date.now(),
        };

        if (email) {
            const users = readUsers();
            const user = users.find(u => u.email === email);
            if (user) {
                user.downloads = user.downloads || [];
                user.downloads.unshift(entry);
                writeUsers(users);
                return reply.send({ success: true });
            }
        }

        logGuestDownload(entry);
        reply.send({ success: true });
    });
}

export { userRoutes }; 
