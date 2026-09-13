import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  attachEvidenceSchema,
  disputeIdSchema,
} from '@/modules/disputes/presentation/schemas';
import { attachEvidence, listEvidence } from '@/modules/disputes/application/evidence';

/**
 * POST /api/v1/disputes/:id/evidence — claims an uploaded object as evidence.
 *
 * The object must belong to the person claiming it, or one party could attach
 * another's file by guessing a key. Nothing removes evidence: a dispute where
 * one side can withdraw an inconvenient photograph after the other has seen
 * it is not a record of anything.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: attachEvidenceSchema,
      permission: 'dispute.manage',
      scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
      action: async ({ input, session }) =>
        attachEvidence({
          disputeId: input.id,
          userId: session.userId,
          objectKey: input.objectKey,
          note: input.note,
        }),
    },
    params,
  );
}

/** GET — everything attached, for the officer working the case. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: disputeIdSchema,
      permission: 'dispute.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input }) => ({ evidence: await listEvidence(input.id) }),
    },
    params,
  );
}
