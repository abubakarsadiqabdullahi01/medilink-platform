import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  listDisputesSchema,
  raiseDisputeSchema,
} from '@/modules/disputes/presentation/schemas';
import { listDisputesFor, raiseDispute } from '@/modules/disputes/application/dispute';

/**
 * POST /api/v1/assignments/:id/disputes — either party opens a case.
 *
 * The scope is SELF when a practitioner raises it and FACILITY when a
 * facility does, which is how one permission serves both sides. An operations
 * officer holds `dispute.manage` too and still cannot open one: `partyFor`
 * returns null for somebody on neither side of the shift.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: raiseDisputeSchema,
      permission: 'dispute.manage',
      scope: (input, session) =>
        input.facilityId
          ? { type: 'FACILITY', id: input.facilityId }
          : { type: 'SELF', id: session.userId },
      action: async ({ input, session }) =>
        raiseDispute({
          assignmentId: input.id,
          actorId: session.userId,
          facilityId: input.facilityId,
          category: input.category,
          reason: input.reason,
        }),
    },
    params,
  );
}

/** GET — every case over this shift, withdrawn and dismissed included. */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: listDisputesSchema,
      permission: 'dispute.manage',
      scope: (input, session) => ({
        type: input.scopeType,
        id: input.scopeType === 'SELF' ? (input.scopeId ?? session.userId) : input.scopeId,
      }),
      action: async ({ input }) => ({ disputes: await listDisputesFor(input.id) }),
    },
    params,
  );
}
