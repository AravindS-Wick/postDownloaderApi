import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { appConfig } from '../config/app.config.js';
import { createRateLimitError } from '../utils/error-handler.js';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  Object.keys(store).forEach(key => {
    if (store[key].resetTime < now) {
      delete store[key];
    }
  });
}, 5 * 60 * 1000);

async function rateLimitPlugin(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip rate limiting for health checks
    if (request.url === '/health' || request.url === '/') {
      return;
    }

    const clientId = request.ip;
    const now = Date.now();
    const windowStart = now - appConfig.rateLimitWindow;

    if (!store[clientId]) {
      store[clientId] = {
        count: 1,
        resetTime: now + appConfig.rateLimitWindow
      };
      return;
    }

    const clientData = store[clientId];

    // Reset if window has passed
    if (clientData.resetTime < now) {
      clientData.count = 1;
      clientData.resetTime = now + appConfig.rateLimitWindow;
      return;
    }

    // Check if limit exceeded
    if (clientData.count >= appConfig.rateLimitMax) {
      const resetIn = Math.ceil((clientData.resetTime - now) / 1000);
      
      reply.header('X-RateLimit-Limit', appConfig.rateLimitMax);
      reply.header('X-RateLimit-Remaining', 0);
      reply.header('X-RateLimit-Reset', resetIn);
      reply.header('Retry-After', resetIn);
      
      throw createRateLimitError();
    }

    // Increment counter
    clientData.count++;

    // Add rate limit headers
    reply.header('X-RateLimit-Limit', appConfig.rateLimitMax);
    reply.header('X-RateLimit-Remaining', Math.max(0, appConfig.rateLimitMax - clientData.count));
    reply.header('X-RateLimit-Reset', Math.ceil((clientData.resetTime - now) / 1000));
  });
}

export default fp(rateLimitPlugin, {
  name: 'rate-limit'
});
