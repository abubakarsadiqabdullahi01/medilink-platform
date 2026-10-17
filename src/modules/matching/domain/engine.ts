/**
 * The matching engine: pure, no database.
 *
 * Step 6.3 requires results that are **reproducible and explainable**, and
 * neither survives a function that queries as it scores. Everything this
 * needs is passed in; everything it decides is returned, including why each
 * excluded candidate was excluded and what each factor contributed to the
 * ones that were not.
 */

export type ExclusionReason =
  | 'not_eligible'
  | 'category_mismatch'
  | 'specialty_mismatch'
  | 'level_mismatch'
  | 'supervision_required'
  | 'unavailable'
  | 'partly_available'
  | 'blocked'
  | 'already_assigned'
  | 'travel_preference';

export type ProximityTier = 'SAME_LGA' | 'SAME_STATE' | 'ELSEWHERE';
export type TravelPreferenceValue = 'SAME_LGA' | 'SAME_STATE' | 'ANYWHERE';
export type AvailabilityOutcome = 'available' | 'blocked' | 'not_offered' | 'partly_offered';

/**
 * Weights, out of 100. They are here rather than in a config table on
 * purpose: a ranking that changes because somebody edited a row is one that
 * cannot be explained after the fact, and 6.3's requirement is that the same
 * inputs always give the same ranking. Changing these is a code change, a
 * review and a new snapshot.
 */
export const WEIGHTS = {
  experience: 30,
  proximity: 35,
  fatigue: 20,
  reliability: 15,
} as const;

export const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);

/**
 * Beyond ten years, more experience is not more suitability for a single
 * shift. Uncapped, this factor would let a forty-year veteran outrank someone
 * next door who is rested and available, on a dimension that had stopped
 * meaning anything.
 */
export const EXPERIENCE_CAP_YEARS = 10;

/** Hours already committed in the preceding week at which fatigue scores zero. */
export const FATIGUE_CAP_HOURS = 48;

/**
 * How far before a shift's start an assignment still counts as hours already committed. The
 * caller reads the assignments; this is the window it reads them over, kept here beside the cap
 * so that what `docs/matching-rules.md` says about rest comes from one place.
 */
export const FATIGUE_WINDOW_HOURS = 7 * 24;

/** Completed assignments before a reliability score is trusted (step 6.4). */
export const COLD_START_ASSIGNMENTS = 5;

/**
 * What a practitioner in cold start scores on reliability.
 *
 * The midpoint, not zero and not one: no history is not evidence of
 * unreliability, and it is not evidence of reliability either. Step 6.4 asks
 * for exactly this — "neutral reliability until five completed assignments"
 * — and the test that matters is that a newcomer and a proven-average
 * practitioner rank identically on this factor.
 */
export const NEUTRAL_RELIABILITY = 0.5;

const PROXIMITY_SCORE: Record<ProximityTier, number> = {
  SAME_LGA: 1,
  SAME_STATE: 0.6,
  ELSEWHERE: 0.2,
};

export interface RequestInput {
  professionalCategoryId: string;
  /** When set, a candidate holding a different specialty is excluded. */
  specialtyId: string | null;
  /**
   * When set, only somebody recorded at exactly this level is offered it (REQ-01). The
   * profession's cadre is mandatory, not a preference, and nobody is assumed to be at
   * a level nobody has recorded for them.
   */
  cadreLevelId?: string | null;
  /** Whether somebody is there to supervise. A supervised practitioner can be offered only a shift that says so. */
  supervisionAvailable?: boolean;
}

export interface CandidateInput {
  userId: string;
  professionalCategoryId: string;
  specialtyId: string | null;
  /** The level an officer recorded against their registration; null when none has been. */
  cadreLevelId?: string | null;
  /** Whether their registration category says they work under supervision. */
  supervised?: boolean;
  yearsOfExperience: number;
  proximity: ProximityTier;
  travelPreference: TravelPreferenceValue;
  eligible: boolean;
  availability: AvailabilityOutcome;
  hasConflictingAssignment: boolean;
  /** Hours already confirmed in the week before this shift. */
  hoursAssignedInWindow: number;
  completedAssignments: number;
  /** 0–1, or null when there is no history to score. */
  reliabilityScore: number | null;
}

export interface FactorContribution {
  factor: keyof typeof WEIGHTS;
  weight: number;
  /** 0–1, before weighting. */
  raw: number;
  points: number;
  /** Why this factor scored what it did, in words a person can read. */
  detail: string;
}

export interface RankedCandidate {
  userId: string;
  rank: number;
  /** 0–100. */
  score: number;
  factors: FactorContribution[];
}

export interface ExcludedCandidate {
  userId: string;
  reasons: ExclusionReason[];
}

export interface MatchResult {
  ranked: RankedCandidate[];
  excluded: ExcludedCandidate[];
}

/**
 * Every reason a candidate is out, not just the first — the same courtesy the
 * eligibility rule and the publish check already extend. An operations
 * officer asking "why did nobody match?" wants the whole picture.
 */
