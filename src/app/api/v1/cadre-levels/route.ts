import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { createLevelSchema, listSchema } from '@/modules/config/hierarchy-schemas';
import { createCadreLevel, hierarchyOverview } from '@/modules/config/hierarchy-config';

/**
 * The levels within each profession, and the registration categories (CFG-04).
 *
 * `config.manage` at PLATFORM for both reading and writing: they are lists compliance
 * owns. Forms that only need to offer a choice read `GET /api/v1/reference`, which
 * carries the active ones for any signed-in person.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listSchema,
    permission: 'config.manage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async () => hierarchyOverview(),
  });
}

export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: createLevelSchema,
    permission: 'config.manage',
    scope: () => ({ type: 'PLATFORM' }),
    successStatus: 201,
    action: async ({ input, session }) => createCadreLevel({ ...input, actorId: session.userId }),
  });
}
