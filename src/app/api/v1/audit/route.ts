import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { auditQuerySchema } from '@/modules/audit-compliance/presentation/schemas';
import {
  readAuditTrail,
  recordAuditTrailAccess,
} from '@/modules/audit-compliance/application/read-audit-trail';

/**
 * GET /api/v1/audit — the audit trail within one scope.
 *
 * Requires audit.read *and* a grant covering the scope asked for. A
 * compliance officer holding it at PLATFORM sees everything; a facility
 * administrator holding it over their own facility sees that facility and is
 * refused any other.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: auditQuerySchema,
    permission: 'audit.read',
    scope: (query, session) => ({
      type: query.scopeType,
      // SELF defaults to the caller, but a scopeId naming someone else is
      // passed through rather than quietly replaced: the guard refuses it,
      // and a caller who asked for another practitioner's records should be
      // told no rather than handed their own and left to wonder.
      id: query.scopeType === 'SELF' ? (query.scopeId ?? session.userId) : query.scopeId,
    }),
    action: async ({ input, session, context }) => {
      // Reached only once the guard has confirmed any SELF scopeId is the
      // caller's own, so this fills in the default rather than overriding.
      const scoped =
        input.scopeType === 'SELF' ? { ...input, scopeId: input.scopeId ?? session.userId } : input;
      const page = await readAuditTrail(scoped);

      await recordAuditTrailAccess({
        userId: session.userId,
        query: scoped,
        returned: page.entries.length,
        correlationId: context.correlationId,
      });

      return page;
    },
  });
}
