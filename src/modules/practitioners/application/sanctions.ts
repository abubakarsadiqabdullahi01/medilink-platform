import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import { logger } from '@/lib/logger';
import { normaliseFolio, normaliseName } from '../domain/screening';
import { screenAllPractitioners } from './screening';

/**
 * Keeping the sanctioned and "quack" lists (PRA-14).
 *
 * The lists shipped empty and nothing could write to them, so screening
 * reported "clear" for everybody until somebody wrote SQL. **What goes in them
 * is compliance's to supply** from the regulator's published notices; an invented
 * list would be worse than none. This is how it gets in, and what happens when
 * it does.
 *
 * A change takes effect at once: everybody is screened again straight after,
 * rather than at the next daily sweep, because a name added today and not acted
 * on until tomorrow is a day a struck-off practitioner can be matched to a shift.
 */

const OWNER = 'compliance-officer';

export const SanctionErrors = {
  notFound: () => new HttpError('sanction_entry_not_found', 'That entry is not on the list.', 404),
  reasonRequired: () =>
    new HttpError('reason_required', 'Say why the entry is being removed.', 422),
};

export type SourceList = 'MDCN_QUACK_LIST' | 'MDCN_SANCTIONS' | 'INTERNAL';

export interface SanctionedEntryView {
  id: string;
  sourceList: SourceList;
  fullName: string;
  folioNumber: string | null;
  reason: string | null;
  /** The date the regulator listed them, YYYY-MM-DD. */
  listedAt: string;
  createdAt: Date;
}

function toView(row: {
  id: string;
  sourceList: SourceList;
  fullName: string;
  folioNumber: string | null;
  reason: string | null;
  listedAt: Date;
  createdAt: Date;
}): SanctionedEntryView {
  return {
    id: row.id,
    sourceList: row.sourceList,
    fullName: row.fullName,
    folioNumber: row.folioNumber,
    reason: row.reason,
    listedAt: row.listedAt.toISOString().slice(0, 10),
    createdAt: row.createdAt,
  };
}

/** Newest first, and findable by name however it is written, or by folio number. */
export async function listSanctionedEntries(input: {
  search?: string;
  sourceList?: SourceList;
  limit?: number;
}): Promise<SanctionedEntryView[]> {
  const search = input.search?.trim();
  const rows = await prisma.sanctionedEntry.findMany({
    where: {
      ...(input.sourceList ? { sourceList: input.sourceList } : {}),
      ...(search
        ? {
            OR: [
              { normalisedName: { contains: normaliseName(search) } },
              ...(normaliseFolio(search)
                ? [{ folioNumber: { contains: normaliseFolio(search)! } }]
                : []),
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit ?? 200,
  });
  return rows.map(toView);
}

export interface NewEntry {
  fullName: string;
  sourceList: SourceList;
  folioNumber?: string;
  reason: string;
  /** YYYY-MM-DD. */
  listedAt: string;
}

export interface AddOutcome {
  added: number;
  /** Already on the list, under the same list and folio, however the name was written. */
  skipped: number;
  /** Everybody screened again afterwards, and how many are flagged. */
  screened: number;
  flagged: number;
}

/**
 * Adds a batch of entries, all or none, then screens everybody against the new list.
 */
export async function addSanctionedEntries(input: {
  entries: NewEntry[];
  actorId: string;
}): Promise<AddOutcome> {
  const keyOf = (entry: { sourceList: string; normalisedName: string; folioNumber: string | null }) =>
    `${entry.sourceList}|${entry.normalisedName}|${entry.folioNumber ?? ''}`;

  const prepared = input.entries.map((entry) => ({
    sourceList: entry.sourceList,
    fullName: entry.fullName.trim(),
    normalisedName: normaliseName(entry.fullName),
    folioNumber: normaliseFolio(entry.folioNumber),
    reason: entry.reason.trim(),
    listedAt: new Date(`${entry.listedAt}T00:00:00.000Z`),
    owner: OWNER,
  }));

  const added = await prisma.$transaction(async (tx: Tx) => {
    const existing = await tx.sanctionedEntry.findMany({
      where: { normalisedName: { in: prepared.map((entry) => entry.normalisedName) } },
      select: { sourceList: true, normalisedName: true, folioNumber: true },
    });
    const seen = new Set(existing.map(keyOf));

    // Dropped when it is already there, or earlier in this same batch.
    const fresh = prepared.filter((entry) => {
      const key = keyOf(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (fresh.length > 0) {
      await tx.sanctionedEntry.createMany({ data: fresh });
      await recordAudit(tx, {
        action: 'sanction_list.entries_added',
        entityType: 'config.sanctioned_entries',
        actorId: input.actorId,
        scopeType: 'PLATFORM',
        // How many, and from which list. Not who: a name on a sanctions list is
        // not something to copy into a record that is kept for good.
        after: { count: fresh.length, sourceLists: [...new Set(fresh.map((entry) => entry.sourceList))] },
      });
    }
    return fresh.length;
  });

  return { added, skipped: prepared.length - added, ...(await screenAfterChange()) };
}

/** Takes one entry off. Whoever it flagged is clear again, unless another entry still matches. */
export async function removeSanctionedEntry(input: {
  entryId: string;
  actorId: string;
  reason: string;
}): Promise<{ screened: number; flagged: number }> {
  const reason = input.reason.trim();
  if (!reason) throw SanctionErrors.reasonRequired();

  await prisma.$transaction(async (tx: Tx) => {
    const existing = await tx.sanctionedEntry.findUnique({ where: { id: input.entryId } });
    if (!existing) throw SanctionErrors.notFound();

    // Conditional on it still being there, so two people removing the same entry
    // leave one audit row.
    const removed = await tx.sanctionedEntry.deleteMany({ where: { id: existing.id } });
    if (removed.count === 0) throw SanctionErrors.notFound();

    await recordAudit(tx, {
      action: 'sanction_list.entry_removed',
      entityType: 'config.sanctioned_entries',
      entityId: existing.id,
      actorId: input.actorId,
      scopeType: 'PLATFORM',
      reason,
      before: { sourceList: existing.sourceList, hasFolio: existing.folioNumber !== null },
    });
  });

  return screenAfterChange();
}

/**
 * Screens everybody against the list as it now stands. A failure here does not
 * undo the change: the list is right, and the daily sweep applies it.
 */
async function screenAfterChange(): Promise<{ screened: number; flagged: number }> {
  try {
    return await screenAllPractitioners();
  } catch (error) {
    logger.error('screening after a list change failed; the daily sweep will apply it', {
      error: String(error),
    });
    return { screened: 0, flagged: 0 };
  }
}
