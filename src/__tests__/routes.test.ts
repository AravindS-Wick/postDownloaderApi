import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { build } from '../app';
import { mockFastifyInstance } from '../__mocks__/fastify.mock';
import { mockPlatformService } from '../__mocks__/platform.service.mock';

describe('Routes', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = await build();
        vi.clearAllMocks();
    });

    describe('GET /api/auth/check-platform/:platform', () => {
        it('should check Instagram platform status', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/auth/check-platform/Instagram'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({
                isConnected: true,
                platform: 'Instagram'
            });
        });

        it('should return 400 for unsupported platform', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/auth/check-platform/Unsupported'
            });

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.payload)).toEqual({
                error: 'Unsupported platform'
            });
        });
    });

    describe('GET /api/auth/url/:platform', () => {
        it('should get Instagram auth URL', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/auth/url/Instagram'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({
                url: 'https://instagram.com/auth'
            });
        });

        it('should return 400 for unsupported platform', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/auth/url/Unsupported'
            });

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.payload)).toEqual({
                error: 'Unsupported platform'
            });
        });
    });

    describe('POST /api/auth/connect/:platform', () => {
        it('should connect Instagram platform', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/auth/connect/Instagram',
                payload: {
                    code: 'test-code'
                }
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({
                platform: 'Instagram',
                isConnected: true
            });
        });

        it('should return 400 for unsupported platform', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/auth/connect/Unsupported',
                payload: {
                    code: 'test-code'
                }
            });

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.payload)).toEqual({
                error: 'Unsupported platform'
            });
        });
    });

    describe('DELETE /api/auth/disconnect/:platform', () => {
        it('should disconnect Instagram platform', async () => {
            const response = await app.inject({
                method: 'DELETE',
                url: '/api/auth/disconnect/Instagram'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({
                platform: 'Instagram',
                isConnected: false
            });
        });

        it('should return 400 for unsupported platform', async () => {
            const response = await app.inject({
                method: 'DELETE',
                url: '/api/auth/disconnect/Unsupported'
            });

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.payload)).toEqual({
                error: 'Unsupported platform'
            });
        });
    });

    describe('POST /api/download', () => {
        it('should download Instagram media', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/download',
                payload: {
                    url: 'https://instagram.com/p/123'
                }
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual({
                url: 'https://instagram.com/media/123',
                type: 'image',
                title: 'Test Post'
            });
        });

        it('should return 400 for invalid URL', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/download',
                payload: {
                    url: 'invalid-url'
                }
            });

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.payload)).toEqual({
                error: 'Invalid URL format'
            });
        });
    });
}); 
