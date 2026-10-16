import { describe, expect, it } from 'vitest';
import {
  DIGESTED_COLUMNS,
  EMPTY_DAY_HASH,
  SEAL_DELAY_HOURS,
  chainDigest,
  dayKey,
  firstBreak,
  latestSealableDay,
  sealableDays,
  type StoredDigest,
} from './audit-digest';

/**
 * AUD-06, the second half. The trigger stops a careless change; the digest is how a careful one,
 * made by somebody who owns the table, would be noticed. These hold the arithmetic of it: which
 * days are old enough to seal, how a day's figures chain to the days before it, and which day is
 * the first one that no longer agrees with what was sealed.
 */

const at = (iso: string) => new Date(iso);

describe('which days can be sealed', () => {
  it('waits for a day to be over and for the slowest transaction on it to have ended', () => {
    // A row's `created_at` is when its transaction began, so a long one can commit after midnight
    // still dated the day before. The delay is for that; sealing at once would call it tampering.
    expect(SEAL_DELAY_HOURS).toBeGreaterThanOrEqual(1);
    expect(latestSealableDay(at('2026-10-16T01:59:59Z'))).toBe('2026-10-14');
    expect(latestSealableDay(at('2026-10-16T02:00:00Z'))).toBe('2026-10-15');
    expect(latestSealableDay(at('2026-10-16T23:59:59Z'))).toBe('2026-10-15');
  });

  it('crosses a month, a year and a leap day without losing or repeating one', () => {
    expect(latestSealableDay(at('2026-11-01T03:00:00Z'))).toBe('2026-10-31');
    expect(latestSealableDay(at('2027-01-01T03:00:00Z'))).toBe('2026-12-31');
    expect(latestSealableDay(at('2028-03-01T03:00:00Z'))).toBe('2028-02-29');
    expect(dayKey(at('2026-10-16T23:59:59.999Z'))).toBe('2026-10-16');
    expect(dayKey(at('2026-10-17T00:00:00.000Z'))).toBe('2026-10-17');
  });

  it('is every day from the first row, or from the day after the last one sealed, to the latest', () => {
    const now = at('2026-10-16T03:00:00Z');
    expect(sealableDays({ now, lastSealed: null, firstRowDay: '2026-10-12' })).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
    ]);
    expect(sealableDays({ now, lastSealed: '2026-10-13', firstRowDay: '2026-10-12' })).toEqual([
      '2026-10-14',
      '2026-10-15',
    ]);
  });

  it('includes a day with no rows, so nothing can be written into it afterwards unnoticed', () => {
    const days = sealableDays({ now: at('2026-10-16T03:00:00Z'), lastSealed: null, firstRowDay: '2026-10-10' });
    expect(days).toHaveLength(6);
  });

  it('is nothing when there is nothing to seal: no rows yet, or already sealed to the latest day', () => {
    const now = at('2026-10-16T03:00:00Z');
    expect(sealableDays({ now, lastSealed: null, firstRowDay: null })).toEqual([]);
    expect(sealableDays({ now, lastSealed: '2026-10-15', firstRowDay: '2026-10-01' })).toEqual([]);
    expect(sealableDays({ now, lastSealed: '2026-10-20', firstRowDay: '2026-10-01' })).toEqual([]);
    // The first row is today: nothing is old enough yet.
    expect(sealableDays({ now, lastSealed: null, firstRowDay: '2026-10-16' })).toEqual([]);
  });
});

