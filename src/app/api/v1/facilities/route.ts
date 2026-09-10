import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  createFacilitySchema,
  listFacilitiesSchema,
} from '@/modules/facilities/presentation/schemas';
import { createFacility, listFacilities } from '@/modules/facilities/application/facility';

/**
 * /api/v1/facilities — create a facility (POST) or list them (GET).
 *
 * Creation is PLATFORM-only: a facility is an organisation, not a person, and
 * verification exists precisely to stop anyone self-declaring a hospital.
 * Medilink operations creates the record and names the representative, who is
 * granted facility_owner over it in the same transaction.
 *
 * Listing accepts either scope the caller states: PLATFORM for the operations
 * and compliance view, FACILITY for a facility's own record.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: createFacilitySchema,
    permission: 'facility.write',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input, session }) => createFacility({ ...input, actorId: session.userId }),
    successStatus: 201,
  });
}

export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listFacilitiesSchema,
    permission: 'facility.read',
    // Unlike the SELF-scoped listings elsewhere, there is no sensible default
    // facility for a caller, so a FACILITY-scoped request must name one and
    // the guard checks the caller holds the permission over exactly that id.
    scope: (input) => ({ type: input.scopeType, id: input.scopeId }),
    action: async ({ input }) => listFacilities(input),
  });
}
