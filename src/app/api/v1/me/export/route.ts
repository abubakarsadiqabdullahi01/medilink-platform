import { handleSessionRequest, requireFreshStepUp } from '@/lib/http/session-handler';
import {
  exportSubjectData,
  recordExportMade,
} from '@/modules/audit-compliance/application/data-export';

/**
 * GET /api/v1/me/export — everything held about the caller.
 *
 * The access and portability right in one endpoint, for anybody who can sign in: a
 * practitioner, a hospital's scheduler, an officer. It used to need
 * `practitioner.profile.read`, which no hospital role holds, so a member of hospital
 * staff had no way to ask what the platform kept about them (AUD-08).
 *
 * The caller's own, and only that, by construction rather than by a scope check: it
 * reads no input, so nothing in the request can name whose data it is. An officer
 * who could call this for anybody would have a one-request dossier on every
 * practitioner on the platform.
 *
 * Because it releases everything at once it asks for the password again, as moving
 * money does, rather than answering to a session cookie alone. It is delivered in
 * this response and nowhere else: nothing is written to storage and no link is
 * made, so there is no file to leave lying about and no URL to expire, forward or
 * guess. The record that it was made is written before the data leaves, and the
 * response is marked so that no browser or proxy keeps a copy either.
 */
export async function GET(request: Request) {
  const response = await handleSessionRequest(request, async (session, context) => {
    requireFreshStepUp(session);
    const data = await exportSubjectData(session.userId);
    await recordExportMade({ userId: session.userId, correlationId: context.correlationId });
    return data;
  });
  response.headers.set('cache-control', 'no-store');
  return response;
}
