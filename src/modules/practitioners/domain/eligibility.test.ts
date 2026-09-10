import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REGISTRATION_REVIEW_DAYS,
  eligibilityBlockers,
  isEligibleForMatching,
  type EligibilityInput,
  type UserStatusValue,
} from './eligibility';
import type { ScreeningStatusValue } from './screening';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const RECENT = new Date('2026-09-01T12:00:00.000Z');
const FUTURE = new Date('2027-09-01T12:00:00.000Z');

const NIN_TYPE = 'type-nin';
const LICENCE_TYPE = 'type-licence';

/** A practitioner with nothing wrong with them. */
function eligible(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    userStatus: 'UNDER_REVIEW',
    hasProfile: true,
    identity: { nameMatch: true },
    screening: { status: 'CLEAR' },
    registration: {
      registrationStatus: 'ACTIVE',
      expiresAt: FUTURE,
      deletedAt: null,
      evidenceRetrievedAt: RECENT,
    },
    registrationReviewDays: DEFAULT_REGISTRATION_REVIEW_DAYS,
    requiredCredentialTypeIds: [NIN_TYPE, LICENCE_TYPE],
    verifiedCredentialTypeIds: [NIN_TYPE, LICENCE_TYPE],
    expiredCredentialTypeIds: [],
    ...overrides,
  };
}

describe('the happy path', () => {
  it('is eligible with nothing outstanding', () => {
    expect(eligibilityBlockers(eligible(), NOW)).toEqual([]);
    expect(isEligibleForMatching(eligible(), NOW)).toBe(true);
  });

  it('is eligible once already ACTIVE', () => {
    expect(isEligibleForMatching(eligible({ userStatus: 'ACTIVE' }), NOW)).toBe(true);
  });

  it('does not require credentials a category does not ask for', () => {
    // A nurse does not need a doctor's licence. Requirements are per
    // category, which is the whole reason CredentialRequirement exists.
    const nurse = eligible({
      requiredCredentialTypeIds: [NIN_TYPE],
      verifiedCredentialTypeIds: [NIN_TYPE],
    });
    expect(isEligibleForMatching(nurse, NOW)).toBe(true);
  });
});

describe('each blocker on its own', () => {
  it.each(['PENDING_VERIFICATION', 'SUSPENDED', 'DEACTIVATED'] as UserStatusValue[])(
    'blocks a %s account',
    (userStatus) => {
      expect(eligibilityBlockers(eligible({ userStatus }), NOW)).toContain('account_not_usable');
    },
  );

  it('does not treat UNDER_REVIEW as a blocker', () => {
    // It is the state a practitioner sits in until they become eligible, and
    // this function is what promotes them out of it.
    expect(eligibilityBlockers(eligible({ userStatus: 'UNDER_REVIEW' }), NOW)).toEqual([]);
  });

  it('blocks a missing profile', () => {
    expect(eligibilityBlockers(eligible({ hasProfile: false }), NOW)).toContain('profile_incomplete');
  });

  it('blocks an unverified identity', () => {
    expect(eligibilityBlockers(eligible({ identity: null }), NOW)).toContain('identity_unverified');
  });

  it('blocks an identity whose name did not match', () => {
    expect(eligibilityBlockers(eligible({ identity: { nameMatch: false } }), NOW)).toContain(
      'identity_name_mismatch',
    );
  });

  it('blocks a missing registration', () => {
    expect(eligibilityBlockers(eligible({ registration: null }), NOW)).toContain(
      'registration_missing',
    );
  });

  it.each(['SUSPENDED', 'EXPIRED', 'STRUCK_OFF', 'UNKNOWN'] as const)(
    'blocks a %s registration',
    (registrationStatus) => {
      const input = eligible({
        registration: {
          registrationStatus,
          expiresAt: FUTURE,
          deletedAt: null,
          evidenceRetrievedAt: RECENT,
        },
      });
      expect(eligibilityBlockers(input, NOW)).toContain('registration_not_active');
    },
  );

  it('blocks a registration whose evidence has gone stale', () => {
    const input = eligible({
      registration: {
        registrationStatus: 'ACTIVE',
        expiresAt: FUTURE,
        deletedAt: null,
        evidenceRetrievedAt: new Date('2024-01-01T00:00:00.000Z'),
      },
    });
    // An active licence checked two years ago is not evidence about tomorrow.
    expect(eligibilityBlockers(input, NOW)).toContain('registration_evidence_stale');
  });

  it('blocks a missing mandatory credential', () => {
    const input = eligible({ verifiedCredentialTypeIds: [NIN_TYPE] });
    expect(eligibilityBlockers(input, NOW)).toContain('credential_missing');
  });

  it('blocks an expired mandatory credential', () => {
    const input = eligible({
      verifiedCredentialTypeIds: [NIN_TYPE],
      expiredCredentialTypeIds: [LICENCE_TYPE],
    });
    expect(eligibilityBlockers(input, NOW)).toContain('credential_expired');
  });

  it('ignores an expired credential the category does not require', () => {
    const input = eligible({ expiredCredentialTypeIds: ['type-something-optional'] });
    expect(isEligibleForMatching(input, NOW)).toBe(true);
  });

  it.each(['PENDING', 'FLAGGED'] as ScreeningStatusValue[])('blocks %s screening', (status) => {
    expect(eligibilityBlockers(eligible({ screening: { status } }), NOW)).toContain(
      'screening_not_clear',
    );
  });

  it('blocks a practitioner never screened at all', () => {
    expect(eligibilityBlockers(eligible({ screening: null }), NOW)).toContain('screening_not_clear');
  });
});

