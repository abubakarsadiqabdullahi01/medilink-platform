import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { emptySelfSchema } from '@/modules/audit-compliance/presentation/consent-schemas';
import { exportSubjectData } from '@/modules/audit-compliance/application/data-subject';

/**
 * GET /api/v1/me/export — everything held about the caller.
 *
 * This is the access and portability right in one endpoint, answerable by the
 * subject themselves without anybody assembling a spreadsheet — the version
 * assembled by hand is the one that quietly omits a table.
 *
 * SELF only, and deliberately so: an officer who could call this for anybody
 * would have a one-request dossier on every practitioner on the platform.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: emptySelfSchema,
    permission: 'practitioner.profile.read',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ session }) => exportSubjectData(session.userId),
  });
}
