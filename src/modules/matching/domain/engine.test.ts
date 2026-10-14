import { describe, expect, it } from 'vitest';
import {
  COLD_START_ASSIGNMENTS,
  EXPERIENCE_CAP_YEARS,
  FATIGUE_CAP_HOURS,
  NEUTRAL_RELIABILITY,
  TOTAL_WEIGHT,
  WEIGHTS,
  exclusionsFor,
  match,
  proximityTier,
  scoreCandidate,
  type CandidateInput,
  type RequestInput,
} from './engine';

const CATEGORY = 'category-doctor';
const SPECIALTY = 'specialty-anaesthesia';

const REQUEST: RequestInput = { professionalCategoryId: CATEGORY, specialtyId: null };

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    userId: 'user-b',
    professionalCategoryId: CATEGORY,
    specialtyId: null,
    yearsOfExperience: 5,
    proximity: 'SAME_STATE',
    travelPreference: 'ANYWHERE',
    eligible: true,
    availability: 'available',
    hasConflictingAssignment: false,
    hoursAssignedInWindow: 0,
    completedAssignments: 0,
    reliabilityScore: null,
    ...overrides,
  };
}

function factor(input: CandidateInput, name: keyof typeof WEIGHTS) {
  const found = scoreCandidate(input).find((entry) => entry.factor === name);
  if (!found) throw new Error(`no ${name} factor`);
  return found;
}

describe('the weights', () => {
  it('sum to 100, so a score reads as a percentage', () => {
    expect(TOTAL_WEIGHT).toBe(100);
  });
});

describe('hard filters', () => {
  it('passes a candidate with nothing against them', () => {
    expect(exclusionsFor(REQUEST, candidate())).toEqual([]);
  });

  it('excludes an ineligible practitioner', () => {
    // Rule 5 of the README, reached through the Stage 5 invariant rather than
    // restated here.
    expect(exclusionsFor(REQUEST, candidate({ eligible: false }))).toContain('not_eligible');
  });

  it('excludes the wrong professional category', () => {
    expect(
      exclusionsFor(REQUEST, candidate({ professionalCategoryId: 'category-nurse' })),
    ).toContain('category_mismatch');
  });

  it('treats a requested specialty as a requirement, not a preference', () => {
    const request: RequestInput = { professionalCategoryId: CATEGORY, specialtyId: SPECIALTY };

    // Asking for an anaesthetist and being sent a generalist is a clinical
    // failure, not a near miss.
    expect(exclusionsFor(request, candidate({ specialtyId: null }))).toContain(
      'specialty_mismatch',
    );
    expect(exclusionsFor(request, candidate({ specialtyId: 'specialty-other' }))).toContain(
      'specialty_mismatch',
    );
    expect(exclusionsFor(request, candidate({ specialtyId: SPECIALTY }))).toEqual([]);
  });

  it('treats a requested level as a requirement: a house officer is not a registrar', () => {
    const request: RequestInput = { professionalCategoryId: CATEGORY, specialtyId: null, cadreLevelId: 'level-registrar' };

    expect(exclusionsFor(request, candidate({ cadreLevelId: 'level-house-officer' }))).toContain('level_mismatch');
    // Nobody has recorded where they stand, so there is nothing to say they are a registrar.
    expect(exclusionsFor(request, candidate({ cadreLevelId: null }))).toContain('level_mismatch');
    expect(exclusionsFor(request, candidate({ cadreLevelId: 'level-registrar' }))).toEqual([]);
  });

  it('asks nothing of the level when the request names none', () => {
    expect(exclusionsFor(REQUEST, candidate({ cadreLevelId: 'level-registrar' }))).toEqual([]);
    expect(exclusionsFor(REQUEST, candidate({ cadreLevelId: null }))).toEqual([]);
  });

  it('keeps somebody who needs supervision off a shift that does not offer it', () => {
    const unsupervised: RequestInput = { professionalCategoryId: CATEGORY, specialtyId: null };
    const supervised: RequestInput = { ...unsupervised, supervisionAvailable: true };

    expect(exclusionsFor(unsupervised, candidate({ supervised: true }))).toContain('supervision_required');
    expect(exclusionsFor(supervised, candidate({ supervised: true }))).toEqual([]);
    // A shift that offers supervision is still open to somebody who does not need it.
    expect(exclusionsFor(supervised, candidate({ supervised: false }))).toEqual([]);
  });

  it('accepts any specialty when the request names none', () => {
    expect(exclusionsFor(REQUEST, candidate({ specialtyId: SPECIALTY }))).toEqual([]);
  });

  it('distinguishes blocked from simply not offered', () => {
    // Step 6.2's verification, seen from the matcher: a blocked period
    // removes the practitioner from candidates.
    expect(exclusionsFor(REQUEST, candidate({ availability: 'blocked' }))).toContain('blocked');
    expect(exclusionsFor(REQUEST, candidate({ availability: 'not_offered' }))).toContain(
      'unavailable',
    );
  });

  it('excludes somebody already working then', () => {
    expect(exclusionsFor(REQUEST, candidate({ hasConflictingAssignment: true }))).toContain(
      'already_assigned',
    );
  });

  it('respects a travel preference', () => {
    const homebody = { travelPreference: 'SAME_LGA' as const };
    expect(exclusionsFor(REQUEST, candidate({ ...homebody, proximity: 'SAME_LGA' }))).toEqual([]);
    expect(
      exclusionsFor(REQUEST, candidate({ ...homebody, proximity: 'SAME_STATE' })),
    ).toContain('travel_preference');

    const stateOnly = { travelPreference: 'SAME_STATE' as const };
    expect(exclusionsFor(REQUEST, candidate({ ...stateOnly, proximity: 'SAME_STATE' }))).toEqual([]);
    expect(exclusionsFor(REQUEST, candidate({ ...stateOnly, proximity: 'ELSEWHERE' }))).toContain(
      'travel_preference',
    );

    expect(
      exclusionsFor(REQUEST, candidate({ travelPreference: 'ANYWHERE', proximity: 'ELSEWHERE' })),
    ).toEqual([]);
  });

  it('reports every reason at once', () => {
    const hopeless = candidate({
      eligible: false,
      professionalCategoryId: 'category-nurse',
      availability: 'blocked',
      hasConflictingAssignment: true,
    });

    // An officer asking "why did nobody match?" wants the whole picture.
    expect(exclusionsFor(REQUEST, hopeless).sort()).toEqual(
      ['already_assigned', 'blocked', 'category_mismatch', 'not_eligible'].sort(),
    );
  });
});