describe('reporting', () => {
  it('reports every reason at once, not just the first', () => {
    const nothingDone = eligible({
      hasProfile: false,
      identity: null,
      screening: null,
      registration: null,
      verifiedCredentialTypeIds: [],
    });

    expect(eligibilityBlockers(nothingDone, NOW).sort()).toEqual(
      [
        'credential_missing',
        'identity_unverified',
        'profile_incomplete',
        'registration_missing',
        'screening_not_clear',
      ].sort(),
    );
  });
});

/**
 * Step 5.8's stated verification: "a property test asserts the invariant
 * holds for random profiles". The invariant is rule 5 of the README — no
 * practitioner is matched to work before identity and licence verification
 * pass — and it must hold for every combination, not the ones somebody
 * thought to write down.
 */
describe('the invariant, over generated profiles', () => {
  const screenings: (ScreeningStatusValue | null)[] = ['CLEAR', 'PENDING', 'FLAGGED', null];
  const registrationStatuses = ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'STRUCK_OFF', 'UNKNOWN'] as const;

  /** A deterministic pseudo-random source, so a failure is reproducible. */
  function makeRandom(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }

  /**
   * Weighted towards the eligible, on purpose. An unweighted generator makes
   * eligibility so unlikely that the run is almost entirely the refusal path,
   * and the interesting assertion — what a *passing* profile must satisfy —
   * barely executes.
   */
  function generate(random: () => number): EligibilityInput {
    const pick = <T>(options: readonly T[]): T =>
      options[Math.floor(random() * options.length)] as T;
    const usually = (probability: number) => random() < probability;

    const hasRegistration = usually(0.85);
    const required = usually(0.5) ? [NIN_TYPE, LICENCE_TYPE] : [NIN_TYPE];
    const verified = required.filter(() => usually(0.85));

    return {
      userStatus: usually(0.7)
        ? pick(['ACTIVE', 'UNDER_REVIEW'] as UserStatusValue[])
        : pick(['PENDING_VERIFICATION', 'SUSPENDED', 'DEACTIVATED'] as UserStatusValue[]),
      hasProfile: usually(0.9),
      identity: usually(0.85) ? { nameMatch: usually(0.85) } : null,
      screening: usually(0.7)
        ? { status: 'CLEAR' as ScreeningStatusValue }
        : (() => {
            const status = pick(screenings);
            return status === null ? null : { status };
          })(),
      registration: hasRegistration
        ? {
            registrationStatus: usually(0.7) ? 'ACTIVE' : pick(registrationStatuses),
            expiresAt: usually(0.85) ? FUTURE : new Date('2025-01-01T00:00:00.000Z'),
            deletedAt: null,
            evidenceRetrievedAt: usually(0.85) ? RECENT : new Date('2023-01-01T00:00:00.000Z'),
          }
        : null,
      registrationReviewDays: DEFAULT_REGISTRATION_REVIEW_DAYS,
      requiredCredentialTypeIds: required,
      verifiedCredentialTypeIds: verified,
      expiredCredentialTypeIds: usually(0.1) ? [LICENCE_TYPE] : [],
    };
  }

  it('never lets an unverified practitioner through, over 5000 profiles', () => {
    const random = makeRandom(20260910);
    let eligibleCount = 0;

    for (let index = 0; index < 5000; index += 1) {
      const input = generate(random);
      const allowed = isEligibleForMatching(input, NOW);
      if (!allowed) continue;
      eligibleCount += 1;

      // Anything eligible must satisfy every part of the rule. Stated as
      // separate assertions so a failure names which one gave way.
      expect(input.identity, JSON.stringify(input)).not.toBeNull();
      expect(input.identity?.nameMatch, JSON.stringify(input)).toBe(true);
      expect(input.registration, JSON.stringify(input)).not.toBeNull();
      expect(input.registration?.registrationStatus, JSON.stringify(input)).toBe('ACTIVE');
      expect(input.screening?.status, JSON.stringify(input)).toBe('CLEAR');
      expect(input.hasProfile, JSON.stringify(input)).toBe(true);
      for (const id of input.requiredCredentialTypeIds) {
        expect(input.verifiedCredentialTypeIds, JSON.stringify(input)).toContain(id);
        expect(input.expiredCredentialTypeIds, JSON.stringify(input)).not.toContain(id);
      }
    }

    // The generator must actually produce eligible profiles, or this test
    // passes by never testing anything — the empty-room failure again.
    expect(eligibleCount).toBeGreaterThan(500);
  });
});
