import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { emptySelfSchema } from '@/modules/audit-compliance/presentation/consent-schemas';
import { assessErasure } from '@/modules/audit-compliance/application/data-subject';

/**
 * GET /api/v1/me/erasure — whether erasure can proceed, and what it would do.
 *
 * Answered before anybody asks, because the surprising part — that an audit
 * row and a ledger entry survive it — is better read in advance than
 * discovered in a refusal.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: emptySelfSchema,
    permission: 'practitioner.profile.read',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ session }) => assessErasure(session.userId),
  });
}
