import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  addSanctionedEntriesSchema,
  listSanctionedEntriesSchema,
} from '@/modules/practitioners/presentation/sanction-schemas';
import {
  addSanctionedEntries,
  listSanctionedEntries,
} from '@/modules/practitioners/application/sanctions';

/**
 * The sanctioned and "quack" lists practitioners are screened against.
 *
 * `credential.review` at PLATFORM, beside identity, registration and answering a
 * flag: keeping the list is the same job as checking a licence. What goes in is
 * compliance's to supply from the regulator's notices.
 */

/** GET — the entries, newest first; `search` finds a name however it is written, or a folio number. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listSanctionedEntriesSchema,
    permission: 'credential.review',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input }) => ({ entries: await listSanctionedEntries(input) }),
  });
}

/** POST — add entries, all or none, then screen everybody against the new list. */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: addSanctionedEntriesSchema,
    permission: 'credential.review',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input, session }) =>
      addSanctionedEntries({ entries: input.entries, actorId: session.userId }),
  });
}
