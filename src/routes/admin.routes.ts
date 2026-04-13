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

// Admin rate limit config — tight, these are privileged operations
const adminLimit = { max: 30, timeWindow: '1 minute' };
const adminWriteLimit = { max: 10, timeWindow: '1 minute' };
const restartLimit = { max: 3, timeWindow: '5 minutes' };

export async function adminRoutes(fastify: FastifyInstance) {
  // GET /api/admin/users — list all users (no passwords)
  fastify.get('/users', {
    preHandler: checkRole('admin'),
    config: { rateLimit: adminLimit },
  }, async (_request, reply) => {
    const users = await getAllUsers();
    fastify.log.info({ event: 'admin_list_users', ip: _request.ip }, 'Admin listed users');
    return reply.send({ success: true, users });
  });

  // DELETE /api/admin/users/:email — remove a user and their download history
  fastify.delete<{ Params: { email: string } }>(
    '/users/:email',
    { preHandler: checkRole('admin'), config: { rateLimit: adminWriteLimit } },
    async (request, reply) => {
      const { email } = request.params;
      if (!email) return reply.code(400).send({ success: false, error: 'Email required' });

      fastify.log.warn({ event: 'admin_delete_user', target: email, ip: request.ip }, 'Admin deleted user');
      await deleteUserDownloads(email);
      await deleteUser(email);
      return reply.send({ success: true, message: `User ${email} removed` });
    }
  );

  // POST /api/admin/users/:email/block — block or unblock a user
  fastify.post<{ Params: { email: string }; Body: { blocked: boolean } }>(
    '/users/:email/block',
    { preHandler: checkRole('admin'), config: { rateLimit: adminWriteLimit } },
    async (request, reply) => {
      const { email } = request.params;
      const { blocked } = request.body;

      if (typeof blocked !== 'boolean') {
        return reply.code(400).send({ success: false, error: '"blocked" must be a boolean' });
      }

      fastify.log.warn({ event: 'admin_block_user', target: email, blocked, ip: request.ip }, `Admin ${blocked ? 'blocked' : 'unblocked'} user`);
      await setUserBlocked(email, blocked);
      return reply.send({
        success: true,
        message: `User ${email} ${blocked ? 'blocked' : 'unblocked'}`,
      });
    }
  );

  // GET /api/admin/db-stats — database statistics
  fastify.get('/db-stats', {
    preHandler: checkRole('admin'),
    config: { rateLimit: adminLimit },
  }, async (_request, reply) => {
    const stats = await getDbStats();
    return reply.send({ success: true, stats });
  });

  // DELETE /api/admin/db/clear — clear download logs (not users)
  fastify.delete('/db/clear', {
    preHandler: checkRole('admin'),
    config: { rateLimit: adminWriteLimit },
  }, async (request, reply) => {
    fastify.log.warn({ event: 'admin_clear_logs', ip: request.ip }, 'Admin cleared download logs');
    await clearDownloadLogs();
    return reply.send({ success: true, message: 'Download logs cleared' });
  });

  // POST /api/admin/db/approve-owner/:email — confirm owner role for a user
  fastify.post<{ Params: { email: string } }>(
    '/db/approve-owner/:email',
    { preHandler: checkRole('admin'), config: { rateLimit: adminWriteLimit } },
    async (request, reply) => {
      const { email } = request.params;
      if (!email) return reply.code(400).send({ success: false, error: 'Email required' });

      fastify.log.info({ event: 'admin_approve_owner', target: email, ip: request.ip }, 'Admin approved owner role');
      await setUserRole(email, 'owner');
      return reply.send({ success: true, message: `${email} confirmed as owner` });
    }
  );

  // POST /api/admin/restart — restart the API process
  fastify.post('/restart', {
    preHandler: checkRole('admin'),
    config: { rateLimit: restartLimit },
  }, async (request, reply) => {
    fastify.log.warn({ event: 'admin_restart', ip: request.ip }, 'Admin-initiated API restart');
    reply.send({ success: true, message: 'API restart initiated' });
    setTimeout(() => process.exit(0), 500);
  });
}
