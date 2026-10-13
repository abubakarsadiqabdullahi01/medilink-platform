import { z } from 'zod';
import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { performanceReport } from '@/lib/http/timing';

/**
 * GET /api/v1/admin/performance — which routes are slow, slowest first.
 *
 * Aggregated in this process's memory since it last started (see
 * lib/http/timing.ts), so it describes recent traffic, not history. `audit.read`
 * at PLATFORM: it shows route names and timings, never a request's contents.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: z.object({}),
    permission: 'audit.read',
    scope: () => ({ type: 'PLATFORM' }),
    action: async () => performanceReport(),
  });
}
