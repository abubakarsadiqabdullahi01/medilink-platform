import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { partyDisputeSchema } from '@/modules/disputes/presentation/schemas';
import { getCaseForParty, getDispute } from '@/modules/disputes/application/dispute';
import { listEvidence, listEvidenceForParty } from '@/modules/disputes/application/evidence';

/**
 * GET /api/v1/disputes/:id — the case and what has been attached to it.
 *
 * The evidence list comes back alongside because a case read without it is
 * one nobody can adjudicate. Two ways in: the adjudicator, at PLATFORM scope, who
 * sees everything with names; and a party, with the facility they act for named,
 * who sees the case and both sides' evidence by side and never by name, and only
 * if they are one of its two sides.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: partyDisputeSchema,
      permission: 'dispute.manage',
      scope: (input) =>
        input.facilityId ? { type: 'FACILITY', id: input.facilityId } : { type: 'PLATFORM' },
      action: async ({ input, session }) => {
        if (input.facilityId) {
          const found = await getCaseForParty(input.id, session.userId);
          return { dispute: found.dispute, side: found.side, evidence: await listEvidenceForParty(input.id, session.userId) };
        }
        return { dispute: await getDispute(input.id), evidence: await listEvidence(input.id) };
      },
    },
    params,
  );
}
