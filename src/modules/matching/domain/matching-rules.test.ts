// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COLD_START_ASSIGNMENTS,
  EXPERIENCE_CAP_YEARS,
  FATIGUE_CAP_HOURS,
  FATIGUE_WINDOW_HOURS,
  NEUTRAL_RELIABILITY,
  TOTAL_WEIGHT,
  WEIGHTS,
  exclusionsFor,
  match,
  proximityTier,
  scoreCandidate,
  type CandidateInput,
  type ExclusionReason,
  type RequestInput,
} from './engine';
import { reliabilityFrom } from './reliability';
import { EXCLUSION_RULES, EXCLUSION_WORDS, clearCandidate, renderMatchingRules } from './matching-rules';

/**
 * M07-03: how matching ranks and excludes people, written down once and held to the engine.
 *
 * The document is for the people who answer "why was nobody offered this shift?". The risk with
 * a document like that is that it is right on the day and wrong a month later, so each sentence
 * in it is either read from the engine when it is rendered or proved here by running the engine.
 * The older description of matching (`docs/stage-6-3-6-4-matching.md`) listed seven reasons for
 * exclusion when the code gave nine, and that is the failure this exists to prevent.
 */

const ROOT = join(__dirname, '../../../..');
const REQUEST: RequestInput = { professionalCategoryId: 'category', specialtyId: null };
const rawOf = (candidate: CandidateInput, factor: keyof typeof WEIGHTS) =>
  scoreCandidate(candidate).find((row) => row.factor === factor)!.raw;
const pointsOf = (candidate: CandidateInput, factor: keyof typeof WEIGHTS) =>
  scoreCandidate(candidate).find((row) => row.factor === factor)!.points;

describe('the page', () => {
  it('is the one the code renders, so neither can change without the other', () => {
    const onDisk = readFileSync(join(ROOT, 'docs/matching-rules.md'), 'utf8');
    expect(onDisk).toBe(renderMatchingRules());
  });

  it('says every weight and that they add up to one hundred', () => {
    const page = renderMatchingRules();
    for (const [factor, weight] of Object.entries(WEIGHTS)) {
      expect(page).toContain(`| \`${factor}\` | ${weight} |`);
    }
    expect(TOTAL_WEIGHT).toBe(100);
    expect(page).toContain(`**${TOTAL_WEIGHT}**`);
  });

  it('has exactly the four factors the engine scores', () => {
    expect(scoreCandidate(clearCandidate()).map((row) => row.factor)).toEqual(Object.keys(WEIGHTS));
  });
});

describe('the reasons for exclusion', () => {
  /** One candidate, and the request, that fails the filter named and none of the others. */
  const ONLY: Record<ExclusionReason, { request?: Partial<RequestInput>; candidate: Partial<CandidateInput> }> = {
    category_mismatch: { candidate: { professionalCategoryId: 'another' } },
    specialty_mismatch: { request: { specialtyId: 'anaesthetics' }, candidate: { specialtyId: 'general' } },
    level_mismatch: { request: { cadreLevelId: 'registrar' }, candidate: { cadreLevelId: 'house-officer' } },
    supervision_required: { request: { supervisionAvailable: false }, candidate: { supervised: true } },
    not_eligible: { candidate: { eligible: false } },
    unavailable: { candidate: { availability: 'not_offered' } },
    partly_available: { candidate: { availability: 'partly_offered' } },
    blocked: { candidate: { availability: 'blocked' } },
    already_assigned: { candidate: { hasConflictingAssignment: true } },
    travel_preference: { candidate: { travelPreference: 'SAME_LGA', proximity: 'SAME_STATE' } },
  };

  it.each(Object.keys(ONLY) as ExclusionReason[])('%s is a rule the engine applies, and applies on its own', (reason) => {
    const { request, candidate } = ONLY[reason];
    expect(exclusionsFor({ ...REQUEST, ...request }, clearCandidate(candidate))).toEqual([reason]);
  });

  it('is described once for each, in the page', () => {
    const page = renderMatchingRules();
    const reasons = Object.keys(EXCLUSION_RULES);
    expect(reasons.sort()).toEqual(Object.keys(ONLY).sort());
    for (const reason of reasons) {
      const rows = page.split('\n').filter((line) => line.startsWith(`| \`${reason}\` |`));
      expect(rows, reason).toHaveLength(1);
    }
  });

  it('are all reported for one person, not only the first', () => {
    const everything = exclusionsFor(
      { ...REQUEST, specialtyId: 'anaesthetics', cadreLevelId: 'registrar', supervisionAvailable: false },
      clearCandidate({
        professionalCategoryId: 'another',
        specialtyId: 'general',
        cadreLevelId: 'house-officer',
        supervised: true,
        eligible: false,
        availability: 'blocked',
        hasConflictingAssignment: true,
        travelPreference: 'SAME_LGA',
        proximity: 'ELSEWHERE',
      }),
    );
    // One availability verdict is passed in, so only one of blocked, unavailable and partly
    // available can be reported for somebody.
    expect(everything.sort()).toEqual(
      Object.keys(ONLY)
        .filter((reason) => reason !== 'unavailable' && reason !== 'partly_available')
        .sort(),
    );
  });

  it('treats a request that names no specialty or level as accepting any', () => {
    expect(exclusionsFor(REQUEST, clearCandidate({ specialtyId: 'anything', cadreLevelId: 'anything' }))).toEqual([]);
  });

  it('treats somebody with no recorded level as not at the level asked for', () => {
    expect(exclusionsFor({ ...REQUEST, cadreLevelId: 'registrar' }, clearCandidate({ cadreLevelId: null }))).toEqual([
      'level_mismatch',
    ]);
  });

  it('never excludes on travel when the practitioner will go anywhere, and reads the state-only preference', () => {
    expect(exclusionsFor(REQUEST, clearCandidate({ travelPreference: 'ANYWHERE', proximity: 'ELSEWHERE' }))).toEqual([]);
    expect(exclusionsFor(REQUEST, clearCandidate({ travelPreference: 'SAME_STATE', proximity: 'ELSEWHERE' }))).toEqual([
      'travel_preference',
    ]);
    expect(exclusionsFor(REQUEST, clearCandidate({ travelPreference: 'SAME_STATE', proximity: 'SAME_STATE' }))).toEqual([]);
  });

  it('reports blocked, not unavailable, for somebody who is both', () => {
    // One availability verdict is passed in, and it is `blocked` ahead of `not_offered`:
    // availability.test.ts holds the order; the engine reports whichever it is given.
    expect(exclusionsFor(REQUEST, clearCandidate({ availability: 'blocked' }))).toEqual(['blocked']);
  });
});

