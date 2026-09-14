import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  acceptAgreementSchema,
  emptySelfSchema,
  publishAgreementSchema,
} from '@/modules/audit-compliance/presentation/consent-schemas';
import {
  acceptAgreement,
  currentAgreements,
  publishAgreement,
} from '@/modules/audit-compliance/application/consent';

/** GET — what is in force, and whether the caller has accepted it. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: emptySelfSchema,
    permission: 'practitioner.profile.read',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ session }) => ({ agreements: await currentAgreements(session.userId) }),
  });
}

/**
 * POST — accept the version named in the body.
 *
 * The address and user agent are recorded alongside. That is evidence of the
 * act rather than tracking: it is what an "I never agreed to that" dispute is
 * actually settled with, and it is in the subject's own export.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: acceptAgreementSchema,
    permission: 'practitioner.profile.write',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ input, session }) =>
      acceptAgreement({
        userId: session.userId,
        versionId: input.versionId,
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      }),
  });
}

/**
 * PATCH — publish a new version, retiring the one it replaces.
 *
 * `config.manage` at PLATFORM: an agreement is a controlled document, and
 * whoever can change the credential vocabulary can change this.
 */
export async function PATCH(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: publishAgreementSchema,
    permission: 'config.manage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input, session }) =>
      publishAgreement({ ...input, actorId: session.userId }),
  });
}
