import { describe, expect, it } from 'vitest';
import {
  canTransitionAssignment,
  confirmBlockers,
  isInvitationOpen,
  overlaps,
  type ConfirmCheck,
} from './assignment';

const NOW = new Date('2026-09-10T12:00:00.000Z');

describe('overlaps', () => {
  it('is true for a genuine clash', () => {
    expect(
      overlaps(
        { startsAt: new Date('2026-09-14T08:00:00Z'), endsAt: new Date('2026-09-14T16:00:00Z') },
        { startsAt: new Date('2026-09-14T15:00:00Z'), endsAt: new Date('2026-09-14T23:00:00Z') },
      ),
    ).toBe(true);
  });

  it('is false for back-to-back shifts', () => {
    // Ending at 14:00 and starting at 14:00 is a fatigue question, not a
    // scheduling impossibility — and fatigue is a scoring factor, not a bar.
    expect(
      overlaps(
        { startsAt: new Date('2026-09-14T06:00:00Z'), endsAt: new Date('2026-09-14T14:00:00Z') },
        { startsAt: new Date('2026-09-14T14:00:00Z'), endsAt: new Date('2026-09-14T22:00:00Z') },
      ),
    ).toBe(false);
  });

  it('catches a shift wholly inside another', () => {
    expect(
      overlaps(
        { startsAt: new Date('2026-09-14T06:00:00Z'), endsAt: new Date('2026-09-14T22:00:00Z') },
        { startsAt: new Date('2026-09-14T10:00:00Z'), endsAt: new Date('2026-09-14T12:00:00Z') },
      ),
    ).toBe(true);
  });
});

describe('isInvitationOpen', () => {
  it('is open while invited and unexpired', () => {
    expect(
      isInvitationOpen({ status: 'INVITED', expiresAt: new Date('2026-09-11T00:00:00Z') }, NOW),
    ).toBe(true);
  });

  it('is closed once it has lapsed', () => {
    expect(
      isInvitationOpen({ status: 'INVITED', expiresAt: new Date('2026-09-09T00:00:00Z') }, NOW),
    ).toBe(false);
  });

  it.each(['ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'] as const)(
    'is closed once %s',
    (status) => {
      expect(isInvitationOpen({ status, expiresAt: new Date('2026-09-11T00:00:00Z') }, NOW)).toBe(
        false,
      );
    },
  );
});

describe('canTransitionAssignment', () => {
  it('allows cancelling a confirmed assignment', () => {
    expect(canTransitionAssignment('CONFIRMED', 'CANCELLED')).toBe(true);
  });

  it('leaves COMPLETED and NO_SHOW reachable for Stage 7', () => {
    expect(canTransitionAssignment('CONFIRMED', 'COMPLETED')).toBe(true);
    expect(canTransitionAssignment('CONFIRMED', 'NO_SHOW')).toBe(true);
  });

  it('never reopens a closed assignment', () => {
    expect(canTransitionAssignment('CANCELLED', 'CONFIRMED')).toBe(false);
    expect(canTransitionAssignment('COMPLETED', 'CANCELLED')).toBe(false);
  });
});

describe('confirmBlockers', () => {
  const ready: ConfirmCheck = {
    requestStatus: 'PUBLISHED',
    shiftStarted: false,
    facilityActive: true,
    practitionerBookable: true,
    headcount: 2,
    confirmedCount: 0,
    invitationStatus: 'ACCEPTED',
    alreadyAssigned: false,
    hasConflict: false,
  };

  it('is empty when everything is in order', () => {
    expect(confirmBlockers(ready)).toEqual([]);
  });

  it('refuses a request that is not published', () => {
    expect(confirmBlockers({ ...ready, requestStatus: 'CANCELLED' })).toContain(
      'request_not_published',
    );
  });

  it('refuses a shift that has already started', () => {
    expect(confirmBlockers({ ...ready, shiftStarted: true })).toContain('shift_started');
  });

  it('refuses when the facility is no longer verified and in date', () => {
    // Verification is not a one-off: a lapsed licence stops new bookings at once.
    expect(confirmBlockers({ ...ready, facilityActive: false })).toContain('facility_not_verified');
  });

  it('refuses a practitioner who is no longer eligible, in the profession, or consenting', () => {
    expect(confirmBlockers({ ...ready, practitionerBookable: false })).toContain(
      'practitioner_not_bookable',
    );
  });

  it('reports every reason at once, not just the first', () => {
    expect(
      confirmBlockers({ ...ready, shiftStarted: true, facilityActive: false, practitionerBookable: false }),
    ).toEqual(['shift_started', 'facility_not_verified', 'practitioner_not_bookable']);
  });

  it('refuses once the headcount is met', () => {
    expect(confirmBlockers({ ...ready, confirmedCount: 2 })).toContain('request_full');
  });

  it('refuses without an accepted invitation', () => {
    // A facility cannot confirm somebody who never said yes.
    expect(confirmBlockers({ ...ready, invitationStatus: 'INVITED' })).toContain(
      'invitation_not_accepted',
    );
    expect(confirmBlockers({ ...ready, invitationStatus: null })).toContain(
      'invitation_not_accepted',
    );
  });

  it('refuses a second confirmation of the same practitioner', () => {
    expect(confirmBlockers({ ...ready, alreadyAssigned: true })).toContain('already_assigned');
  });

  it('refuses a clashing shift', () => {
    // Step 6.7: overlaps are prevented, not warned about.
    expect(confirmBlockers({ ...ready, hasConflict: true })).toContain('conflicting_assignment');
  });

  it('reports every reason at once', () => {
    expect(
      confirmBlockers({
        requestStatus: 'CANCELLED',
        shiftStarted: true,
        facilityActive: false,
        practitionerBookable: false,
        headcount: 1,
        confirmedCount: 1,
        invitationStatus: 'DECLINED',
        alreadyAssigned: true,
        hasConflict: true,
      }),
    ).toHaveLength(8);
  });
});