describe('the words a facility is given for each reason', () => {
  const reasons = Object.keys(EXCLUSION_RULES) as ExclusionReason[];

  it('are there for every reason, as a short name and a sentence', () => {
    expect(Object.keys(EXCLUSION_WORDS).sort()).toEqual([...reasons].sort());
    for (const reason of reasons) {
      const { label, says } = EXCLUSION_WORDS[reason];
      expect(label.length, reason).toBeGreaterThan(2);
      expect(label.length, `${reason}: a name fits in a badge`).toBeLessThanOrEqual(32);
      expect(says.length, reason).toBeGreaterThan(25);
      expect(says.endsWith('.'), `${reason}: end the sentence`).toBe(true);
    }
  });

  it('give each reason its own name, so two badges never read alike', () => {
    const labels = reasons.map((reason) => EXCLUSION_WORDS[reason].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('tell the three availability reasons apart in words a ward manager would use', () => {
    expect(EXCLUSION_WORDS.blocked.label).toMatch(/unavailable|blocked/i);
    expect(EXCLUSION_WORDS.unavailable.says).toMatch(/not offered|has not offered|no availability/i);
    expect(EXCLUSION_WORDS.partly_available.says).toMatch(/part of the shift/i);
    expect(EXCLUSION_WORDS.partly_available.says).toMatch(/shorten|split/i);
  });

  it('keep a practitioner’s private routine out of what a facility reads', () => {
    // A block is leave, training or whatever the person did not want to say, and a facility is
    // told only that the time was marked unavailable, never what for or which days they work.
    for (const reason of ['blocked', 'unavailable', 'partly_available'] as const) {
      expect(EXCLUSION_WORDS[reason].says, reason).not.toMatch(
        /leave|training|away|sick|ill\b|holiday|family|funeral|church|mosque|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i,
      );
    }
  });

  it('are on the page, beside each reason', () => {
    const page = renderMatchingRules();
    for (const reason of reasons) {
      expect(page, reason).toContain(EXCLUSION_WORDS[reason].label);
    }
  });
});

describe('the factors', () => {
  it('count experience up to the cap and no further', () => {
    expect(rawOf(clearCandidate({ yearsOfExperience: 0 }), 'experience')).toBe(0);
    expect(rawOf(clearCandidate({ yearsOfExperience: EXPERIENCE_CAP_YEARS / 2 }), 'experience')).toBe(0.5);
    expect(rawOf(clearCandidate({ yearsOfExperience: EXPERIENCE_CAP_YEARS }), 'experience')).toBe(1);
    expect(rawOf(clearCandidate({ yearsOfExperience: 40 }), 'experience')).toBe(1);
  });

  it('score nearness in three steps, and somebody who has not said where they live is far away', () => {
    expect(rawOf(clearCandidate({ proximity: 'SAME_LGA' }), 'proximity')).toBe(1);
    expect(rawOf(clearCandidate({ proximity: 'SAME_STATE' }), 'proximity')).toBe(0.6);
    expect(rawOf(clearCandidate({ proximity: 'ELSEWHERE' }), 'proximity')).toBe(0.2);
    expect(
      proximityTier({ facilityStateId: 's1', facilityLgaId: 'l1', homeStateId: null, homeLgaId: null }),
    ).toBe('ELSEWHERE');
  });

  it('score rest from full to nothing in a straight line over the weekly cap', () => {
    expect(rawOf(clearCandidate({ hoursAssignedInWindow: 0 }), 'fatigue')).toBe(1);
    expect(rawOf(clearCandidate({ hoursAssignedInWindow: FATIGUE_CAP_HOURS / 2 }), 'fatigue')).toBe(0.5);
    expect(rawOf(clearCandidate({ hoursAssignedInWindow: FATIGUE_CAP_HOURS }), 'fatigue')).toBe(0);
    expect(rawOf(clearCandidate({ hoursAssignedInWindow: FATIGUE_CAP_HOURS + 30 }), 'fatigue')).toBe(0);
  });

  it('look back seven days for the hours, the window the page states', () => {
    expect(FATIGUE_WINDOW_HOURS).toBe(7 * 24);
  });

  it('give everybody the middle score on reliability until enough shifts are completed', () => {
    for (const reliabilityScore of [0, 0.2, 1, null]) {
      expect(
        rawOf(clearCandidate({ completedAssignments: COLD_START_ASSIGNMENTS - 1, reliabilityScore }), 'reliability'),
      ).toBe(NEUTRAL_RELIABILITY);
    }
    expect(rawOf(clearCandidate({ completedAssignments: COLD_START_ASSIGNMENTS, reliabilityScore: 0.8 }), 'reliability')).toBe(0.8);
  });

  it('take reliability from decided shifts only, so an excusal or a cancellation cannot lower it', () => {
    expect(reliabilityFrom({ completed: 0, noShow: 0 })).toBeNull();
    expect(reliabilityFrom({ completed: 9, noShow: 1 })).toBe(0.9);
    expect(reliabilityFrom({ completed: 5, noShow: 0 })).toBe(1);
  });
});

describe('the order', () => {
  const ids = (candidates: CandidateInput[]) => match(REQUEST, candidates).ranked.map((row) => row.userId);

  it('is by score, highest first, with ranks that run 1, 2, 3 and leave no gaps', () => {
    const result = match(REQUEST, [
      clearCandidate({ userId: 'low', proximity: 'ELSEWHERE' }),
      clearCandidate({ userId: 'high', proximity: 'SAME_LGA' }),
      clearCandidate({ userId: 'mid', proximity: 'SAME_STATE' }),
    ]);
    expect(result.ranked.map((row) => [row.userId, row.rank])).toEqual([
      ['high', 1],
      ['mid', 2],
      ['low', 3],
    ]);
  });

  it('breaks a tie on the lower user id, whatever order the people arrive in', () => {
    const a = clearCandidate({ userId: 'a-1', yearsOfExperience: 5 });
    const b = clearCandidate({ userId: 'b-2', yearsOfExperience: 5 });
    expect(ids([a, b])).toEqual(['a-1', 'b-2']);
    expect(ids([b, a])).toEqual(['a-1', 'b-2']);
  });

  it('rounds before it compares, so scores equal to two places are tied and the lower id wins', () => {
    // 10 and 10.001 hours are a different score before rounding and the same score after it. The
    // lower id has the more tired of the two, so it comes first only if the tie is real.
    const tired = clearCandidate({ userId: 'a-1', hoursAssignedInWindow: 10.001 });
    const rested = clearCandidate({ userId: 'b-2', hoursAssignedInWindow: 10 });
    expect(pointsOf(tired, 'fatigue')).toBe(pointsOf(rested, 'fatigue'));
    expect(ids([rested, tired])).toEqual(['a-1', 'b-2']);
  });

  it('lists the people left out in user id order', () => {
    const result = match(REQUEST, [
      clearCandidate({ userId: 'c-3', eligible: false }),
      clearCandidate({ userId: 'a-1', eligible: false }),
      clearCandidate({ userId: 'b-2', eligible: false }),
    ]);
    expect(result.excluded.map((row) => row.userId)).toEqual(['a-1', 'b-2', 'c-3']);
  });
});

describe('the worked example on the page', () => {
  it('ranks as the page says, ties and exclusion included', () => {
    const page = renderMatchingRules();
    expect(page).toMatch(/\| 1 \| A \|/);
    expect(page).toMatch(/\| 2 \| D \|/);
    expect(page).toMatch(/\| 3 \| E \|/);
    expect(page).toMatch(/\| 4 \| B \|/);
    expect(page).toMatch(/\| 5 \| C \|/);
    expect(page).toContain('- F: `not_eligible`, `blocked`');
    expect(page).toContain('D and E are tied on');
    expect(page).toMatch(/C has the most experience and the best record of anybody ranked and still comes last/);
  });
});

describe('what the page says about when a match runs', () => {
  /** Every file under src that is code, so a caller cannot hide in a place nobody looked. */
  function sources(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
    });
  }

  it('is only when somebody asks: the one place that calls the match is its route', () => {
    const callers = sources(join(ROOT, 'src'))
      .filter((path) => /\brunMatch\(/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(ROOT.length + 1))
      // The definition itself.
      .filter((path) => path !== 'src/modules/matching/application/match.ts');
    expect(callers).toEqual(['src/app/api/v1/service-requests/[id]/match/route.ts']);
  });
});
