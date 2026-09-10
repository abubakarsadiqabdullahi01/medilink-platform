import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { slotIdSchema } from '@/modules/availability/presentation/schemas';
import { removeBlock } from '@/modules/availability/application/availability';

/** DELETE /api/v1/availability/blocks/:id — a period away that is no longer. */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: slotIdSchema,
      permission: 'availability.write',
      scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
      action: async ({ input, session }) => {
        await removeBlock({ userId: session.userId, blockId: input.id });
        return { status: 'removed', id: input.id };
      },
    },
    params,
  );
}