export function exclusionsFor(
  request: RequestInput,
  candidate: CandidateInput,
): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];

  // The Stage 5 invariant, called rather than restated. Rule 5 of the README
  // lives in one function and this is the code path that consumes it.
  if (!candidate.eligible) reasons.push('not_eligible');

  if (candidate.professionalCategoryId !== request.professionalCategoryId) {
    reasons.push('category_mismatch');
  }

  // A specialty on the request is a requirement, not a preference: asking for
  // an anaesthetist and being sent a generalist is a clinical failure, not a
  // near miss.
  if (request.specialtyId && candidate.specialtyId !== request.specialtyId) {
    reasons.push('specialty_mismatch');
  }

  // Same standing as the specialty: asking for a registrar and being sent a house
  // officer is a clinical failure, whatever they would accept to be paid.
  if (request.cadreLevelId && candidate.cadreLevelId !== request.cadreLevelId) {
    reasons.push('level_mismatch');
  }

  // Somebody on a provisional register is not offered a shift with nobody to
  // supervise them, however well they would otherwise score.
  if (candidate.supervised && !request.supervisionAvailable) {
    reasons.push('supervision_required');
  }

  if (candidate.availability === 'blocked') reasons.push('blocked');
  else if (candidate.availability === 'not_offered') reasons.push('unavailable');
  else if (candidate.availability === 'partly_offered') reasons.push('partly_available');

  if (candidate.hasConflictingAssignment) reasons.push('already_assigned');

  if (
    (candidate.travelPreference === 'SAME_LGA' && candidate.proximity !== 'SAME_LGA') ||
    (candidate.travelPreference === 'SAME_STATE' && candidate.proximity === 'ELSEWHERE')
  ) {
    reasons.push('travel_preference');
  }

  return reasons;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Rounded to two places so a score is stable across platforms and readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function scoreCandidate(candidate: CandidateInput): FactorContribution[] {
  const cappedYears = Math.min(candidate.yearsOfExperience, EXPERIENCE_CAP_YEARS);
  const experienceRaw = clamp01(cappedYears / EXPERIENCE_CAP_YEARS);

  const proximityRaw = PROXIMITY_SCORE[candidate.proximity];

  const fatigueRaw = clamp01(
    1 - Math.min(candidate.hoursAssignedInWindow, FATIGUE_CAP_HOURS) / FATIGUE_CAP_HOURS,
  );

  const inColdStart = candidate.completedAssignments < COLD_START_ASSIGNMENTS;
  const reliabilityRaw = inColdStart
    ? NEUTRAL_RELIABILITY
    : clamp01(candidate.reliabilityScore ?? NEUTRAL_RELIABILITY);

  return [
    {
      factor: 'experience',
      weight: WEIGHTS.experience,
      raw: round(experienceRaw),
      points: round(experienceRaw * WEIGHTS.experience),
      detail: `${candidate.yearsOfExperience} years, capped at ${EXPERIENCE_CAP_YEARS}`,
    },
    {
      factor: 'proximity',
      weight: WEIGHTS.proximity,
      raw: round(proximityRaw),
      points: round(proximityRaw * WEIGHTS.proximity),
      detail: candidate.proximity.toLowerCase().replace('_', ' '),
    },
    {
      factor: 'fatigue',
      weight: WEIGHTS.fatigue,
      raw: round(fatigueRaw),
      points: round(fatigueRaw * WEIGHTS.fatigue),
      detail: `${candidate.hoursAssignedInWindow} hours already committed this week`,
    },
    {
      factor: 'reliability',
      weight: WEIGHTS.reliability,
      raw: round(reliabilityRaw),
      points: round(reliabilityRaw * WEIGHTS.reliability),
      detail: inColdStart
        ? `neutral: ${candidate.completedAssignments} of ${COLD_START_ASSIGNMENTS} assignments completed`
        : `${candidate.completedAssignments} assignments completed`,
    },
  ];
}

/**
 * Ranks the candidates who survive the filters, and reports the rest.
 *
 * Ties break on user id, ascending. Without an explicit tiebreak two equally
 * scored candidates could order differently between runs — which is precisely
 * what "reproducible" rules out, and what the snapshot test would catch only
 * intermittently.
 */
export function match(request: RequestInput, candidates: CandidateInput[]): MatchResult {
  const ranked: Omit<RankedCandidate, 'rank'>[] = [];
  const excluded: ExcludedCandidate[] = [];

  for (const candidate of candidates) {
    const reasons = exclusionsFor(request, candidate);
    if (reasons.length > 0) {
      excluded.push({ userId: candidate.userId, reasons });
      continue;
    }

    const factors = scoreCandidate(candidate);
    const score = round(factors.reduce((sum, factor) => sum + factor.points, 0));
    ranked.push({ userId: candidate.userId, score, factors });
  }

  ranked.sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  excluded.sort((a, b) => a.userId.localeCompare(b.userId));

  return {
    ranked: ranked.map((candidate, index) => ({ ...candidate, rank: index + 1 })),
    excluded,
  };
}

/**
 * Where a facility sits relative to a practitioner's home, in the tiers this
 * engine scores. A proxy for distance until something in the schema holds
 * coordinates; replacing it means replacing this one function.
 */
export function proximityTier(input: {
  facilityStateId: string;
  facilityLgaId: string | null;
  homeStateId: string | null;
  homeLgaId: string | null;
}): ProximityTier {
  if (input.facilityLgaId && input.homeLgaId && input.facilityLgaId === input.homeLgaId) {
    return 'SAME_LGA';
  }
  if (input.homeStateId && input.facilityStateId === input.homeStateId) return 'SAME_STATE';
  // A practitioner who has told us nothing about where they live is treated
  // as far away rather than near: a guess in their favour would put them in
  // front of somebody who actually is nearby.
  return 'ELSEWHERE';
}
