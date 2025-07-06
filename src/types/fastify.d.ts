import { JwtPayload } from './auth.types';

declare module 'fastify' {
    interface FastifyRequest {
        user?: JwtPayload;
    }
} 
