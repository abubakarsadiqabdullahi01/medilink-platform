import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { logger } from '@/lib/logger';
import {
  findSanctionMatch,
  type ScreeningStatusValue,
  type SanctionedEntryLike,
} from '../domain/screening';
import { PractitionerErrors } from '../domain/errors';

/**
 * Step 5.6: screening every practitioner against the sanctioned and "quack"
 * lists, at registration and on a schedule.
 *
 * On a schedule as well as at registration because the list changes: someone
 * struck off in March was not on it in February, and a platform that only
 * ever checked at signup would keep matching them to shifts indefinitely.
 */

export interface ScreeningResultView {
  userId: string;
  status: ScreeningStatusValue;
  matchedEntryId: string | null;
  matchedOn: string | null;
  screenedAt: Date;
  clearedBy: string | null;
  notes: string | null;
}

interface ScreeningRow {
  userId: string;
  status: ScreeningStatusValue;
  matchedEntryId: string | null;
  matchedOn: string | null;
  screenedAt: Date;
  clearedBy: string | null;
  notes: string | null;
}

function toView(row: ScreeningRow): ScreeningResultView {
  return {
    userId: row.userId,
    status: row.status,
    matchedEntryId: row.matchedEntryId,
    matchedOn: row.matchedOn,
    screenedAt: row.screenedAt,
    clearedBy: row.clearedBy,
    notes: row.notes,
  };
}

/**
 * Loaded once per sweep rather than per practitioner. The list is small — a
 * few thousand entries at most — and the alternative is a query per person.
 */
async function loadSanctionedEntries(): Promise<SanctionedEntryLike[]> {
  return prisma.sanctionedEntry.findMany({
    select: { id: true, normalisedName: true, folioNumber: true },
  });
}

async function screenAgainst(
  userId: string,
  entries: SanctionedEntryLike[],
): Promise<ScreeningResultView | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      deletedAt: true,
      professionalRegistrations: { select: { folioNumber: true }, where: { deletedAt: null } },
    },
  });
  if (!user || user.deletedAt) return null;

  const match = findSanctionMatch(
    {
      fullName: user.fullName,
      folioNumbers: user.professionalRegistrations.map((row) => row.folioNumber),
    },
    entries,
  );

  const existing = await prisma.screeningResult.findUnique({ where: { userId } });

  // A compliance officer's clearance is not undone by the next sweep finding
  // the same near-miss again: two people sharing a name would otherwise be
  // re-flagged every night forever, and the officer's answer would mean
  // nothing. A *new* match — a different entry — is flagged regardless.
  const clearedThisMatch =
    existing?.status === 'CLEAR' &&
    existing.clearedBy !== null &&
    existing.matchedEntryId === (match?.entryId ?? null);

  const status: ScreeningStatusValue = match && !clearedThisMatch ? 'FLAGGED' : 'CLEAR';
  const now = new Date();

  const saved = await prisma.$transaction(async (tx: Tx) => {
    const data = {
      status,
      matchedEntryId: match?.entryId ?? existing?.matchedEntryId ?? null,
      matchedOn: match?.matchedOn ?? existing?.matchedOn ?? null,
      screenedAt: now,
      clearedBy: clearedThisMatch ? (existing?.clearedBy ?? null) : null,
      notes: clearedThisMatch ? (existing?.notes ?? null) : null,
    };

    const row = existing
      ? await tx.screeningResult.update({ where: { userId }, data })
      : await tx.screeningResult.create({ data: { userId, ...data } });

    // Only a change is worth a row: a nightly sweep over every practitioner
    // would otherwise write an audit entry per person per night, and the
    // trail that matters would drown in it.
    if (!existing || existing.status !== status || existing.matchedEntryId !== data.matchedEntryId) {
      await recordAudit(tx, {
        action: status === 'FLAGGED' ? 'practitioner.screening_flagged' : 'practitioner.screening_cleared',
        entityType: 'practitioners.screening_results',
        entityId: row.id,
        actorId: userId,
        actorType: 'system',
        scopeType: 'SELF',
        scopeId: userId,
        before: existing ? toView(existing) : undefined,
        after: toView(row),
      });

      if (status === 'FLAGGED') {
        await publishEvent(tx, {
          eventType: EVENTS.SanctionApplied,
          aggregateType: 'practitioners.screening_results',
          aggregateId: row.id,
          payload: { userId, matchedEntryId: data.matchedEntryId, matchedOn: data.matchedOn },
        });
      }
    }

    return row;
  });

  return toView(saved);
}

/** Screens one practitioner. Used at registration and by the officer's re-check. */
export async function screenPractitioner(userId: string): Promise<ScreeningResultView | null> {
  return screenAgainst(userId, await loadSanctionedEntries());
}

export interface SweepResult {
  screened: number;
  flagged: number;
}

/**
 * The scheduled sweep. Screens every practitioner who has a profile, against
 * the current list.
 *
 * Deliberately not batched or paginated yet: the pilot is fifty
 * practitioners, and a sweep that is simple and obviously correct is worth
 * more at this size than one that is fast. It will need paging before it is
 * thousands.
 */
export async function screenAllPractitioners(): Promise<SweepResult> {
  const entries = await loadSanctionedEntries();
  const profiles = await prisma.practitionerProfile.findMany({
    where: { deletedAt: null },
    select: { userId: true },
  });

  let flagged = 0;
  let screened = 0;

  for (const profile of profiles) {
    const result = await screenAgainst(profile.userId, entries);
    if (!result) continue;
    screened += 1;
    if (result.status === 'FLAGGED') flagged += 1;
  }

  logger.info('screening sweep complete', { screened, flagged, listSize: entries.length });
  return { screened, flagged };
}

export async function getScreeningResult(userId: string): Promise<ScreeningResultView | null> {
  const row = await prisma.screeningResult.findUnique({ where: { userId } });
  return row ? toView(row) : null;
}

export interface ClearScreeningParams {
  userId: string;
  actorId: string;
  notes: string;
}

/**
 * A compliance officer's answer to a false positive. Two people sharing a
 * name is common enough that a flag has to be answerable, or the flag becomes
 * something people learn to ignore.
 */
export async function clearScreeningFlag(
  input: ClearScreeningParams,
): Promise<ScreeningResultView> {
  const existing = await prisma.screeningResult.findUnique({ where: { userId: input.userId } });
  if (!existing) throw PractitionerErrors.screeningNotFound();
  if (existing.status !== 'FLAGGED') throw PractitionerErrors.screeningNotFlagged();

  return prisma.$transaction(async (tx: Tx) => {
    const row = await tx.screeningResult.update({
      where: { userId: input.userId },
      data: { status: 'CLEAR', clearedBy: input.actorId, notes: input.notes, screenedAt: new Date() },
    });

    await recordAudit(tx, {
      action: 'practitioner.screening_cleared',
      entityType: 'practitioners.screening_results',
      entityId: row.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: input.userId,
      reason: input.notes,
      before: toView(existing),
      after: toView(row),
    });

    return toView(row);
  });
}
