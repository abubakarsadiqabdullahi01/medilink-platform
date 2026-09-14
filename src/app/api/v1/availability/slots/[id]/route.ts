import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { slotIdSchema } from '@/modules/availability/presentation/schemas';
import { removeSlot } from '@/modules/availability/application/availability';

/**
 * DELETE /api/v1/availability/slots/:id — withdraw an offered window.
 *
 * A soft delete, so a match run that considered this slot can still be
 * explained afterwards. Someone else's slot is a 404 rather than a 403, for
 * the same reason the credential document route gives one.
 */
export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: slotIdSchema,
      permission: 'availability.write',
      scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
      action: async ({ input, session }) => {
        await removeSlot({ userId: session.userId, slotId: input.id });
        return { status: 'removed', id: input.id };
      },
    },
    params,
  );
}