describe('how a day chains to the days before it', () => {
  const base = { previous: 'abc', day: '2026-10-15', rowCount: 3, dayHash: 'def' };
  const digest = (over: Partial<typeof base> = {}) => {
    const input = { ...base, ...over };
    return chainDigest(input.previous, input.day, input.rowCount, input.dayHash);
  };

  it('is the same for the same inputs and different when any one differs', () => {
    expect(digest()).toBe(digest());
    expect(digest()).toMatch(/^[0-9a-f]{64}$/);
    for (const over of [{ previous: 'abd' }, { day: '2026-10-16' }, { rowCount: 4 }, { dayHash: 'deg' }]) {
      expect(digest(over), JSON.stringify(over)).not.toBe(digest());
    }
  });

  it('cannot be made to agree by moving a character from one field to the next', () => {
    expect(chainDigest('a', 'bc', 1, 'x')).not.toBe(chainDigest('ab', 'c', 1, 'x'));
    expect(chainDigest('a', '1', 23, 'x')).not.toBe(chainDigest('a', '12', 3, 'x'));
  });

  it('has a fixed figure for a day with nothing in it', () => {
    expect(EMPTY_DAY_HASH).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('the first day that no longer agrees', () => {
  const days = ['2026-10-13', '2026-10-14', '2026-10-15'];
  const figures = (map: Record<string, { rowCount: number; dayHash: string }>) =>
    new Map(Object.entries(map));

  /** What sealing would have stored for these figures. */
  function sealed(map: Record<string, { rowCount: number; dayHash: string }>): StoredDigest[] {
    let previous = '';
    return days.map((day) => {
      const { rowCount, dayHash } = map[day] ?? { rowCount: 0, dayHash: EMPTY_DAY_HASH };
      const digest = chainDigest(previous, day, rowCount, dayHash);
      previous = digest;
      return { day, rowCount, dayHash, digest };
    });
  }

  const original = {
    '2026-10-13': { rowCount: 2, dayHash: 'h13' },
    '2026-10-14': { rowCount: 5, dayHash: 'h14' },
    '2026-10-15': { rowCount: 1, dayHash: 'h15' },
  };

  it('is nothing when every sealed day still comes to what it did', () => {
    expect(firstBreak(sealed(original), figures(original))).toBeNull();
  });

  it('names the day whose rows changed, and says how many days that leaves in doubt', () => {
    const tampered = { ...original, '2026-10-14': { rowCount: 5, dayHash: 'h14-edited' } };

    const found = firstBreak(sealed(original), figures(tampered));

    expect(found).toMatchObject({ day: '2026-10-14', cause: 'changed' });
    // The days after it chain from it, so they cannot be vouched for either.
    expect(found!.daysInDoubt).toBe(2);
  });

  it('names the day when a row was removed or added, which changes the count as well as the hash', () => {
    expect(
      firstBreak(sealed(original), figures({ ...original, '2026-10-13': { rowCount: 1, dayHash: 'h13x' } })),
    ).toMatchObject({ day: '2026-10-13' });
    expect(
      firstBreak(sealed(original), figures({ ...original, '2026-10-15': { rowCount: 2, dayHash: 'h15x' } })),
    ).toMatchObject({ day: '2026-10-15', daysInDoubt: 1 });
  });

  it('notices a day emptied altogether, and a row written into a day that was sealed empty', () => {
    const without = { '2026-10-13': original['2026-10-13'], '2026-10-15': original['2026-10-15'] };
    expect(firstBreak(sealed(original), figures(without))).toMatchObject({ day: '2026-10-14' });

    const quiet = { ...original, '2026-10-14': { rowCount: 0, dayHash: EMPTY_DAY_HASH } };
    expect(firstBreak(sealed(quiet), figures(quiet))).toBeNull();
    expect(firstBreak(sealed(quiet), figures(original))).toMatchObject({ day: '2026-10-14' });
  });

  it('notices a digest row that was edited to say something else', () => {
    const stored = sealed(original);
    stored[1] = { ...stored[1]!, digest: 'f'.repeat(64) };

    expect(firstBreak(stored, figures(original))).toMatchObject({ day: '2026-10-14', cause: 'changed' });
  });

  it('notices a stored figure edited on its own, with the digest beside it left as it was', () => {
    // The digest would still come out right from the rows, so only comparing the figures catches it.
    const edited = sealed(original);
    edited[1] = { ...edited[1]!, dayHash: 'something else' };
    expect(firstBreak(edited, figures(original))).toMatchObject({ day: '2026-10-14', cause: 'changed' });

    const counted = sealed(original);
    counted[2] = { ...counted[2]!, rowCount: 99 };
    expect(firstBreak(counted, figures(original))).toMatchObject({ day: '2026-10-15', cause: 'changed' });
  });

  it('notices a sealed day that is missing from the middle of the run', () => {
    const stored = sealed(original).filter((row) => row.day !== '2026-10-14');

    expect(firstBreak(stored, figures(original))).toMatchObject({ day: '2026-10-15', cause: 'missing_day' });
  });
});

describe('what the digest covers', () => {
  it('names every column of an audit row, so a column cannot be left out of what is vouched for', () => {
    expect(DIGESTED_COLUMNS).toEqual(
      expect.arrayContaining(['id', 'action', 'entity_type', 'before', 'after', 'correlation_id', 'created_at']),
    );
    expect(new Set(DIGESTED_COLUMNS).size).toBe(DIGESTED_COLUMNS.length);
  });
});
