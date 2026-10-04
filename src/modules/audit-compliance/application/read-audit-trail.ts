import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUDIT_AREAS } from '../domain/audit-areas';
import type { AuditQuery } from '../presentation/schemas';

/**
 * Reads the audit trail within one scope (Section 17).
 *
 * The scope filter is applied here as well as in the authorisation check, and
 * both are derived from the same field on the request. Authorising a scope and
 * then querying a wider one is the failure mode this shape rules out.
 */

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  /** The actor's name, or null when the row carries no actor or none is left. */
  actorName: string | null;
  actorType: string;
  scopeType: string | null;
  scopeId: string | null;
  reason: string | null;
  correlationId: string | null;
  createdAt: Date;
}

export interface AuditTrailPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}

export async function readAuditTrail(query: AuditQuery): Promise<AuditTrailPage> {
  const where: Prisma.AuditLogWhereInput = {};

  // PLATFORM is the only scope that sees rows belonging to another scope, and
  // the only one that sees rows carrying no scope at all. Anyone narrower is
  // confined to rows explicitly tagged with their own scope, so an untagged
  // row is invisible rather than accidentally shared.
  if (query.scopeType !== 'PLATFORM') {
    where.scopeType = query.scopeType;
    where.scopeId = query.scopeId;
  }

  if (query.entityType) where.entityType = query.entityType;
  if (query.entityId) where.entityId = query.entityId;
  if (query.actorId) where.actorId = query.actorId;
  if (query.action) where.action = query.action;

  // An area is a set of action subjects, matched on the prefix. `action`
  // above stays an exact match, so a caller asking for one action and a
  // console browsing a whole area do not fight over the same field.
  if (query.area) {
    where.OR = AUDIT_AREAS[query.area].map((subject) => ({
      action: { startsWith: `${subject}.` },
    }));
  }

  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }

  // One more than asked for, so the caller learns whether a next page exists
  // without a second count query over an append-only table that only grows.
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      actorId: true,
      actorType: true,
      scopeType: true,
      scopeId: true,
      reason: true,
      correlationId: true,
      createdAt: true,
    },
  });

  const page = rows.slice(0, query.limit);
  const hasMore = rows.length > query.limit;

  const entries = await withActorNames(page);

  // `before` and `after` are deliberately not returned. They hold the changed
  // values, redacted at write time but still the most sensitive column in the
  // table, and a list view has no use for them. Retrieving one record's
  // detail is a separate permission to grant when something needs it.
  return {
    entries,
    nextCursor: hasMore ? (entries[entries.length - 1]?.id ?? null) : null,
  };
}

/**
 * Puts a name against each row, in one further query rather than a join.
 *
 * There is no relation from an audit row to the user who wrote it, and there
 * should not be: the row outlives the account, and a foreign key would have
 * made the trail deletable by deleting somebody. So the ids on the page are
 * resolved separately, and a row whose actor no longer exists keeps its uuid
 * instead of losing the answer to who did it.
 *
 * This names an actor; it does not let anybody list one. The trail has no
 * filter by person, and that omission is the design.
 */
async function withActorNames<T extends { actorId: string | null }>(
  rows: T[],
): Promise<(T & { actorName: string | null })[]> {
  const ids = [...new Set(rows.map((row) => row.actorId).filter((id): id is string => Boolean(id)))];

  const actors = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
    : [];
  const names = new Map(actors.map((actor) => [actor.id, actor.fullName]));

  return rows.map((row) => ({
    ...row,
    actorName: row.actorId ? (names.get(row.actorId) ?? null) : null,
  }));
}

/**
 * Reading the audit trail is itself worth recording: it is how an
 * investigation is conducted, and who conducted one is a question that gets
 * asked afterwards. It is not a state change, so it belongs in
 * audit.security_events rather than in the audit trail it would otherwise
 * pollute.
 */
export async function recordAuditTrailAccess(input: {
  userId: string;
  query: AuditQuery;
  returned: number;
  correlationId: string;
}): Promise<void> {
  await prisma.securityEvent.create({
    data: {
      userId: input.userId,
      kind: 'audit.trail_read',
      severity: 'info',
      detail: {
        scopeType: input.query.scopeType,
        scopeId: input.query.scopeId ?? null,
        entityType: input.query.entityType ?? null,
        entityId: input.query.entityId ?? null,
        area: input.query.area ?? null,
        actorId: input.query.actorId ?? null,
        returned: input.returned,
        correlationId: input.correlationId,
      },
    },
  });
}
