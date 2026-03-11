import type { FastifyInstance } from 'fastify';
import { checkRole, requireAuth } from '../middleware/checkRole.js';
import {
  createBugReport,
  getAllBugReports,
  updateBugStatus,
  type BugStatus,
} from '../db/database.js';
import type { JwtPayload } from '../types/auth.types.js';

const VALID_STATUSES: BugStatus[] = [
  'todo', 'inprogress', 'pr-raised', 'verify', 'blocked', 'fixed',
];

export async function bugsRoutes(fastify: FastifyInstance) {
  // POST /api/bugs — submit a bug report (any authenticated user)
  fastify.post<{
    Body: { errorText: string; imageBase64?: string };
  }>(
    '/bugs',
    { preHandler: requireAuth() },
    async (request, reply) => {
      const { errorText, imageBase64 } = request.body;
      const { email } = request.user as JwtPayload;

      if (!errorText || typeof errorText !== 'string' || errorText.trim().length === 0) {
        return reply.code(400).send({ success: false, error: 'Error description is required' });
      }
      if (errorText.length > 5000) {
        return reply.code(400).send({ success: false, error: 'Error description too long (max 5000 chars)' });
      }

      if (imageBase64 !== undefined) {
        if (typeof imageBase64 !== 'string') {
          return reply.code(400).send({ success: false, error: 'imageBase64 must be a string' });
        }
        // ~100KB raw → ~140KB base64
        if (imageBase64.length > 145000) {
          return reply.code(400).send({ success: false, error: 'Image too large (max 100KB)' });
        }
        // Basic validation: must be data URI or raw base64
        if (
          imageBase64.length > 0 &&
          !imageBase64.startsWith('data:image/') &&
          !/^[A-Za-z0-9+/=]+$/.test(imageBase64.substring(0, 100))
        ) {
          return reply.code(400).send({ success: false, error: 'Invalid image format' });
        }
      }

      const id = createBugReport(email, errorText.trim(), imageBase64);
      return reply.code(201).send({ success: true, id });
    }
  );

  // GET /api/bugs — list all bug reports (admin and tester only)
  fastify.get(
    '/bugs',
    { preHandler: checkRole('admin', 'tester') },
    async (_request, reply) => {
      const reports = getAllBugReports();
      // Strip image data from list view for performance — clients fetch full report separately if needed
      const summary = reports.map(({ image_base64, ...r }) => ({
        ...r,
        has_image: image_base64 !== null && image_base64 !== undefined,
      }));
      return reply.send({ success: true, reports: summary });
    }
  );

  // GET /api/bugs/:id — get single bug report with image (admin and tester)
  fastify.get<{ Params: { id: string } }>(
    '/bugs/:id',
    { preHandler: checkRole('admin', 'tester') },
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      if (isNaN(id)) return reply.code(400).send({ success: false, error: 'Invalid id' });

      const reports = getAllBugReports();
      const report = reports.find((r) => r.id === id);
      if (!report) return reply.code(404).send({ success: false, error: 'Bug report not found' });

      return reply.send({ success: true, report });
    }
  );

  // PATCH /api/bugs/:id — update status (admin only)
  fastify.patch<{
    Params: { id: string };
    Body: { status: BugStatus };
  }>(
    '/bugs/:id',
    { preHandler: checkRole('admin') },
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      if (isNaN(id)) return reply.code(400).send({ success: false, error: 'Invalid id' });

      const { status } = request.body;
      if (!VALID_STATUSES.includes(status)) {
        return reply.code(400).send({
          success: false,
          error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
        });
      }

      updateBugStatus(id, status);
      return reply.send({ success: true, message: `Bug #${id} status updated to "${status}"` });
    }
  );
}
