import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  DIGESTED_COLUMNS,
  EMPTY_DAY_HASH,
  chainDigest,
  firstBreak,
  sealableDays,
  type DigestBreak,
  type StoredDigest,
} from '../domain/audit-digest';

/**
 * The audit trail's nightly digest (AUD-06, the second half): seal each finished day, and check
 * the days already sealed still come to what they did. See the domain file for what it does and
 * does not defend against.
 *
 * Done in the database. A day's figure is a hash of a hash of each row, worked out where the rows
 * are, so a trail of a hundred thousand rows a day is one query and not a hundred thousand objects
 * in a Node process. `created_at` is stored in UTC, so the day of a row is its date as it stands.
 */

/** A thrown failure names the day and how many sealed days it puts in doubt, and never a row. */
export class AuditDigestMismatch extends Error {
  constructor(readonly found: DigestBreak) {
    super(
      found.cause === 'missing_day'
        ? `The run of sealed audit days has a hole at ${found.day}; ${found.daysInDoubt} sealed day(s) from it cannot be vouched for.`
        : `The audit trail no longer matches what was sealed for ${found.day}; ${found.daysInDoubt} sealed day(s) from it cannot be vouched for.`,
    );
    this.name = 'AuditDigestMismatch';
  }
}

/** One row of the audit trail as a stable piece of text: every column, by name, times in UTC. */
const ROW_TEXT = Prisma.raw(
  `jsonb_build_object(${DIGESTED_COLUMNS.map((column) =>
    column === 'created_at'
      ? `'created_at', to_char("created_at", 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
      : `'${column}', "${column}"`,
  ).join(', ')})::text`,
);

interface DayFigures {
  rowCount: number;
  dayHash: string;
}

/** The figures for every day that has rows, between two days inclusive. */
async function figuresBetween(firstDay: string, lastDay: string): Promise<Map<string, DayFigures>> {
  const rows = await prisma.$queryRaw<{ day: string; row_count: number; day_hash: string }[]>`
    SELECT to_char("created_at"::date, 'YYYY-MM-DD') AS day,
           count(*)::int AS row_count,
           encode(
             sha256(convert_to(
               string_agg(encode(sha256(convert_to(${ROW_TEXT}, 'UTF8')), 'hex'), '' ORDER BY "created_at", "id"),
               'UTF8'
             )),
             'hex'
           ) AS day_hash
      FROM audit.audit_log
     WHERE "created_at" >= ${firstDay}::date
       AND "created_at" < (${lastDay}::date + 1)
     GROUP BY "created_at"::date
     ORDER BY 1`;

  return new Map(rows.map((row) => [row.day, { rowCount: row.row_count, dayHash: row.day_hash }]));
}

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

async function storedDigests(): Promise<StoredDigest[]> {
  const rows = await prisma.auditDigest.findMany({ orderBy: { day: 'asc' } });
  return rows.map((row) => ({
    day: dayOf(row.day),
    rowCount: row.rowCount,
    dayHash: row.dayHash,
    digest: row.digest,
  }));
}

/** Null when every sealed day still comes to what it did; otherwise the first that does not. */
export async function verifyAuditDigests(): Promise<DigestBreak | null> {
  const stored = await storedDigests();
  if (stored.length === 0) return null;

  const recomputed = await figuresBetween(stored[0]!.day, stored[stored.length - 1]!.day);
  return firstBreak(stored, recomputed);
}

/** Seals every finished day not yet sealed, in order, each chained to the day before. */
async function sealFinishedDays(now: Date, stored: StoredDigest[]): Promise<string[]> {
  const [first] = await prisma.$queryRaw<{ day: string | null }[]>`
    SELECT to_char(min("created_at")::date, 'YYYY-MM-DD') AS day FROM audit.audit_log`;

  const days = sealableDays({
    now,
    lastSealed: stored.length > 0 ? stored[stored.length - 1]!.day : null,
    firstRowDay: first?.day ?? null,
  });
  if (days.length === 0) return [];

  const figures = await figuresBetween(days[0]!, days[days.length - 1]!);
  let previous = stored.length > 0 ? stored[stored.length - 1]!.digest : '';

  const sealed = days.map((day) => {
    const { rowCount, dayHash } = figures.get(day) ?? { rowCount: 0, dayHash: EMPTY_DAY_HASH };
    previous = chainDigest(previous, day, rowCount, dayHash);
    return { day, rowCount, dayHash, digest: previous };
  });

  await prisma.auditDigest.createMany({
    data: sealed.map((row) => ({
      day: new Date(`${row.day}T00:00:00Z`),
      rowCount: row.rowCount,
      dayHash: row.dayHash,
      digest: row.digest,
    })),
  });

  // Said aloud, once a day, as a line a log service can keep. A copy held where the database's
  // owner cannot reach is the one thing that survives the owner rewriting the table and the digests.
  for (const row of sealed) {
    logger.info('audit day sealed', {
      event: 'audit_digest_sealed',
      day: row.day,
      rowCount: row.rowCount,
      digest: row.digest,
    });
  }
  return days;
}

/**
 * The nightly run: check what is sealed, seal what is new, and fail if anything sealed has changed.
 *
 * Checks first, so a change is found before anything is built on it, and seals regardless, so one
 * tampered day does not stop every later day being vouched for. It fails at the end, by name: the
 * job's last error is on the system-health screen, and the log line is one an alert can key on.
 */
export async function runAuditDigestSweep(
  now: Date = new Date(),
): Promise<{ verified: number; sealed: number }> {
  const stored = await storedDigests();
  const found = stored.length > 0 ? await verifyAuditDigests() : null;
  const sealed = await sealFinishedDays(now, stored);

  if (found) {
    logger.error('the audit trail no longer matches what was sealed', {
      event: 'audit_digest_mismatch',
      day: found.day,
      cause: found.cause,
      daysInDoubt: found.daysInDoubt,
    });
    throw new AuditDigestMismatch(found);
  }
  return { verified: stored.length, sealed: sealed.length };
}