describe('the experience factor', () => {
  it('scores zero for a newcomer and full at the cap', () => {
    expect(factor(candidate({ yearsOfExperience: 0 }), 'experience').raw).toBe(0);
    expect(factor(candidate({ yearsOfExperience: EXPERIENCE_CAP_YEARS }), 'experience').raw).toBe(1);
  });

  it('does not keep rewarding beyond the cap', () => {
    // Uncapped, a forty-year veteran would outrank somebody next door who is
    // rested and available, on a dimension that had stopped meaning anything.
    const capped = factor(candidate({ yearsOfExperience: EXPERIENCE_CAP_YEARS }), 'experience');
    const veteran = factor(candidate({ yearsOfExperience: 40 }), 'experience');
    expect(veteran.points).toBe(capped.points);
  });
});

describe('the proximity factor', () => {
  it('rewards nearness in tiers', () => {
    const near = factor(candidate({ proximity: 'SAME_LGA' }), 'proximity');
    const middling = factor(candidate({ proximity: 'SAME_STATE' }), 'proximity');
    const far = factor(candidate({ proximity: 'ELSEWHERE' }), 'proximity');

    expect(near.raw).toBeGreaterThan(middling.raw);
    expect(middling.raw).toBeGreaterThan(far.raw);
    expect(far.raw).toBeGreaterThan(0);
  });
});

describe('the fatigue factor', () => {
  it('is full for somebody with nothing booked', () => {
    expect(factor(candidate({ hoursAssignedInWindow: 0 }), 'fatigue').raw).toBe(1);
  });

  it('falls to zero at the weekly cap and stays there', () => {
    expect(factor(candidate({ hoursAssignedInWindow: FATIGUE_CAP_HOURS }), 'fatigue').raw).toBe(0);
    expect(factor(candidate({ hoursAssignedInWindow: 200 }), 'fatigue').raw).toBe(0);
  });

  it('falls as hours accumulate', () => {
    const rested = factor(candidate({ hoursAssignedInWindow: 8 }), 'fatigue');
    const tired = factor(candidate({ hoursAssignedInWindow: 36 }), 'fatigue');
    expect(rested.raw).toBeGreaterThan(tired.raw);
  });
});

describe('step 6.4 — cold start', () => {
  it('scores a practitioner with no history as neutral', () => {
    const newcomer = factor(candidate({ completedAssignments: 0 }), 'reliability');
    expect(newcomer.raw).toBe(NEUTRAL_RELIABILITY);
    expect(newcomer.detail).toContain('neutral');
  });

  it('keeps scoring neutral right up to the threshold', () => {
    const almost = candidate({
      completedAssignments: COLD_START_ASSIGNMENTS - 1,
      reliabilityScore: 0.99,
    });
    // Four assignments is not yet a record; the score is ignored until five.
    expect(factor(almost, 'reliability').raw).toBe(NEUTRAL_RELIABILITY);
  });

  it('starts trusting the score at the threshold', () => {
    const proven = candidate({ completedAssignments: COLD_START_ASSIGNMENTS, reliabilityScore: 0.9 });
    expect(factor(proven, 'reliability').raw).toBe(0.9);
  });

  it('appears in results, neither boosted nor penalised', () => {
    // Step 6.4's verification. A newcomer and a proven-average practitioner,
    // identical in every other way, must score identically.
    const newcomer = candidate({ userId: 'user-a', completedAssignments: 0, reliabilityScore: null });
    const average = candidate({
      userId: 'user-b',
      completedAssignments: 10,
      reliabilityScore: NEUTRAL_RELIABILITY,
    });

    const result = match(REQUEST, [newcomer, average]);

    expect(result.ranked).toHaveLength(2);
    expect(result.ranked[0]?.score).toBe(result.ranked[1]?.score);
  });

  it('still ranks a proven-good practitioner above a newcomer', () => {
    const newcomer = candidate({ userId: 'user-a', completedAssignments: 0 });
    const excellent = candidate({
      userId: 'user-z',
      completedAssignments: 20,
      reliabilityScore: 1,
    });

    const result = match(REQUEST, [newcomer, excellent]);
    expect(result.ranked[0]?.userId).toBe('user-z');
  });
});

