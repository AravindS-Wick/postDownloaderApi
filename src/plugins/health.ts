import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  checks: {
    [key: string]: {
      status: 'pass' | 'fail' | 'warn';
      message?: string;
      duration?: number;
    };
  };
}

async function healthPlugin(fastify: FastifyInstance) {
  const startTime = Date.now();
  
  // Basic health check
  fastify.get('/health', async (request, reply) => {
    const health: HealthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      checks: {}
    };

    // Check memory usage
    const memUsage = process.memoryUsage();
    const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    health.checks.memory = {
      status: memUsageMB > 500 ? 'warn' : 'pass',
      message: `${memUsageMB}MB used`
    };

    // Check disk space for downloads directory
    try {
      const downloadsDir = path.join(__dirname, '..', '..', 'downloads');
      if (fs.existsSync(downloadsDir)) {
        const stats = fs.statSync(downloadsDir);
        health.checks.downloads_directory = {
          status: 'pass',
          message: 'Downloads directory accessible'
        };
      } else {
        health.checks.downloads_directory = {
          status: 'fail',
          message: 'Downloads directory not found'
        };
        health.status = 'degraded';
      }
    } catch (error) {
      health.checks.downloads_directory = {
        status: 'fail',
        message: 'Cannot access downloads directory'
      };
      health.status = 'degraded';
    }

    // Check yt-dlp availability
    try {
      const start = Date.now();
      await execAsync('yt-dlp --version');
      health.checks.ytdlp = {
        status: 'pass',
        message: 'yt-dlp available',
        duration: Date.now() - start
      };
    } catch (error) {
      health.checks.ytdlp = {
        status: 'fail',
        message: 'yt-dlp not available'
      };
      health.status = 'unhealthy';
    }

    // Set response status based on health
    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'degraded' ? 200 : 503;
    
    return reply.status(statusCode).send(health);
  });

  // Detailed health check for monitoring systems
  fastify.get('/health/detailed', async (request, reply) => {
    const health: HealthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      checks: {}
    };

    // All the basic checks plus more detailed ones
    const checks = [
      {
        name: 'memory',
        check: async () => {
          const memUsage = process.memoryUsage();
          const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
          return {
            status: (memUsageMB > 500 ? 'warn' : 'pass') as 'warn' | 'pass',
            message: `Heap: ${memUsageMB}MB, RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`
          };
        }
      },
      {
        name: 'cpu',
        check: async () => {
          const cpuUsage = process.cpuUsage();
          const cpuPercent = Math.round((cpuUsage.user + cpuUsage.system) / 1000000);
          return {
            status: (cpuPercent > 80 ? 'warn' : 'pass') as 'warn' | 'pass',
            message: `CPU usage: ${cpuPercent}%`
          };
        }
      },
      {
        name: 'downloads_directory',
        check: async () => {
          const downloadsDir = path.join(__dirname, '..', '..', 'downloads');
          if (!fs.existsSync(downloadsDir)) {
            return { status: 'fail' as const, message: 'Downloads directory not found' };
          }
          
          // Check write permissions
          const testFile = path.join(downloadsDir, '.health-check');
          try {
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            return { status: 'pass' as const, message: 'Downloads directory writable' };
          } catch {
            return { status: 'fail' as const, message: 'Downloads directory not writable' };
          }
        }
      },
      {
        name: 'ytdlp',
        check: async () => {
          const start = Date.now();
          try {
            const { stdout } = await execAsync('yt-dlp --version');
            return {
              status: 'pass' as const,
              message: `yt-dlp version: ${stdout.trim()}`,
              duration: Date.now() - start
            };
          } catch (error) {
            return {
              status: 'fail' as const,
              message: 'yt-dlp not available or not working'
            };
          }
        }
      }
    ];

    // Run all checks
    for (const { name, check } of checks) {
      try {
        health.checks[name] = await check();
        if (health.checks[name].status === 'fail') {
          health.status = 'unhealthy';
        } else if (health.checks[name].status === 'warn' && health.status === 'healthy') {
          health.status = 'degraded';
        }
      } catch (error) {
        health.checks[name] = {
          status: 'fail' as const,
          message: error instanceof Error ? error.message : 'Unknown error'
        };
        health.status = 'unhealthy';
      }
    }

    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'degraded' ? 200 : 503;
    
    return reply.status(statusCode).send(health);
  });

  // Readiness probe (for Kubernetes)
  fastify.get('/ready', async (request, reply) => {
    // Simple check to see if the app is ready to serve requests
    try {
      const downloadsDir = path.join(__dirname, '..', '..', 'downloads');
      if (!fs.existsSync(downloadsDir)) {
        return reply.status(503).send({ ready: false, message: 'Downloads directory not available' });
      }
      
      return reply.send({ ready: true });
    } catch (error) {
      return reply.status(503).send({ ready: false, message: 'Service not ready' });
    }
  });

  // Liveness probe (for Kubernetes)
  fastify.get('/live', async (request, reply) => {
    // Simple check to see if the app is alive
    return reply.send({ alive: true, timestamp: new Date().toISOString() });
  });
}

export default fp(healthPlugin, {
  name: 'health'
});
