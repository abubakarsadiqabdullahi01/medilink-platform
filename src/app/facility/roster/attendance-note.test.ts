import { describe, expect, it } from 'vitest';
import { attendanceNote, LATE_AFTER_MINUTES } from './attendance-note';

// 08:00–20:00 WAT on 18 Oct 2026.
const startsAt = '2026-10-18T07:00:00.000Z';
const endsAt = '2026-10-18T19:00:00.000Z';
const at = (iso: string) => new Date(iso);
const base = { startsAt, endsAt, checkedInAt: null };

describe('attendanceNote', () => {
  it('says "not due yet" before the shift starts', () => {
    expect(
      attendanceNote({ ...base, status: 'NOT_STARTED' }, at('2026-10-18T05:00:00.000Z')),
    ).toMatchObject({
      kind: 'not-due',
      tone: 'neutral',
    });
  });

  it('is not yet late inside the grace period', () => {
    const justUnder = new Date(Date.parse(startsAt) + (LATE_AFTER_MINUTES - 1) * 60_000);
    expect(attendanceNote({ ...base, status: 'NOT_STARTED' }, justUnder)?.kind).toBe('due-now');
  });

  it('says how late once the grace period has passed, in words and a warning tone', () => {
    const note = attendanceNote(
      { ...base, status: 'CHECK_IN_PENDING' },
      at('2026-10-18T07:25:00.000Z'),
    );
    expect(note).toEqual({
      kind: 'late',
      tone: 'warning',
      text: 'Not checked in — 25 minutes after the start',
    });
  });

  it('says so when the shift is over and nobody ever checked in', () => {
    expect(
      attendanceNote({ ...base, status: 'NOT_STARTED' }, at('2026-10-18T19:30:00.000Z')),
    ).toMatchObject({
      kind: 'missed',
      tone: 'warning',
    });
  });

  it('says who is on site, and since when, in Lagos time', () => {
    const note = attendanceNote(
      { ...base, status: 'CHECKED_IN', checkedInAt: '2026-10-18T07:02:00.000Z' },
      at('2026-10-18T10:00:00.000Z'),
    );
    expect(note).toEqual({ kind: 'on-site', tone: 'info', text: 'On site since 08:02' });
  });

  it('warns about a check-out that is overdue', () => {
    const note = attendanceNote(
      { ...base, status: 'CHECKED_IN', checkedInAt: '2026-10-18T07:02:00.000Z' },
      at('2026-10-18T19:20:00.000Z'),
    );
    expect(note).toMatchObject({ kind: 'overdue-checkout', tone: 'warning' });
    expect(note?.text).toContain('20:00');
  });

  it('has nothing to add once somebody has checked out or the record has moved on', () => {
    for (const status of [
      'CHECKED_OUT',
      'SUBMITTED',
      'APPROVED',
      'MANUALLY_CORRECTED',
      'DISPUTED',
    ]) {
      expect(attendanceNote({ ...base, status }, at('2026-10-18T12:00:00.000Z'))).toBeNull();
    }
  });
});
