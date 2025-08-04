import { vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

export const mockFastifyInstance = {
    jwt: {
        sign: vi.fn().mockReturnValue('mock-jwt-token'),
        verify: vi.fn().mockReturnValue({ id: '1', email: 'test@example.com' })
    },
    log: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
    }
} as unknown as FastifyInstance; 
