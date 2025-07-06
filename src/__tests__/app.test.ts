import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { build } from '../app';
import { mockFastifyInstance } from '../__mocks__/fastify.mock';
import { mockPlatformService } from '../__mocks__/platform.service.mock';

describe('App', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = await build();
        vi.clearAllMocks();
    });

    it('should register auth routes', async () => {
        const routes = app.printRoutes();
        expect(routes).toContain('/api/auth/check-platform/:platform');
        expect(routes).toContain('/api/auth/url/:platform');
        expect(routes).toContain('/api/auth/connect/:platform');
        expect(routes).toContain('/api/auth/disconnect/:platform');
    });

    it('should register download routes', async () => {
        const routes = app.printRoutes();
        expect(routes).toContain('/api/download');
    });

    it('should register CORS', async () => {
        const response = await app.inject({
            method: 'OPTIONS',
            url: '/api/auth/check-platform/Instagram',
            headers: {
                'Origin': 'http://localhost:3000',
                'Access-Control-Request-Method': 'GET'
            }
        });

        expect(response.statusCode).toBe(204);
        expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
        expect(response.headers['access-control-allow-methods']).toContain('GET');
    });

    it('should register JWT plugin', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/auth/me',
            headers: {
                'Authorization': 'Bearer test-token'
            }
        });

        expect(response.statusCode).toBe(401);
    });

    it('should register error handler', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/non-existent'
        });

        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.payload)).toEqual({
            error: 'Not Found'
        });
    });
}); 
