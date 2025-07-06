import { describe, it, expect, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { build } from '../app';
import { mockFastifyInstance } from '../__mocks__/fastify.mock';
import { mockPlatformService } from '../__mocks__/platform.service.mock';

describe('Error Handler', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = await build();
        vi.clearAllMocks();
    });

    it('should handle validation errors', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/auth/connect/Instagram',
            payload: {
                // Missing required 'code' field
            }
        });

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.payload)).toEqual({
            error: 'Validation Error',
            message: expect.stringContaining('code')
        });
    });

    it('should handle authentication errors', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/auth/me',
            headers: {
                'Authorization': 'Bearer invalid-token'
            }
        });

        expect(response.statusCode).toBe(401);
        expect(JSON.parse(response.payload)).toEqual({
            error: 'Unauthorized'
        });
    });

    it('should handle not found errors', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/non-existent'
        });

        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.payload)).toEqual({
            error: 'Not Found'
        });
    });

    it('should handle internal server errors', async () => {
        // Mock a service to throw an error
        vi.spyOn(mockPlatformService, 'getInstagramAuthUrl').mockImplementation(() => {
            throw new Error('Internal server error');
        });

        const response = await app.inject({
            method: 'GET',
            url: '/api/auth/url/Instagram'
        });

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.payload)).toEqual({
            error: 'Internal Server Error'
        });
    });

    it('should handle rate limiting errors', async () => {
        // Simulate rate limiting by making multiple requests
        const requests = Array(100).fill(null).map(() =>
            app.inject({
                method: 'GET',
                url: '/api/auth/check-platform/Instagram'
            })
        );

        const responses = await Promise.all(requests);
        const rateLimitedResponse = responses.find(r => r.statusCode === 429);

        expect(rateLimitedResponse).toBeDefined();
        expect(JSON.parse(rateLimitedResponse!.payload)).toEqual({
            error: 'Too Many Requests'
        });
    });

    it('should handle CORS errors', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/auth/check-platform/Instagram',
            headers: {
                'Origin': 'http://unauthorized-origin.com'
            }
        });

        expect(response.statusCode).toBe(403);
        expect(JSON.parse(response.payload)).toEqual({
            error: 'Forbidden'
        });
    });
}); 
