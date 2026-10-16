import { createHash } from 'node:crypto';

/**
 * The arithmetic of the audit trail's nightly digest (AUD-06, the second half). Pure, no database.
 *
 * The database refuses to change or delete an audit row (migration 20261016130000), which stops
 * the careless. It cannot stop somebody who owns the table, who can switch the trigger off, edit
 * a row and switch it back on, and then nothing shows it. The digest is how that would show: each
 * day that is over is sealed once, as the number of rows it held and a hash of every one of them,
 * chained to the day before. A later night recomputes the days already sealed and says which was
 * the first to differ. A row edited, removed or added to a sealed day changes its figures.
 *
 * What it does not do, and the docs say so: somebody who owns the table can also rewrite the
 * digests, or delete the latest ones so they are sealed again from the changed rows. The check
 * that survives that is a copy kept where the database's owner cannot reach, which is why each
 * sealing is also logged as a line a log service can hold (`audit_digest_sealed`).
 */

/** Sealed this long after the day is over, so a transaction that began on it and committed late is in. */
export const SEAL_DELAY_HOURS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The figure for a day with no rows in it: the hash of nothing. */
export const EMPTY_DAY_HASH = createHash('sha256').update('').digest('hex');

/**
 * Every column of `audit.audit_log`, all of which the digest covers.
 *
 * Named rather than read from the table, so adding a column does not quietly change what every
 * sealed day says; an integration test fails when the table and this list differ, and adding a
 * column to one means a decision about the other.
 */
export const DIGESTED_COLUMNS = [
  'id',
  'actor_id',
  'actor_type',
  'action',
  'entity_type',
  'entity_id',
  'scope_type',
  'scope_id',
  'reason',
  'before',
  'after',
  'correlation_id',
  'request_id',
  'ip_address',
  'created_at',
] as const;

/** A sealed day, as stored. */
export interface StoredDigest {
  day: string;
  rowCount: number;
  dayHash: string;
  digest: string;
}

/** The calendar day, in UTC, as `YYYY-MM-DD`. A row's day is its `created_at` in UTC. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  return dayKey(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
}

/** The latest day that is over, and has been for `SEAL_DELAY_HOURS`. */
export function latestSealableDay(now: Date): string {
  return dayKey(new Date(now.getTime() - DAY_MS - SEAL_DELAY_HOURS * HOUR_MS));
}

/**
 * The days to seal now, in order: from the day after the last one sealed (or the day of the
 * first row, when none is) up to the latest that is old enough. A day with no rows is included:
 * sealed empty, nothing can be written into it later without that showing.
 */
export function sealableDays(input: {
  now: Date;
  lastSealed: string | null;
  firstRowDay: string | null;
}): string[] {
  const start = input.lastSealed ? addDays(input.lastSealed, 1) : input.firstRowDay;
  if (!start) return [];

  const end = latestSealableDay(input.now);
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

/**
 * One day's digest: its figures and the digest of the day before, hashed together. As a JSON array
 * so no character can be moved from one field into the next and still agree.
 */
export function chainDigest(previous: string, day: string, rowCount: number, dayHash: string): string {
  return createHash('sha256').update(JSON.stringify([previous, day, rowCount, dayHash])).digest('hex');
}

export interface DigestBreak {
  /** The first sealed day that no longer agrees. */
  day: string;
  /** `changed`: its rows or its stored digest differ. `missing_day`: the run of sealed days has a hole. */
  cause: 'changed' | 'missing_day';
  /** This day and every sealed day after it, which chain from it and so cannot be vouched for either. */
  daysInDoubt: number;
}

/**
 * Compares the sealed days, in order, with the figures for the same days worked out now.
 *
 * `recomputed` has an entry for each day that has rows; a sealed day without one is read as empty.
 * Null when every sealed day still comes to what it did.
 */
export function firstBreak(
  stored: StoredDigest[],
  recomputed: Map<string, { rowCount: number; dayHash: string }>,
): DigestBreak | null {
  let previous = '';
  for (let index = 0; index < stored.length; index += 1) {
    const row = stored[index]!;
    const inDoubt = stored.length - index;

    if (index > 0 && row.day !== addDays(stored[index - 1]!.day, 1)) {
      return { day: row.day, cause: 'missing_day', daysInDoubt: inDoubt };
    }

    const figures = recomputed.get(row.day) ?? { rowCount: 0, dayHash: EMPTY_DAY_HASH };
    const expected = chainDigest(previous, row.day, figures.rowCount, figures.dayHash);
    if (
      expected !== row.digest ||
      figures.rowCount !== row.rowCount ||
      figures.dayHash !== row.dayHash
    ) {
      return { day: row.day, cause: 'changed', daysInDoubt: inDoubt };
    }
    previous = expected;
  }
  return null;
}
