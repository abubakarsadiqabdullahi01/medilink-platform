import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { emptySelfSchema } from '@/modules/audit-compliance/presentation/consent-schemas';
import { listOwnRequests } from '@/modules/audit-compliance/application/data-subject';

/** GET — the caller's own requests, and what came of them. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: emptySelfSchema,
    permission: 'practitioner.profile.read',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ session }) => ({ requests: await listOwnRequests(session.userId) }),
  });
}
