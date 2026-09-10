import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  facilityIdSchema,
  updateFacilitySchema,
} from '@/modules/facilities/presentation/schemas';
import { getFacility, updateFacility } from '@/modules/facilities/application/facility';

/**
 * /api/v1/facilities/:id — read (GET) or edit (PATCH) one facility.
 *
 * Scoped to FACILITY:<id> from the URL, so a facility reaches its own record
 * and no other; a PLATFORM grant satisfies the same check, which is how
 * operations and compliance reach any facility without a separate route.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: facilityIdSchema,
      permission: 'facility.read',
      scope: (input) => ({ type: 'FACILITY', id: input.id }),
      action: async ({ input }) => getFacility(input.id),
    },
    params,
  );
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: updateFacilitySchema,
      permission: 'facility.write',
      scope: (input) => ({ type: 'FACILITY', id: input.id }),
      action: async ({ input, session }) =>
        updateFacility({
          facilityId: input.id,
          actorId: session.userId,
          name: input.name,
          addressLine: input.addressLine,
          lgaId: input.lgaId,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          licenceNumber: input.licenceNumber,
          licenceObjectKey: input.licenceObjectKey,
          licenceExpiresAt: input.licenceExpiresAt,
        }),
    },
    params,
  );
}
