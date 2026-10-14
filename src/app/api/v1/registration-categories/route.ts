import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { createRegistrationCategorySchema, listSchema } from '@/modules/config/hierarchy-schemas';
import { createRegistrationCategory, hierarchyOverview } from '@/modules/config/hierarchy-config';

/** The registration categories: full, provisional, intern, and whether each needs supervision. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listSchema,
    permission: 'config.manage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async () => (await hierarchyOverview()).registrationCategories,
  });
}

export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: createRegistrationCategorySchema,
    permission: 'config.manage',
    scope: () => ({ type: 'PLATFORM' }),
    successStatus: 201,
    action: async ({ input, session }) => createRegistrationCategory({ ...input, actorId: session.userId }),
  });
}
