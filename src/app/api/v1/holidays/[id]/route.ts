import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { holidayIdSchema } from '@/modules/rates-contracts/presentation/holiday-schemas';
import { removeHoliday } from '@/modules/rates-contracts/application/holiday';

/** DELETE /api/v1/holidays/:id — take a holiday out of the list, audited. */
export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: holidayIdSchema,
      permission: 'config.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) => {
        await removeHoliday({ id: input.id, actorId: session.userId });
        return { status: 'removed', id: input.id };
      },
    },
    params,
  );
}
