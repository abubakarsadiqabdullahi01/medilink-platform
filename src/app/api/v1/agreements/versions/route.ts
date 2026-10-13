import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { listVersionsSchema } from '@/modules/audit-compliance/presentation/consent-schemas';
import { listAgreementVersions } from '@/modules/audit-compliance/application/consent';

/**
 * GET /api/v1/agreements/versions — every version of every agreement, for the
 * operator who publishes them. On `config.manage`, the permission that
 * publishes: anybody who may replace the text may see what they are replacing.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listVersionsSchema,
    permission: 'config.manage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async () => ({ versions: await listAgreementVersions() }),
  });
}