describe('ranking', () => {
  it('puts the better candidate first and explains both', () => {
    const near = candidate({ userId: 'user-near', proximity: 'SAME_LGA', yearsOfExperience: 10 });
    const far = candidate({ userId: 'user-far', proximity: 'ELSEWHERE', yearsOfExperience: 1 });

    const result = match(REQUEST, [far, near]);

    expect(result.ranked.map((entry) => entry.userId)).toEqual(['user-near', 'user-far']);
    expect(result.ranked[0]?.rank).toBe(1);
    // "For any candidate, why they ranked where they did" — every factor, its
    // weight, and what it contributed.
    expect(result.ranked[0]?.factors.map((entry) => entry.factor).sort()).toEqual(
      ['experience', 'fatigue', 'proximity', 'reliability'].sort(),
    );
  });

  it('scores a perfect candidate at 100 and a worst-case above 0', () => {
    const best = candidate({
      yearsOfExperience: EXPERIENCE_CAP_YEARS,
      proximity: 'SAME_LGA',
      hoursAssignedInWindow: 0,
      completedAssignments: 10,
      reliabilityScore: 1,
    });
    expect(match(REQUEST, [best]).ranked[0]?.score).toBe(100);

    const worst = candidate({
      yearsOfExperience: 0,
      proximity: 'ELSEWHERE',
      hoursAssignedInWindow: FATIGUE_CAP_HOURS,
      completedAssignments: 10,
      reliabilityScore: 0,
    });
    // Still a candidate, just a poor one: exclusion is what removes people.
    expect(match(REQUEST, [worst]).ranked[0]?.score).toBeGreaterThan(0);
  });

  it('breaks ties on user id, so a run cannot reorder itself', () => {
    const first = candidate({ userId: 'user-aaa' });
    const second = candidate({ userId: 'user-bbb' });

    expect(match(REQUEST, [second, first]).ranked.map((entry) => entry.userId)).toEqual([
      'user-aaa',
      'user-bbb',
    ]);
  });

  it('keeps the excluded out of the ranking but in the result', () => {
    const ok = candidate({ userId: 'user-ok' });
    const not = candidate({ userId: 'user-not', eligible: false });

    const result = match(REQUEST, [ok, not]);

    expect(result.ranked.map((entry) => entry.userId)).toEqual(['user-ok']);
    expect(result.excluded).toEqual([{ userId: 'user-not', reasons: ['not_eligible'] }]);
  });

  it('gives the same answer for the same inputs, whatever order they arrive in', () => {
    // 6.3's "reproducible": a snapshot of the whole result, twice, from
    // differently ordered inputs.
    const candidates = [
      candidate({ userId: 'user-c', proximity: 'SAME_LGA', yearsOfExperience: 3 }),
      candidate({ userId: 'user-a', proximity: 'SAME_STATE', yearsOfExperience: 9 }),
      candidate({ userId: 'user-b', proximity: 'ELSEWHERE', yearsOfExperience: 9 }),
      candidate({ userId: 'user-d', eligible: false }),
    ];

    const forwards = match(REQUEST, candidates);
    const backwards = match(REQUEST, [...candidates].reverse());

    expect(forwards).toEqual(backwards);
    expect(forwards).toMatchSnapshot();
  });
});

describe('proximityTier', () => {
  it('is SAME_LGA when the local government areas match', () => {
    expect(
      proximityTier({
        facilityStateId: 'state-imo',
        facilityLgaId: 'lga-owerri',
        homeStateId: 'state-imo',
        homeLgaId: 'lga-owerri',
      }),
    ).toBe('SAME_LGA');
  });

  it('is SAME_STATE when only the state matches', () => {
    expect(
      proximityTier({
        facilityStateId: 'state-imo',
        facilityLgaId: 'lga-owerri',
        homeStateId: 'state-imo',
        homeLgaId: 'lga-okigwe',
      }),
    ).toBe('SAME_STATE');
  });

  it('is ELSEWHERE for a different state', () => {
    expect(
      proximityTier({
        facilityStateId: 'state-imo',
        facilityLgaId: 'lga-owerri',
        homeStateId: 'state-lagos',
        homeLgaId: 'lga-ikeja',
      }),
    ).toBe('ELSEWHERE');
  });

  it('treats an unstated home as far away, not near', () => {
    // A guess in their favour would put them in front of somebody who
    // actually is nearby.
    expect(
      proximityTier({
        facilityStateId: 'state-imo',
        facilityLgaId: 'lga-owerri',
        homeStateId: null,
        homeLgaId: null,
      }),
    ).toBe('ELSEWHERE');
  });
});
