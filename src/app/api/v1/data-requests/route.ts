import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  listRequestsSchema,
  raiseRequestSchema,
} from '@/modules/audit-compliance/presentation/consent-schemas';
import { listRequests, raiseRequest } from '@/modules/audit-compliance/application/data-subject';

/**
 * POST /api/v1/data-requests — a subject exercises a right.
 *
 * The deadline is stamped at creation rather than computed on read, so
 * shortening the window later cannot retroactively make an old request late.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: raiseRequestSchema,
    permission: 'practitioner.profile.write',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ input, session }) =>
      raiseRequest({ userId: session.userId, kind: input.kind, detail: input.detail }),
  });
}

/** GET — compliance's queue, closest to its deadline first. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listRequestsSchema,
    permission: 'audit.read',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input }) => ({ requests: await listRequests(input.status) }),
  });
}
