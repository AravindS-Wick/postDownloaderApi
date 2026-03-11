import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload, UserRole } from '../types/auth.types.js';
import { getUser } from '../db/database.js';

/**
 * Role-based access middleware for Fastify routes.
 * Verifies JWT, checks role against allowed list, and blocks blocked users.
 *
 * Usage:
 *   fastify.get('/route', { preHandler: checkRole('admin', 'tester') }, handler)
 */
export function checkRole(...allowedRoles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Authentication required' });
      return;
    }

    const payload = request.user as JwtPayload;

    // Re-check from DB to get live blocked/role status (not just JWT snapshot)
    const user = getUser(payload.email);
    if (!user) {
      reply.code(401).send({ success: false, error: 'User not found' });
      return;
    }

    if (user.is_blocked) {
      reply.code(403).send({ success: false, error: 'Your account has been blocked' });
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      reply.code(403).send({ success: false, error: 'Insufficient permissions' });
      return;
    }
  };
}

/**
 * Middleware that just requires authentication (any role), but still checks blocked status.
 */
export function requireAuth() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ success: false, error: 'Authentication required' });
      return;
    }

    const payload = request.user as JwtPayload;
    const user = getUser(payload.email);

    if (!user) {
      reply.code(401).send({ success: false, error: 'User not found' });
      return;
    }

    if (user.is_blocked) {
      reply.code(403).send({ success: false, error: 'Your account has been blocked' });
      return;
    }
  };
}
