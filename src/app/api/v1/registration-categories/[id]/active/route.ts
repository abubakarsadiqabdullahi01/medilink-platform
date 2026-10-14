import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { setActiveSchema } from '@/modules/config/hierarchy-schemas';
import { setRegistrationCategoryActive } from '@/modules/config/hierarchy-config';

/** POST /api/v1/registration-categories/:id/active — retire a category, or bring one back. Never deleted. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: setActiveSchema,
      permission: 'config.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        setRegistrationCategoryActive({ id: input.id, active: input.active, actorId: session.userId }),
    },
    params,
  );
}
