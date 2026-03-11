import type { FastifyInstance } from 'fastify';
import { checkRole } from '../middleware/checkRole.js';
import {
  getAllUsers,
  deleteUser,
  deleteUserDownloads,
  setUserBlocked,
  setUserRole,
  getDbStats,
  clearDownloadLogs,
} from '../db/database.js';

export async function adminRoutes(fastify: FastifyInstance) {
  // GET /api/admin/users — list all users (no passwords)
  fastify.get('/users', { preHandler: checkRole('admin') }, async (_request, reply) => {
    const users = getAllUsers();
    return reply.send({ success: true, users });
  });

  // DELETE /api/admin/users/:email — remove a user and their download history
  fastify.delete<{ Params: { email: string } }>(
    '/users/:email',
    { preHandler: checkRole('admin') },
    async (request, reply) => {
      const { email } = request.params;
      if (!email) return reply.code(400).send({ success: false, error: 'Email required' });

      deleteUserDownloads(email);
      deleteUser(email);
      return reply.send({ success: true, message: `User ${email} removed` });
    }
  );

  // POST /api/admin/users/:email/block — block or unblock a user
  fastify.post<{ Params: { email: string }; Body: { blocked: boolean } }>(
    '/users/:email/block',
    { preHandler: checkRole('admin') },
    async (request, reply) => {
      const { email } = request.params;
      const { blocked } = request.body;

      if (typeof blocked !== 'boolean') {
        return reply.code(400).send({ success: false, error: '"blocked" must be a boolean' });
      }

      setUserBlocked(email, blocked);
      return reply.send({
        success: true,
        message: `User ${email} ${blocked ? 'blocked' : 'unblocked'}`,
      });
    }
  );

  // GET /api/admin/db-stats — database statistics
  fastify.get('/db-stats', { preHandler: checkRole('admin') }, async (_request, reply) => {
    const stats = getDbStats();
    return reply.send({ success: true, stats });
  });

  // DELETE /api/admin/db/clear — clear download logs (not users)
  fastify.delete('/db/clear', { preHandler: checkRole('admin') }, async (_request, reply) => {
    clearDownloadLogs();
    return reply.send({ success: true, message: 'Download logs cleared' });
  });

  // POST /api/admin/db/approve-owner/:email — confirm owner role for a user
  fastify.post<{ Params: { email: string } }>(
    '/db/approve-owner/:email',
    { preHandler: checkRole('admin') },
    async (request, reply) => {
      const { email } = request.params;
      if (!email) return reply.code(400).send({ success: false, error: 'Email required' });

      setUserRole(email, 'owner');
      return reply.send({ success: true, message: `${email} confirmed as owner` });
    }
  );

  // POST /api/admin/restart — restart the API process
  // The process manager (Railway/Fly.io/nodemon) will restart it automatically
  fastify.post('/restart', { preHandler: checkRole('admin') }, async (_request, reply) => {
    reply.send({ success: true, message: 'API restart initiated' });
    setTimeout(() => {
      fastify.log.info('Admin-initiated restart');
      process.exit(0);
    }, 500);
  });
}
