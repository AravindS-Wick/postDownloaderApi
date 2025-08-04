import fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authRoutes } from './routes/auth.routes.js';
import { authConfig } from './config/auth.config.js';
import { appConfig, isProduction } from './config/app.config.js';
import jwt from '@fastify/jwt';
import { fileURLToPath } from 'url';
import fastifyStatic from '@fastify/static';

// Import plugins
import rateLimitPlugin from './plugins/rate-limit.js';
import securityPlugin from './plugins/security.js';
import healthPlugin from './plugins/health.js';
import { errorHandler } from './utils/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function build(opts = {}) {
    const app = fastify({
        logger: {
            level: appConfig.logLevel,
            transport: isProduction ? undefined : {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'HH:MM:ss Z',
                    ignore: 'pid,hostname'
                }
            }
        },
        trustProxy: appConfig.trustProxy,
        requestIdHeader: 'x-request-id',
        requestIdLogLabel: 'requestId',
        genReqId: () => crypto.randomUUID(),
        ...opts
    });

    // Register error handler
    app.setErrorHandler(errorHandler);

    // Register plugins
    app.register(securityPlugin);
    app.register(rateLimitPlugin);
    app.register(healthPlugin);

    // Enable CORS with production-ready options
    app.register(cors, {
        origin: appConfig.corsOrigins,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Content-Disposition', 'Accept', 'Origin', 'X-Requested-With', 'X-Request-ID'],
        exposedHeaders: ['Content-Disposition', 'Content-Length', 'Content-Type', 'X-Request-ID'],
        credentials: true,
        preflightContinue: false,
        optionsSuccessStatus: 204,
        maxAge: 86400 // 24 hours
    });

    // Register JWT
    app.register(jwt, {
        secret: authConfig.jwtSecret,
        sign: {
            expiresIn: authConfig.jwtExpiresIn
        }
    });

    // Swagger documentation (only in development)
    if (appConfig.enableSwagger) {
        app.register(swagger, {
            swagger: {
                info: {
                    title: 'Social Media Downloader API',
                    description: 'API for downloading content from various social media platforms',
                    version: '1.0.0'
                },
                host: `localhost:${appConfig.port}`,
                schemes: ['http'],
                consumes: ['application/json'],
                produces: ['application/json']
            }
        });

        app.register(swaggerUi, {
            routePrefix: '/documentation',
            uiConfig: {
                docExpansion: 'list',
                deepLinking: false
            }
        });
    }

    // Create downloads directory if it doesn't exist
    const downloadsDir = path.join(__dirname, '..', 'downloads');
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir);
    }

    // Serve static files from the downloads directory with proper headers
    app.register(fastifyStatic, {
        root: downloadsDir,
        prefix: '/downloads/',
        setHeaders: (res, filePath) => {
            res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        }
    });

    // Register routes
    app.register(authRoutes, { prefix: '/api/auth' });

    // Add root route handler
    app.get('/', async (request, reply) => {
        return { message: 'Social Media Downloader API is running' };
    });

    return app;
}
