import { z } from 'zod';
import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  listTroubledEvents,
  systemStatus,
} from '@/modules/audit-compliance/application/system-status';

/**
 * GET /api/v1/admin/system — whether the background work is getting done: what
 * is wrong, which events gave up and why, and when each scheduled job last ran.
 *
 * `audit.read` at PLATFORM. It carries delivery state and error text, never what
 * an event carried.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: z.object({}),
    permission: 'audit.read',
    scope: () => ({ type: 'PLATFORM' }),
    action: async () => {
      const [status, events] = await Promise.all([systemStatus(), listTroubledEvents()]);
      return { ...status, events };
    },
  });
}
