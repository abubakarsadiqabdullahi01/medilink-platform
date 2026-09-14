import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  emptySelfSchema,
  recordConsentSchema,
} from '@/modules/audit-compliance/presentation/consent-schemas';
import { currentConsent, recordConsent } from '@/modules/audit-compliance/application/consent';

/**
 * GET /api/v1/consent — where each purpose stands for the caller.
 *
 * SELF only. Consent is the subject's own record, and an officer wanting to
 * know whether somebody consented reads the audit trail, which says who
 * changed it and when.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: emptySelfSchema,
    permission: 'practitioner.profile.read',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ session }) => ({ consent: await currentConsent(session.userId) }),
  });
}

/**
 * POST — grant or withdraw.
 *
 * Withdrawing something that never rested on consent is refused rather than
 * accepted and ignored: a licence check runs because a regulator requires it,
 * and a button that pretended otherwise would be a lie with a 200 on it.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: recordConsentSchema,
    permission: 'practitioner.profile.write',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ input, session }) => ({
      consent: await recordConsent({
        userId: session.userId,
        purpose: input.purpose,
        granted: input.granted,
        note: input.note,
        actorId: session.userId,
      }),
    }),
  });
}
