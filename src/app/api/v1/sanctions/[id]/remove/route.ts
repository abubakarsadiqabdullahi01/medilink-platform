import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { removeSanctionedEntrySchema } from '@/modules/practitioners/presentation/sanction-schemas';
import { removeSanctionedEntry } from '@/modules/practitioners/application/sanctions';

/** POST /api/v1/sanctions/:id/remove — take an entry off, with a reason, then screen everybody again. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: removeSanctionedEntrySchema,
      permission: 'credential.review',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        removeSanctionedEntry({ entryId: input.id, actorId: session.userId, reason: input.reason }),
    },
    params,
  );
}
