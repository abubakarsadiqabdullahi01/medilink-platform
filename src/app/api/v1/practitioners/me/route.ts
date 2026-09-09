import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  createProfileSchema,
  getProfileSchema,
  updateProfileSchema,
} from '@/modules/practitioners/presentation/schemas';
import {
  createProfile,
  getOwnProfile,
  updateProfile,
} from '@/modules/practitioners/application/profile';

/**
 * /api/v1/practitioners/me — the caller's own practitioner profile.
 *
 * Every action is scoped strictly to the caller's own SELF id: there is no
 * route here for reading or writing another practitioner's profile. See
 * docs/stage-5-1-practitioner-profiles.md for why that is out of scope for
 * now rather than merely unbuilt.
 */
const selfScope = (_input: unknown, session: { userId: string }) => ({
  type: 'SELF' as const,
  id: session.userId,
});

/** GET — 404 (profile_not_found) if the caller has not created one yet. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: getProfileSchema,
    permission: 'practitioner.profile.read',
    scope: selfScope,
    action: async ({ session }) => getOwnProfile(session.userId),
  });
}

/** POST — first-time creation only; a second POST is 409, not an upsert. */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: createProfileSchema,
    permission: 'practitioner.profile.write',
    scope: selfScope,
    action: async ({ input, session }) => createProfile({ ...input, userId: session.userId }),
    successStatus: 201,
  });
}

/** PATCH — partial update; 404 if no profile exists yet (never upserts). */
export async function PATCH(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: updateProfileSchema,
    permission: 'practitioner.profile.write',
    scope: selfScope,
    action: async ({ input, session }) => updateProfile({ ...input, userId: session.userId }),
  });
}
