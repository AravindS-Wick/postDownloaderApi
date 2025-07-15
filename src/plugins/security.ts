import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { appConfig } from '../config/app.config.js';

async function securityPlugin(fastify: FastifyInstance) {
  // Security headers
  fastify.addHook('onSend', async (request, reply, payload) => {
    // Security headers
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    // Remove server header
    reply.removeHeader('X-Powered-By');
    reply.removeHeader('Server');
    
    // HSTS in production
    if (appConfig.nodeEnv === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    
    return payload;
  });

  // Request size limits
  fastify.addHook('preValidation', async (request, reply) => {
    const contentLength = request.headers['content-length'];
    if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) { // 10MB limit
      reply.code(413).send({
        success: false,
        error: {
          message: 'Request entity too large',
          code: 'PAYLOAD_TOO_LARGE'
        }
      });
    }
  });

  // Input sanitization for URLs
  fastify.addHook('preValidation', async (request, reply) => {
    if (request.body && typeof request.body === 'object' && 'url' in request.body) {
      const url = (request.body as any).url;
      if (typeof url === 'string') {
        // Basic URL validation
        try {
          new URL(url);
        } catch {
          reply.code(400).send({
            success: false,
            error: {
              message: 'Invalid URL format',
              code: 'INVALID_URL'
            }
          });
        }

        // Block local/private URLs in production
        if (appConfig.nodeEnv === 'production') {
          const urlObj = new URL(url);
          const hostname = urlObj.hostname;
          
          // Ensure hostname exists and is a string
          if (!hostname || typeof hostname !== 'string') {
            reply.code(400).send({
              success: false,
              error: {
                message: 'Invalid hostname in URL',
                code: 'INVALID_HOSTNAME'
              }
            });
            return;
          }
          
          const normalizedHostname = hostname.toLowerCase();
          
          // Block localhost, private IPs, etc.
          if (
            normalizedHostname === 'localhost' ||
            normalizedHostname === '127.0.0.1' ||
            normalizedHostname === '::1' ||
            normalizedHostname.startsWith('192.168.') ||
            normalizedHostname.startsWith('10.') ||
            normalizedHostname.startsWith('172.16.') ||
            normalizedHostname.startsWith('172.17.') ||
            normalizedHostname.startsWith('172.18.') ||
            normalizedHostname.startsWith('172.19.') ||
            normalizedHostname.startsWith('172.2') ||
            normalizedHostname.startsWith('172.30.') ||
            normalizedHostname.startsWith('172.31.')
          ) {
            reply.code(400).send({
              success: false,
              error: {
                message: 'Access to local/private URLs is not allowed',
                code: 'FORBIDDEN_URL'
              }
            });
          }
        }
      }
    }
  });
}

export default fp(securityPlugin, {
  name: 'security'
});
