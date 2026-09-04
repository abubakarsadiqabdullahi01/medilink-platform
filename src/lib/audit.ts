import type { Tx } from './db';

/**
 * Every state change writes one audit row, in the same transaction as the
 * change itself. This is not a logging convenience: an audit trail started
 * later begins later, and the earlier records are simply gone.
 *
 * Usage:
 *   await prisma.$transaction(async (tx) => {
 *     const user = await tx.user.update({ ... });
 *     await recordAudit(tx, { action: 'user.suspended', entityType: 'identity.users',
 *       entityId: user.id, actorId, before, after, reason });
 *   });
 */
export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string;
  actorId?: string;
  actorType?: 'user' | 'system' | 'worker';
  scopeType?: string;
  scopeId?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  correlationId?: string;
  requestId?: string;
  ipAddress?: string;
}

const REDACTED_KEYS = new Set([
  'passwordHash', 'password', 'codeHash', 'tokenHash', 'accountNumber',
  'bvn', 'nin', 'secret', 'apiKey',
]);

/** Values that must never reach the audit table in clear text. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
        key,
        REDACTED_KEYS.has(key) ? '[redacted]' : redact(inner),
      ]),
    );
  }
  return value;
}

export async function recordAudit(tx: Tx, input: AuditInput) {
  return tx.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId,
      actorType: input.actorType ?? 'user',
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      reason: input.reason,
      before: input.before === undefined ? undefined : (redact(input.before) as object),
      after: input.after === undefined ? undefined : (redact(input.after) as object),
      correlationId: input.correlationId,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
    },
  });
}
