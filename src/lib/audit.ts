import type { Tx } from './db';
import { logger } from './logger';
import { currentTrace } from './trace';

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

/**
 * Fields that must never reach the audit table in clear text.
 *
 * The first group is secrets. The second is what identifies a person: an audit
 * row is kept for good, so anything identifying in one is a record that a
 * person's right to erasure cannot reach (AUD-02). The row still says that the
 * field existed or changed; it does not say what it held.
 */
const REDACTED_KEYS = new Set([
  'passwordHash', 'password', 'codeHash', 'tokenHash', 'accountNumber',
  'bvn', 'nin', 'secret', 'apiKey',
  'fullName', 'email', 'contactEmail', 'contactPhone', 'dateOfBirth', 'addressLine',
  // A payment's payer, and the bank reference that so often carries their name.
  'payerName', 'paymentReference',
]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/**
 * A Nigerian mobile number written the ways people write one: +234 or 0, the
 * network prefix, then seven digits, with spaces or hyphens between groups. Not
 * inside a longer run of digits, so an amount or an identifier is left alone,
 * and not a masked number, which has asterisks where the digits were.
 */
const PHONE = /(?<!\d)(?:\+?234|0)[\s-]?[789][01]\d[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g;

/**
 * Text with the email addresses and phone numbers taken out.
 *
 * Names cannot be found by their shape, so what a person was named is kept out
 * by the call sites and by the key list above. This is the net under them: a
 * number or an address typed into a free-text field, under whatever key, does
 * not reach the table either.
 */
export function scrubText(text: string): string {
  return text.replace(EMAIL, '[email]').replace(PHONE, '[phone]');
}

/** Values that must never reach the audit table in clear text. */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return scrubText(value);
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

/**
 * Writes the row, in the caller's transaction.
 *
 * A write that fails is thrown on, never swallowed: the act it belongs to fails with it, which
 * is what stops a mandatory record being lost. It is also said aloud, under a name an alert can
 * key on (M17-07), because from outside it is otherwise one more rolled-back transaction.
 *
 * What is logged is the action, the entity and the kind of error, and nothing the row held: a
 * database error can quote the values it was given, and a name or a number in a log is exactly
 * what the row's own redaction exists to keep out.
 */
export async function recordAudit(tx: Tx, input: AuditInput) {
  // Taken from the action being run unless a caller said otherwise, so one business action's rows
  // share an id without any of the hundred call sites passing it (AUD-13). The network address is
  // not taken the same way: it identifies a person, and the trail is kept for good.
  const trace = currentTrace();
  const correlationId = input.correlationId ?? trace?.correlationId;
  const requestId = input.requestId ?? trace?.requestId;
  try {
    return await tx.auditLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        actorId: input.actorId,
        actorType: input.actorType ?? 'user',
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        reason: input.reason === undefined ? undefined : scrubText(input.reason),
        before: input.before === undefined ? undefined : (redact(input.before) as object),
        after: input.after === undefined ? undefined : (redact(input.after) as object),
        correlationId,
        requestId,
        ipAddress: input.ipAddress,
      },
    });
  } catch (error) {
    logger.error('audit write failed: the act it belongs to is rolled back', {
      event: 'audit_write_failed',
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      correlationId,
      requestId,
      errorName: error instanceof Error ? error.name : typeof error,
      errorCode: (error as { code?: unknown } | null)?.code,
    });
    throw error;
  }
}
