import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  listSubmissionsSchema,
  submitCredentialSchema,
} from '@/modules/credentials/presentation/schemas';
import { listSubmissions, submitCredential } from '@/modules/credentials/application/submission';

/**
 * /api/v1/credentials — submit a credential (POST) or list submissions
 * (GET). Listing accepts either scope the caller states: SELF for a
 * practitioner's own history, PLATFORM for a compliance officer's review
 * queue (optionally narrowed to one practitioner via scopeId).
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: submitCredentialSchema,
    permission: 'credential.submit',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ input, session }) => submitCredential({ ...input, userId: session.userId }),
    successStatus: 201,
  });
}

export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listSubmissionsSchema,
    permission: 'credential.document.read',
    scope: (input, session) => ({
      type: input.scopeType,
      id: input.scopeType === 'SELF' ? (input.scopeId ?? session.userId) : input.scopeId,
    }),
    action: async ({ input, session }) => {
      // Reached only once the guard has confirmed any SELF scopeId is the
      // caller's own, so this fills in the default rather than overriding.
      const scoped =
        input.scopeType === 'SELF' ? { ...input, scopeId: input.scopeId ?? session.userId } : input;
      return listSubmissions(scoped);
    },
  });
}
