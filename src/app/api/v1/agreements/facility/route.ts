import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  acceptFacilityAgreementSchema,
  facilityAgreementsSchema,
} from '@/modules/audit-compliance/presentation/consent-schemas';
import {
  acceptAgreementAs,
  currentAgreements,
} from '@/modules/audit-compliance/application/consent';

/**
 * The facility's terms, from the facility console.
 *
 * `FACILITY_TERMS` could be published and never accepted: the only accept
 * route is the practitioner's, guarded on a permission no hospital account
 * holds. Accepting is still a person's act — the acceptance carries their id
 * — but they make it while acting for a facility, so it is guarded at that
 * facility's scope.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: facilityAgreementsSchema,
    permission: 'facility.read',
    scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
    action: async ({ session }) => ({
      agreements: await currentAgreements(session.userId, 'FACILITY'),
    }),
  });
}

export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: acceptFacilityAgreementSchema,
    permission: 'facility.read',
    scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
    action: async ({ input, session }) =>
      acceptAgreementAs('FACILITY', {
        userId: session.userId,
        versionId: input.versionId,
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      }),
  });
}
