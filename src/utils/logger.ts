import pino from 'pino';
import { appConfig, isProduction } from '../config/app.config.js';

// Create logger instance
export const logger = pino({
  level: appConfig.logLevel,
  transport: isProduction ? undefined : {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname'
    }
  },
  formatters: {
    level: (label) => {
      return { level: label };
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'token',
      'secret',
      'key'
    ],
    censor: '[REDACTED]'
  }
});

// Request logger middleware
export const createRequestLogger = () => {
  return {
    logger,
    serializers: {
      req: (req: any) => ({
        method: req.method,
        url: req.url,
        headers: isProduction ? undefined : req.headers,
        remoteAddress: req.ip,
        remotePort: req.connection?.remotePort
      }),
      res: (res: any) => ({
        statusCode: res.statusCode,
        headers: isProduction ? undefined : res.getHeaders()
      })
    }
  };
};
