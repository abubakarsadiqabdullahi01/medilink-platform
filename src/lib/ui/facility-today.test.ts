import { describe, expect, it } from 'vitest';
import { facilityAttention, type FacilitySummaryJson } from './facility-today';

const now = new Date('2026-10-18T12:00:00Z');
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

const verified = { status: 'VERIFIED', canPublish: true, publishBlockers: [] };

const ids = (summary: FacilitySummaryJson | undefined, facility = verified) =>
  facilityAttention({ summary, facility, now }).map((item) => item.id);

describe('what a facility must deal with, in order', () => {
  it('says nothing when there is nothing, and nothing at all for sections the person may not see', () => {
    expect(ids({})).toEqual([]);
    expect(ids(undefined)).toEqual([]);
  });

  it('puts an absent practitioner before everything that is merely open', () => {
    const summary: FacilitySummaryJson = {
      attendance: {
        notArrived: 1,
        notArrivedEarliestStart: ago(1),
        endedUnattended: 0,
        noShows7d: 0,
      },
      awaitingApproval: 3,
      awaitingOldest: ago(48),
    };
    const items = facilityAttention({ summary, facility: verified, now });
    expect(items.map((item) => item.id)).toEqual(['not-arrived', 'timesheets']);
    expect(items[0]!.tone).toBe('danger');
    expect(items[1]!.detail).toContain('2 days');
  });

  it('counts a shift as short today only when places are open, and says how many', () => {
    const summary: FacilitySummaryJson = {
      coverage: {
        todayShifts: 3,
        todayNeeded: 5,
        todayFilled: 3,
        todayUnfilledShifts: 2,
        openShifts: 4,
        openNext24h: 0,
        nextOpenStartsAt: null,
        today: [],
        open: [],
      },
    };
    const [item] = facilityAttention({ summary, facility: verified, now });
    expect(item).toMatchObject({ id: 'today-short', tone: 'warning' });
    expect(item!.title).toBe('2 shifts today are short of people');
    expect(item!.detail).toBe('3 of 5 places filled; 2 still open.');
  });

  it('asks the owner to confirm what practitioners have accepted, and says how long they have waited', () => {
    const summary: FacilitySummaryJson = {
      offers: {
        awaitingResponse: 7,
        oldestAwaitingResponse: ago(2),
        awaitingConfirmation: 1,
        oldestAwaitingConfirmation: ago(5),
      },
    };
    const items = facilityAttention({ summary, facility: verified, now });
    expect(items.map((item) => item.id)).toEqual(['confirm', 'offers-out']);
    expect(items[0]!.title).toContain('1 practitioner has accepted and is waiting');
    expect(items[0]!.detail).toContain('5 hours');
    // Offers out are information, not a task.
    expect(items[1]!.tone).toBe('info');
  });

  it('reports a lapsed licence as the thing stopping every shift, ahead of the shifts', () => {
    const items = facilityAttention({
      summary: { awaitingApproval: 1 },
      facility: { status: 'VERIFIED', canPublish: false, publishBlockers: ['licence_expired'] },
      now,
    });
    expect(items[0]).toMatchObject({ id: 'licence', tone: 'danger' });
  });

  it('warns of a licence that will lapse within thirty days, in Lagos calendar days', () => {
    const items = facilityAttention({
      summary: {},
      facility: { ...verified, licenceExpiresAt: '2026-11-05T00:00:00.000Z' },
      now,
    });
    expect(items[0]!.title).toBe('The facility licence expires in 18 days');

    expect(
      facilityAttention({
        summary: {},
        facility: { ...verified, licenceExpiresAt: '2027-03-01T00:00:00.000Z' },
        now,
      }),
    ).toEqual([]);
  });

  it('explains each reason a facility cannot publish, with what compliance said', () => {
    const rejected = facilityAttention({
      summary: {},
      facility: { status: 'REJECTED', reviewNotes: 'CAC number does not match.' },
      now,
    })[0]!;
    expect(rejected).toMatchObject({ tone: 'danger', href: '/facility/profile' });
    expect(rejected.detail).toContain('CAC number does not match.');
    expect(facilityAttention({ summary: {}, facility: { status: 'PENDING' }, now })[0]!.tone).toBe(
      'warning',
    );
    expect(
      facilityAttention({ summary: {}, facility: { status: 'SUSPENDED' }, now })[0]!.href,
    ).toBe('/contact');
  });

  it('flags a single owner and invitations that ran out, only to somebody who can see staff', () => {
    expect(
      ids({ staff: { people: 3, owners: 1, pendingInvitations: 0, lapsedInvitations: 2 } }),
    ).toEqual(['lapsed-invitations', 'sole-owner']);
    expect(
      ids({ staff: { people: 3, owners: 2, pendingInvitations: 1, lapsedInvitations: 0 } }),
    ).toEqual([]);
  });

  it('says what is owed in naira, and calls an old invoice a warning rather than information', () => {
    const fresh = facilityAttention({
      summary: {
        invoices: {
          outstandingKobo: 4_294_565_21,
          outstandingCount: 1,
          oldestIssuedAt: ago(24 * 5),
          paid30dKobo: 0,
        },
      },
      facility: verified,
      now,
    })[0]!;
    expect(fresh.title).toBe('₦4,294,565.21 outstanding on 1 invoice');
    expect(fresh.tone).toBe('info');

    const old = facilityAttention({
      summary: {
        invoices: {
          outstandingKobo: 1_000_000,
          outstandingCount: 2,
          oldestIssuedAt: ago(24 * 45),
          paid30dKobo: 0,
        },
      },
      facility: verified,
      now,
    })[0]!;
    expect(old.tone).toBe('warning');
  });
});
