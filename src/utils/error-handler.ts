import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { appConfig } from '../config/app.config.js';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
}

export class CustomError extends Error implements AppError {
  statusCode: number;
  code: string;
  details?: any;

  constructor(message: string, statusCode: number = 500, code?: string, details?: any) {
    super(message);
    this.name = 'CustomError';
    this.statusCode = statusCode;
    this.code = code || 'INTERNAL_ERROR';
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const requestId = request.id;
  const method = request.method;
  const url = request.url;
  
  // Log error with context
  request.log.error({
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code,
      statusCode: error.statusCode,
    },
    request: {
      id: requestId,
      method,
      url,
      headers: appConfig.enableDetailedErrors ? request.headers : undefined,
      body: appConfig.enableDetailedErrors ? request.body : undefined,
    }
  }, 'Request error occurred');

  // Determine status code
  let statusCode = 500;
  if (error.statusCode) {
    statusCode = error.statusCode;
  } else if (error.code === 'FST_ERR_VALIDATION') {
    statusCode = 400;
  } else if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
    statusCode = 401;
  }

  // Prepare error response
  const errorResponse: any = {
    success: false,
    error: {
      message: error.message || 'Internal Server Error',
      code: error.code || 'INTERNAL_ERROR',
      requestId,
      timestamp: new Date().toISOString(),
    }
  };

  // Add details in development mode
  if (appConfig.enableDetailedErrors) {
    errorResponse.error.stack = error.stack;
    errorResponse.error.details = (error as AppError).details;
  }

  // Send error response
  reply.status(statusCode).send(errorResponse);
};

// Specific error creators
export const createValidationError = (message: string, details?: any) => 
  new CustomError(message, 400, 'VALIDATION_ERROR', details);

export const createNotFoundError = (resource: string) => 
  new CustomError(`${resource} not found`, 404, 'NOT_FOUND');

export const createUnauthorizedError = (message: string = 'Unauthorized') => 
  new CustomError(message, 401, 'UNAUTHORIZED');

export const createForbiddenError = (message: string = 'Forbidden') => 
  new CustomError(message, 403, 'FORBIDDEN');

export const createRateLimitError = () => 
  new CustomError('Too many requests', 429, 'RATE_LIMIT_EXCEEDED');

export const createDownloadError = (message: string, details?: any) => 
  new CustomError(message, 500, 'DOWNLOAD_ERROR', details);
