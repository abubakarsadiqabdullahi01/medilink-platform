import { describe, expect, it } from 'vitest';
import {
  ANY_LEVEL,
  ANY_SPECIALTY,
  checkAgainstFloor,
  floorProblem,
  MAX_FLOOR_HOURLY_KOBO,
  resolveRateFloor,
  type RateFloorLike,
} from './rate-floor';
import { canTransition, publishBlockers, shiftHours } from './request';

const SHIFT_AT = new Date('2026-09-14T20:00:00.000Z');

function floor(overrides: Partial<RateFloorLike> = {}): RateFloorLike {
  return {
    categoryKey: 'doctor',
    specialtyKey: ANY_SPECIALTY,
    shiftType: 'night',
    minHourlyKobo: 650_000,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const QUERY = {
  categoryKey: 'doctor',
  specialtyKey: null,
  shiftType: 'NIGHT' as const,
  at: SHIFT_AT,
};

describe('resolveRateFloor', () => {
  it('matches the enum against the lowercase column', () => {
    // ShiftType is uppercase; config.rate_floors predates it and is not.
    expect(resolveRateFloor([floor()], QUERY)?.minHourlyKobo).toBe(650_000);
  });

  it('returns null when no floor is published for that combination', () => {
    expect(resolveRateFloor([floor({ categoryKey: 'nurse' })], QUERY)).toBeNull();
    expect(resolveRateFloor([floor({ shiftType: 'day' })], QUERY)).toBeNull();
    expect(resolveRateFloor([], QUERY)).toBeNull();
  });

  it('ignores a floor that is not yet in effect', () => {
    const future = floor({ effectiveFrom: new Date('2027-01-01T00:00:00.000Z') });
    expect(resolveRateFloor([future], QUERY)).toBeNull();
  });

  it('prefers the latest floor in effect at the shift', () => {
    const older = floor({ minHourlyKobo: 500_000 });
    const newer = floor({
      minHourlyKobo: 700_000,
      effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(resolveRateFloor([older, newer], QUERY)?.minHourlyKobo).toBe(700_000);
    // Order of the input must not decide it.
    expect(resolveRateFloor([newer, older], QUERY)?.minHourlyKobo).toBe(700_000);
  });

  it('judges by the shift date, not by today', () => {
    // A floor that rises next month does not govern a shift being priced for
    // next week.
    const notYet = floor({
      minHourlyKobo: 900_000,
      effectiveFrom: new Date('2026-10-01T00:00:00.000Z'),
    });
    expect(resolveRateFloor([floor(), notYet], QUERY)?.minHourlyKobo).toBe(650_000);
  });

  it('lets a specialty floor beat the category-wide one', () => {
    const categoryWide = floor({ minHourlyKobo: 650_000 });
    const anaesthesia = floor({ specialtyKey: 'anaesthesia', minHourlyKobo: 800_000 });

    // Anaesthesia having its own floor is why the column exists; falling back
    // to the category rate would quietly underpay it.
    const resolved = resolveRateFloor([categoryWide, anaesthesia], {
      ...QUERY,
      specialtyKey: 'anaesthesia',
    });
    expect(resolved?.minHourlyKobo).toBe(800_000);
  });

  it('prefers the specialty floor even when the category one is newer', () => {
    const newerCategory = floor({
      minHourlyKobo: 700_000,
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
    });
    const anaesthesia = floor({ specialtyKey: 'anaesthesia', minHourlyKobo: 800_000 });

    const resolved = resolveRateFloor([newerCategory, anaesthesia], {
      ...QUERY,
      specialtyKey: 'anaesthesia',
    });
    expect(resolved?.minHourlyKobo).toBe(800_000);
  });

  it('falls back to the category floor for a specialty with none of its own', () => {
    const resolved = resolveRateFloor([floor(), floor({ specialtyKey: 'anaesthesia' })], {
      ...QUERY,
      specialtyKey: 'paediatrics',
    });
    expect(resolved?.specialtyKey).toBe(ANY_SPECIALTY);
  });
});

describe('resolveRateFloor and levels', () => {
  const registrar = { ...QUERY, cadreLevelKey: 'doctor.registrar' };

  it('applies a floor that names no level to every level, and to a request that names none', () => {
    expect(floor().cadreLevelKey ?? ANY_LEVEL).toBe(ANY_LEVEL);
    expect(resolveRateFloor([floor()], registrar)?.minHourlyKobo).toBe(650_000);
    expect(resolveRateFloor([floor()], QUERY)?.minHourlyKobo).toBe(650_000);
  });

  it('lets a floor for the request\'s level beat the one for every level', () => {
    const forEveryone = floor({ minHourlyKobo: 650_000 });
    const forRegistrars = floor({ cadreLevelKey: 'doctor.registrar', minHourlyKobo: 900_000 });

    expect(resolveRateFloor([forEveryone, forRegistrars], registrar)?.minHourlyKobo).toBe(900_000);
    expect(resolveRateFloor([forRegistrars, forEveryone], registrar)?.minHourlyKobo).toBe(900_000);
  });

  it('never applies a floor for another level', () => {
    const forConsultants = floor({ cadreLevelKey: 'doctor.consultant', minHourlyKobo: 1_500_000 });

    // Without the every-level floor there is none at all, which is a refusal, not a pass.
    expect(resolveRateFloor([forConsultants], registrar)).toBeNull();
    expect(resolveRateFloor([forConsultants], QUERY)).toBeNull();
  });

  it('prefers the level over the specialty when only one of them is named by each floor', () => {
    const forAnaesthesia = floor({ specialtyKey: 'anaesthesia', minHourlyKobo: 800_000 });
    const forRegistrars = floor({ cadreLevelKey: 'doctor.registrar', minHourlyKobo: 900_000 });

    const resolved = resolveRateFloor([forAnaesthesia, forRegistrars], { ...registrar, specialtyKey: 'anaesthesia' });

    expect(resolved?.minHourlyKobo).toBe(900_000);
  });

  it('prefers a floor naming both over one naming either', () => {
    const both = floor({ cadreLevelKey: 'doctor.registrar', specialtyKey: 'anaesthesia', minHourlyKobo: 1_100_000 });
    const level = floor({ cadreLevelKey: 'doctor.registrar', minHourlyKobo: 900_000 });
    const specialty = floor({ specialtyKey: 'anaesthesia', minHourlyKobo: 800_000 });

    const resolved = resolveRateFloor([specialty, level, both], { ...registrar, specialtyKey: 'anaesthesia' });

    expect(resolved?.minHourlyKobo).toBe(1_100_000);
  });

  it('prefers the newer of two floors for the same level', () => {
    const older = floor({ cadreLevelKey: 'doctor.registrar', minHourlyKobo: 900_000 });
    const newer = floor({
      cadreLevelKey: 'doctor.registrar',
      minHourlyKobo: 950_000,
      effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(resolveRateFloor([older, newer], registrar)?.minHourlyKobo).toBe(950_000);
  });
});

describe('checkAgainstFloor', () => {
  it('accepts a rate exactly at the floor', () => {
    // A floor is a minimum; refusing an offer that meets it exactly would
    // make the published number a lie.
    expect(checkAgainstFloor(650_000, floor())).toEqual({ ok: true, minHourlyKobo: 650_000 });
  });

  it('refuses one kobo below the floor', () => {
    // Step 6.1's verification, verbatim.
    expect(checkAgainstFloor(649_999, floor())).toEqual({ ok: false, minHourlyKobo: 650_000 });
  });

  it('refuses when no floor is published, and says there is none to name', () => {
    // RAT-01: a missing floor used to let any rate through, which is a wage
    // protection that silently does not exist for any profession nobody set one for.
    expect(checkAgainstFloor(1, null)).toEqual({ ok: false, minHourlyKobo: null });
    expect(checkAgainstFloor(100_000_000, null)).toEqual({ ok: false, minHourlyKobo: null });
  });
});

describe('shiftHours', () => {
  it('measures a night shift across midnight', () => {
    expect(
      shiftHours(new Date('2026-09-14T19:00:00Z'), new Date('2026-09-15T05:00:00Z')),
    ).toBe(10);
  });
});

describe('canTransition', () => {
  it('allows the ordinary path', () => {
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(true);
    expect(canTransition('PUBLISHED', 'FILLED')).toBe(true);
  });

  it('lets a filled request still be cancelled', () => {
    // A ward closing does not care that it found its nurses.
    expect(canTransition('FILLED', 'CANCELLED')).toBe(true);
  });

  it('never revives a closed request', () => {
    // Practitioners have already been told it is closed.
    expect(canTransition('CANCELLED', 'PUBLISHED')).toBe(false);
    expect(canTransition('EXPIRED', 'PUBLISHED')).toBe(false);
  });

  it('refuses to publish something already published', () => {
    expect(canTransition('PUBLISHED', 'PUBLISHED')).toBe(false);
  });
});

describe('publishBlockers', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  const ready = {
    status: 'DRAFT' as const,
    startsAt: SHIFT_AT,
    facilityCanPublish: true,
    rateMeetsFloor: true,
  };

  it('is empty when everything is in order', () => {
    expect(publishBlockers(ready, now)).toEqual([]);
  });

  it('refuses an unverified facility', () => {
    // Rule 5's counterpart for facilities, and the call Stage 5.10 built
    // canPublish for.
    expect(publishBlockers({ ...ready, facilityCanPublish: false }, now)).toContain(
      'facility_cannot_publish',
    );
  });

  it('refuses a below-floor rate', () => {
    expect(publishBlockers({ ...ready, rateMeetsFloor: false }, now)).toContain('below_rate_floor');
  });

  it('refuses a shift that has already started', () => {
    expect(publishBlockers({ ...ready, startsAt: new Date('2026-08-01T00:00:00Z') }, now)).toContain(
      'starts_in_the_past',
    );
  });

  it('refuses anything that is not a draft', () => {
    expect(publishBlockers({ ...ready, status: 'PUBLISHED' }, now)).toContain('not_a_draft');
  });

  it('reports every reason at once', () => {
    const hopeless = {
      status: 'CANCELLED' as const,
      startsAt: new Date('2026-08-01T00:00:00Z'),
      facilityCanPublish: false,
      rateMeetsFloor: false,
    };
    expect(publishBlockers(hopeless, now).sort()).toEqual(
      ['below_rate_floor', 'facility_cannot_publish', 'not_a_draft', 'starts_in_the_past'].sort(),
    );
  });
});

describe('a floor being set', () => {
  const today = new Date('2026-10-14T10:00:00.000Z');
  const ok = { minHourlyKobo: 650_000, effectiveFrom: '2026-10-14' };

  it('is accepted when it is a positive whole number of kobo and starts today or later', () => {
    expect(floorProblem(ok, today)).toBeNull();
    expect(floorProblem({ ...ok, effectiveFrom: '2027-01-01' }, today)).toBeNull();
  });

  it('is refused at zero, negative, fractional, or beyond any real hourly rate', () => {
    expect(floorProblem({ ...ok, minHourlyKobo: 0 }, today)).toBe('amount');
    expect(floorProblem({ ...ok, minHourlyKobo: -1 }, today)).toBe('amount');
    expect(floorProblem({ ...ok, minHourlyKobo: 650_000.5 }, today)).toBe('amount');
    expect(floorProblem({ ...ok, minHourlyKobo: MAX_FLOOR_HOURLY_KOBO + 1 }, today)).toBe('amount');
    expect(floorProblem({ ...ok, minHourlyKobo: MAX_FLOOR_HOURLY_KOBO }, today)).toBeNull();
  });

  it('is refused if it would start in the past: floors are versioned, not rewritten', () => {
    expect(floorProblem({ ...ok, effectiveFrom: '2026-10-13' }, today)).toBe('past');
  });

  it('counts today by Lagos, not UTC', () => {
    const justAfterMidnight = new Date('2026-10-14T23:30:00.000Z');

    expect(floorProblem({ ...ok, effectiveFrom: '2026-10-14' }, justAfterMidnight)).toBe('past');
    expect(floorProblem({ ...ok, effectiveFrom: '2026-10-15' }, justAfterMidnight)).toBeNull();
  });

  it('is refused if the date is not one', () => {
    expect(floorProblem({ ...ok, effectiveFrom: '14/10/2026' }, today)).toBe('date');
    expect(floorProblem({ ...ok, effectiveFrom: '2026-02-30' }, today)).toBe('date');
  });
});
