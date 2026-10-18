import { describe, expect, it } from 'vitest';
import {
  daysPhrase,
  deriveShifts,
  expiringCredentials,
  openOffers,
  type TodayAssignment,
  type TodayInvitation,
} from './practitioner-today';

const now = new Date('2026-10-18T12:00:00Z');
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();

const shift = (
  id: string,
  startH: number,
  endH: number,
  attendance?: string | null,
): TodayAssignment => ({
  id,
  status: 'CONFIRMED',
  startsAt: hours(startH),
  endsAt: hours(endH),
  facilityName: 'Aso Garden Specialist Hospital',
  shiftType: 'DAY',
  hourlyRateKobo: 500_000,
  attendance: attendance === undefined ? null : attendance === null ? null : { status: attendance },
});

describe('what to do about a shift', () => {
  it('asks for a check-in from three hours before the start, and not before', () => {
    const early = deriveShifts([shift('a', 5, 13)], now);
    expect(early.checkInDue).toHaveLength(0);

    const soon = deriveShifts([shift('a', 2.5, 10)], now);
    expect(soon.checkInDue.map((row) => row.id)).toEqual(['a']);
    expect(soon.next?.id).toBe('a');
  });

  it('treats a code that has been issued but not presented like one that has not', () => {
    const result = deriveShifts([shift('a', 1, 9, 'CHECK_IN_PENDING')], now);
    expect(result.checkInDue).toHaveLength(1);
  });

  it('puts a shift that is on now, and checked in, in progress and not due', () => {
    const result = deriveShifts([shift('a', -2, 6, 'CHECKED_IN')], now);
    expect(result.inProgress.map((row) => row.id)).toEqual(['a']);
    expect(result.checkInDue).toHaveLength(0);
    expect(result.next?.id).toBe('a');
  });

  it('says a shift that has started and has nobody checked in is both on and due', () => {
    const result = deriveShifts([shift('a', -1, 7)], now);
    expect(result.inProgress).toHaveLength(1);
    expect(result.checkInDue).toHaveLength(1);
  });

  it('collects worked shifts to send, corrections asked for, and ones with the facility', () => {
    const result = deriveShifts(
      [
        shift('worked', -20, -12, 'CHECKED_OUT'),
        shift('typed', -40, -32, 'MANUALLY_CORRECTED'),
        shift('rejected', -60, -52, 'REJECTED'),
        shift('sent', -80, -72, 'SUBMITTED'),
      ],
      now,
    );
    expect(result.readyToSubmit.map((row) => row.id)).toEqual(['worked', 'typed']);
    expect(result.needsCorrection.map((row) => row.id)).toEqual(['rejected']);
    expect(result.withFacility.map((row) => row.id)).toEqual(['sent']);
  });

  it('notices a shift that ended with nobody ever checked in', () => {
    const result = deriveShifts([shift('gone', -30, -22)], now);
    expect(result.endedUnattended.map((row) => row.id)).toEqual(['gone']);
    expect(result.checkInDue).toHaveLength(0);
  });

  it('ignores everything that is not a confirmed shift', () => {
    const cancelled = { ...shift('c', 1, 9), status: 'CANCELLED' };
    const result = deriveShifts([cancelled], now);
    expect(result.upcoming).toHaveLength(0);
    expect(result.next).toBeNull();
  });

  it('lists what is still to come earliest first and picks the nearest as next', () => {
    const result = deriveShifts([shift('later', 30, 38), shift('sooner', 8, 16)], now);
    expect(result.upcoming.map((row) => row.id)).toEqual(['sooner', 'later']);
    expect(result.next?.id).toBe('sooner');
  });
});

const offer = (id: string, status: string, expiresInH: number): TodayInvitation => ({
  id,
  status,
  expiresAt: hours(expiresInH),
  startsAt: hours(30),
  endsAt: hours(38),
  facilityName: 'Aso Garden',
  professionalCategoryId: 'c',
  hourlyRateKobo: 500_000,
  urgency: 'ROUTINE',
  levelName: null,
});

describe('offers waiting', () => {
  it('counts only offers still open, soonest to lapse first', () => {
    const waiting = openOffers(
      [
        offer('late', 'INVITED', 20),
        offer('soon', 'INVITED', 2),
        offer('lapsed', 'INVITED', -1),
        offer('done', 'ACCEPTED', 5),
      ],
      now,
    );
    expect(waiting.map((row) => row.id)).toEqual(['soon', 'late']);
  });
});

describe('credentials that are running out', () => {
  it('flags a verified credential inside the window, using the date printed on the document', () => {
    const result = expiringCredentials(
      [
        {
          id: 'a',
          credentialTypeId: 'licence',
          status: 'VERIFIED',
          documentExpiresOn: '2026-10-30',
        },
        { id: 'b', credentialTypeId: 'nin', status: 'VERIFIED', documentExpiresOn: '2027-06-01' },
      ],
      now,
    );
    expect(result.map((row) => row.id)).toEqual(['a']);
    expect(result[0]!.daysLeft).toBe(12);
    expect(result[0]!.expired).toBe(false);
  });

  it('counts the whole of the last day: a licence "expiring today" has not yet expired', () => {
    const result = expiringCredentials(
      [
        {
          id: 'a',
          credentialTypeId: 'licence',
          status: 'VERIFIED',
          documentExpiresOn: '2026-10-18',
        },
      ],
      now,
    );
    expect(result[0]).toMatchObject({ expired: false, daysLeft: 0 });
  });

  it('falls back to the platform’s own date only when none was read off the document', () => {
    const result = expiringCredentials(
      [{ id: 'a', credentialTypeId: 'licence', status: 'VERIFIED', expiresAt: hours(24 * 10) }],
      now,
    );
    expect(result).toHaveLength(1);
  });

  it('reports a lapsed credential, but not one that has been replaced', () => {
    const lapsed = {
      id: 'old',
      credentialTypeId: 'licence',
      status: 'EXPIRED',
      documentExpiresOn: '2026-09-01',
    };
    expect(expiringCredentials([lapsed], now).map((row) => [row.id, row.expired])).toEqual([
      ['old', true],
    ]);

    const replaced = {
      id: 'new',
      credentialTypeId: 'licence',
      status: 'VERIFIED',
      documentExpiresOn: '2027-09-01',
    };
    expect(expiringCredentials([lapsed, replaced], now)).toEqual([]);
  });

  it('ignores credentials that are not verified or have no date', () => {
    expect(
      expiringCredentials(
        [
          { id: 'p', credentialTypeId: 'x', status: 'PENDING', documentExpiresOn: '2026-10-20' },
          { id: 'n', credentialTypeId: 'y', status: 'VERIFIED' },
        ],
        now,
      ),
    ).toEqual([]);
  });
});

describe('days in words', () => {
  it('says them as a person would', () => {
    expect([0, 1, 12, -1, -9].map(daysPhrase)).toEqual([
      'today',
      'tomorrow',
      'in 12 days',
      'yesterday',
      '9 days ago',
    ]);
  });
});
