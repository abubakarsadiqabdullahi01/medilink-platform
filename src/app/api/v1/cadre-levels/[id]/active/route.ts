import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { setActiveSchema } from '@/modules/config/hierarchy-schemas';
import { setCadreLevelActive } from '@/modules/config/hierarchy-config';

/** POST /api/v1/cadre-levels/:id/active — retire a level, or bring one back. Never deleted. */
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
        setCadreLevelActive({ id: input.id, active: input.active, actorId: session.userId }),
    },
    params,
  );
}
