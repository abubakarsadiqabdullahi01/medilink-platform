/**
 * How matching ranks and excludes people, written down once (M07-03).
 *
 * The engine is what decides. This is what it says about itself, for the people who answer
 * "why was nobody offered this shift?" and "why did she rank above him?", who should not have to
 * read TypeScript. Every number below is read from the engine when the document is rendered, and
 * every sentence that is not a number is held to the engine by `matching-rules.test.ts`, which
 * also fails when `docs/matching-rules.md` and this file differ. Change a rule in the engine, say
 * so here, and run `pnpm tsx scripts/render-matching-rules.ts`.
 */
import {
  COLD_START_ASSIGNMENTS,
  EXPERIENCE_CAP_YEARS,
  FATIGUE_CAP_HOURS,
  FATIGUE_WINDOW_HOURS,
  NEUTRAL_RELIABILITY,
  TOTAL_WEIGHT,
  WEIGHTS,
  match,
  scoreCandidate,
  type CandidateInput,
  type ExclusionReason,
  type ProximityTier,
  type RequestInput,
} from './engine';

type Factor = keyof typeof WEIGHTS;

export interface ExclusionRule {
  /** What it concerns, so the table reads in groups. */
  about: 'the shift' | 'the person' | 'their time' | 'their wishes';
  /** When it applies, in words a person can read. */
  rule: string;
}

/**
 * Every reason the engine can give. Keyed on the engine's own type, so a reason added there and
 * not described here is a compile error, and `matching-rules.test.ts` proves that each description
 * is a rule the engine really applies, and applies on its own.
 */
export const EXCLUSION_RULES: Record<ExclusionReason, ExclusionRule> = {
  not_eligible: {
    about: 'the person',
    rule: 'They do not pass the eligibility rule: an account that can be used, a profile, a verified identity that matches their name, an active registration checked recently enough, every credential the profession requires, and a clear screening. The rule is one function, `isEligibleForMatching`, called here and not restated.',
  },
  category_mismatch: {
    about: 'the shift',
    rule: 'Their profession is not the one the request asks for. The pool is already limited to the request’s profession, so this is a second check behind that filter.',
  },
  specialty_mismatch: {
    about: 'the shift',
    rule: 'The request names a specialty and theirs is different or not recorded. A request that names none accepts any.',
  },
  level_mismatch: {
    about: 'the shift',
    rule: 'The request names a level and the level recorded against their registration is different, or none has been recorded. Nobody is assumed to be at a level nobody recorded for them. A request that names none accepts any.',
  },
  supervision_required: {
    about: 'the shift',
    rule: 'Their registration category says they work under supervision and the shift does not say anybody is there to supervise them.',
  },
  unavailable: {
    about: 'their time',
    rule: 'None of the availability they set touches the shift, or they have offered none. A slot that ends the moment the shift starts offers none of it.',
  },
  partly_available: {
    about: 'their time',
    rule: 'What they offered covers part of the shift but no stretch of it covers the whole, from its start to its end: half a night shift is not a night shift. Told apart from `unavailable` because it is the one a facility can do something about, by shortening or splitting the shift.',
  },
  blocked: {
    about: 'their time',
    rule: 'A period they blocked (leave, training, away) overlaps any part of the shift. This is checked before availability, so somebody who is blocked and has also offered nothing is reported as blocked, not unavailable.',
  },
  already_assigned: {
    about: 'their time',
    rule: 'They hold a confirmed assignment that overlaps any part of the shift. A cancelled one does not count.',
  },
  travel_preference: {
    about: 'their wishes',
    rule: 'Their own travel preference rules the shift out: “same local government area” and the facility is in another, or “same state” and the facility is in another state. “Anywhere” never excludes.',
  },
};

/**
 * What a facility is told for each reason: a short name for a badge and one sentence, in words a
 * ward manager would use. It is the audience that matters. A facility is told why its pool is
 * thin and never whose diary it is, so the words for the three availability reasons say that
 * the time was marked unavailable, offered not at all or offered in part, and never what for or
 * which days somebody works. `matching-rules.test.ts` holds both to that.
 */
export const EXCLUSION_WORDS: Record<ExclusionReason, { label: string; says: string }> = {
  category_mismatch: {
    label: 'Other profession',
    says: 'Registered in a different profession from the one this shift asks for.',
  },
  specialty_mismatch: {
    label: 'Different specialty',
    says: 'Does not hold the specialty this shift asks for.',
  },
  level_mismatch: {
    label: 'Different level',
    says: 'Is not recorded at the level this shift asks for.',
  },
  supervision_required: {
    label: 'Needs supervision',
    says: 'Works under supervision, and this shift does not say anybody is there to supervise them.',
  },
  not_eligible: {
    label: 'Not yet cleared',
    says: 'Has not finished what Medilink needs before somebody can be offered work, such as a checked licence or identity.',
  },
  unavailable: {
    label: 'Not offering this time',
    says: 'Has not offered any of this shift as time they can work.',
  },
  partly_available: {
    label: 'Free for part of it',
    says: 'Has offered part of the shift but not all of it, so shortening or splitting the shift would bring them in.',
  },
  blocked: {
    label: 'Marked unavailable',
    says: 'Has marked this time as unavailable. Medilink does not show why.',
  },
  already_assigned: {
    label: 'Already booked',
    says: 'Is already confirmed on another shift at this time.',
  },
  travel_preference: {
    label: 'Prefers to stay closer',
    says: 'Has said they only work close to home, and this facility is further than that.',
  },
};

/** The order the table is read in: what a request asks for first, then the person, their time, their wishes. */
const EXCLUSION_ORDER: ExclusionReason[] = [
  'category_mismatch',
  'specialty_mismatch',
  'level_mismatch',
  'supervision_required',
  'not_eligible',
  'unavailable',
  'partly_available',
  'blocked',
  'already_assigned',
  'travel_preference',
];

export const FACTOR_TITLES: Record<Factor, string> = {
  experience: 'Experience',
  proximity: 'Nearness',
  fatigue: 'Rest',
  reliability: 'Reliability',
};

const TIERS: { tier: ProximityTier; says: string }[] = [
  { tier: 'SAME_LGA', says: 'their home is in the same local government area as the facility' },
  { tier: 'SAME_STATE', says: 'their home is in the same state' },
  { tier: 'ELSEWHERE', says: 'their home is in another state, or they have not said where they live' },
];

/** A candidate who passes every filter, to be changed one thing at a time. */
export function clearCandidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    userId: 'candidate',
    professionalCategoryId: 'category',
    specialtyId: null,
    cadreLevelId: null,
    supervised: false,
    yearsOfExperience: 0,
    proximity: 'SAME_LGA',
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

const rawOf = (factor: Factor, candidate: CandidateInput) =>
  scoreCandidate(candidate).find((row) => row.factor === factor)!.raw;

const num = (value: number) => String(Math.round(value * 100) / 100);

function weightsTable(): string {
  const rows = (Object.keys(WEIGHTS) as Factor[]).map(
    (factor) => `| ${FACTOR_TITLES[factor]} | \`${factor}\` | ${WEIGHTS[factor]} |`,
  );
  return ['| Factor | Recorded as | Points available |', '| --- | --- | --- |', ...rows, `| **Total** | | **${TOTAL_WEIGHT}** |`].join('\n');
}

function factorSections(): string {
  const experience = [0, 2, 5, EXPERIENCE_CAP_YEARS, 25].map(
    (years) => `${years} year${years === 1 ? '' : 's'} scores ${num(rawOf('experience', clearCandidate({ yearsOfExperience: years })))}`,
  );
  const tiers = TIERS.map(
    ({ tier, says }) => `- ${says}: **${num(rawOf('proximity', clearCandidate({ proximity: tier })))}**`,
  );
  const fatigue = [0, FATIGUE_CAP_HOURS / 4, FATIGUE_CAP_HOURS / 2, FATIGUE_CAP_HOURS, FATIGUE_CAP_HOURS + 20].map(
    (hours) => `${hours} hours scores ${num(rawOf('fatigue', clearCandidate({ hoursAssignedInWindow: hours })))}`,
  );
  const settled = COLD_START_ASSIGNMENTS;
  const reliable = [0.5, 0.8, 1].map(
    (share) => `a completed share of ${num(share)} scores ${num(rawOf('reliability', clearCandidate({ completedAssignments: settled, reliabilityScore: share })))}`,
  );

  return [
    `### ${FACTOR_TITLES.experience} (${WEIGHTS.experience} points)`,
    '',
    `The years of experience on their profile, counted up to ${EXPERIENCE_CAP_YEARS} and no further, as a share of ${EXPERIENCE_CAP_YEARS}. More than ${EXPERIENCE_CAP_YEARS} years does not make somebody more suitable for one shift, and left uncapped it would put a veteran far away ahead of somebody next door who is rested and free. ${experience.join('; ')}.`,
    '',
    `### ${FACTOR_TITLES.proximity} (${WEIGHTS.proximity} points)`,
    '',
    'Where the facility is relative to the practitioner’s home, in three steps, because nothing in the system holds a distance:',
    '',
    ...tiers,
    '',
    'Somebody who has not said where they live counts as far away. A guess in their favour would put them ahead of somebody who is nearby.',
    '',
    `### ${FACTOR_TITLES.fatigue} (${WEIGHTS.fatigue} points)`,
    '',
    `The hours of assignments that are still confirmed and start in the ${FATIGUE_WINDOW_HOURS / 24} days before this shift starts, each counted in full. None is full marks, ${FATIGUE_CAP_HOURS} or more is nothing, and it falls in a straight line between. ${fatigue.join('; ')}. A shift already worked and approved is marked completed and is **not counted today**, and neither is a cancelled one or an offer not yet accepted, so for a shift at short notice this factor can flatter somebody who has just worked a heavy week.`,
    '',
    `### ${FACTOR_TITLES.reliability} (${WEIGHTS.reliability} points)`,
    '',
    `The share of their decided shifts that they worked: shifts completed, divided by shifts completed plus shifts they did not honour where a person decided the fault was theirs. An excused absence, a shift the facility cancelled and one still to be worked are in neither number, so an excusal can never lower the score. Until ${COLD_START_ASSIGNMENTS} assignments are completed everybody scores ${num(NEUTRAL_RELIABILITY)}, in the middle: no history is not evidence of unreliability, and a newcomer and an average practitioner rank alike on this factor. After that, ${reliable.join('; ')}.`,
  ].join('\n');
}

/** Candidates for the worked example; the document shows what the engine does with them. */
const EXAMPLE_REQUEST: RequestInput = { professionalCategoryId: 'category', specialtyId: null };
const EXAMPLE_CANDIDATES: { name: string; candidate: CandidateInput; note: string }[] = [
  {
    name: 'A',
    note: '8 years, same local government area, 12 hours committed this week, 9 of the 10 shifts decided were worked',
    candidate: clearCandidate({
      userId: 'A',
      yearsOfExperience: 8,
      proximity: 'SAME_LGA',
      hoursAssignedInWindow: 12,
      completedAssignments: 9,
      reliabilityScore: 0.9,
    }),
  },
  {
    name: 'B',
    note: '3 years, same state, nothing committed, a newcomer with 2 shifts done',
    candidate: clearCandidate({
      userId: 'B',
      yearsOfExperience: 3,
      proximity: 'SAME_STATE',
      hoursAssignedInWindow: 0,
      completedAssignments: 2,
      reliabilityScore: 1,
    }),
  },
  {
    name: 'C',
    note: '12 years, another state, 40 hours committed, 20 shifts done and all worked',
    candidate: clearCandidate({
      userId: 'C',
      yearsOfExperience: 12,
      proximity: 'ELSEWHERE',
      hoursAssignedInWindow: 40,
      completedAssignments: 20,
      reliabilityScore: 1,
    }),
  },
  {
    name: 'D',
    note: 'identical to E in everything the engine looks at',
    candidate: clearCandidate({ userId: 'D', yearsOfExperience: 5, proximity: 'SAME_STATE' }),
  },
  {
    name: 'E',
    note: 'identical to D in everything the engine looks at',
    candidate: clearCandidate({ userId: 'E', yearsOfExperience: 5, proximity: 'SAME_STATE' }),
  },
  {
    name: 'F',
    note: 'not yet through eligibility, and blocked on that day',
    candidate: clearCandidate({ userId: 'F', eligible: false, availability: 'blocked' }),
  },
];

/** What the example shows, written from its own result so the sentences cannot be wrong about it. */
function exampleNotes(): string {
  const result = match(
    EXAMPLE_REQUEST,
    EXAMPLE_CANDIDATES.map((row) => row.candidate),
  );
  const notes: string[] = [];

  for (let index = 1; index < result.ranked.length; index += 1) {
    const before = result.ranked[index - 1]!;
    const after = result.ranked[index]!;
    if (before.score === after.score) {
      notes.push(`${before.userId} and ${after.userId} are tied on ${num(before.score)}, so ${before.userId}, the lower id, is ranked first.`);
    }
  }

  const points = (userId: string, factor: Factor) =>
    result.ranked.find((row) => row.userId === userId)!.factors.find((row) => row.factor === factor)!.points;
  const last = result.ranked[result.ranked.length - 1]!;
  const bestExperience = Math.max(...result.ranked.map((row) => points(row.userId, 'experience')));
  const bestReliability = Math.max(...result.ranked.map((row) => points(row.userId, 'reliability')));
  if (points(last.userId, 'experience') === bestExperience && points(last.userId, 'reliability') === bestReliability) {
    notes.push(
      `${last.userId} has the most experience and the best record of anybody ranked and still comes last, because nearness and rest carry ${WEIGHTS.proximity + WEIGHTS.fatigue} of the ${TOTAL_WEIGHT} points.`,
    );
  }

  return notes.join(' ');
}

function workedExample(): string {
  const result = match(
    EXAMPLE_REQUEST,
    EXAMPLE_CANDIDATES.map((row) => row.candidate),
  );
  const pointsOf = (userId: string, factor: Factor) =>
    num(result.ranked.find((row) => row.userId === userId)!.factors.find((row) => row.factor === factor)!.points);

  const ranked = result.ranked.map(
    (row) =>
      `| ${row.rank} | ${row.userId} | ${(['experience', 'proximity', 'fatigue', 'reliability'] as Factor[])
        .map((factor) => pointsOf(row.userId, factor))
        .join(' | ')} | **${num(row.score)}** |`,
  );
  const excluded = result.excluded.map((row) => `- ${row.userId}: ${row.reasons.map((reason) => `\`${reason}\``).join(', ')}`);
  const who = EXAMPLE_CANDIDATES.map((row) => `- **${row.name}**: ${row.note}.`);

  return [
    'Six practitioners for one shift that asks for nothing beyond the profession:',
    '',
    ...who,
    '',
    'What the engine makes of them:',
    '',
    '| Rank | Candidate | Experience | Nearness | Rest | Reliability | Score |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...ranked,
    '',
    'Left out, with every reason that applied:',
    '',
    ...excluded,
  ].join('\n');
}

export function renderMatchingRules(): string {
  const exclusions = EXCLUSION_ORDER.map(
    (reason) =>
      `| \`${reason}\` | ${EXCLUSION_RULES[reason].about} | ${EXCLUSION_RULES[reason].rule} | ${EXCLUSION_WORDS[reason].label} |`,
  );

  return [
    '# How matching ranks and excludes people',
    '',
    '<!-- Generated by scripts/render-matching-rules.ts from src/modules/matching/domain/matching-rules.ts. Do not edit by hand: a test fails when this file and the code disagree. -->',
    '',
    'Matching answers one question for one shift: **who could work it, in what order, and why not the others.** This is the whole rule. It is the same for every facility, it does not learn, and nothing in it is chosen by hand for a particular person.',
    '',
    '## When a match runs, and who is looked at',
    '',
    '- **Only when somebody at the facility asks for one.** Nothing runs a match on its own, and a match offers nobody anything: it ranks, a person decides whom to invite.',
    '- **Only for work that can be offered.** The request must be published, its shift must not have started, and the facility must be verified and in date. Anything else is refused and leaves no record.',
    '- **The pool is everybody registered in the request’s profession**, except anybody who has withdrawn either consent matching rests on: letting facilities see their profile, or sharing their credentials with a facility. They are left out altogether: not ranked, not listed as excluded and not counted.',
    '- **Everybody in the pool is then either excluded, with every reason that applies, or ranked.**',
    '',
    '## Who is excluded',
    '',
    'A person is excluded if **any** of these applies. All the reasons that apply are recorded, not only the first, so that “why did nobody match?” has a whole answer.',
    '',
    '| Reason | About | Applies when | Shown to a facility as |',
    '| --- | --- | --- | --- |',
    ...exclusions,
    '',
    'A facility is shown the reasons, counted, with the short name in the last column and a sentence under it, but not whose they are: whose diary is full is that person’s business. A practitioner who is ranked is shown to the facility by initials only, with no phone number, until a booking exists.',
    '',
    '## How the rest are ranked',
    '',
    `Each person who is not excluded scores out of ${TOTAL_WEIGHT} on four factors. The weights are fixed in the code, not in a settings table, so that a ranking cannot change because somebody edited a row, and the same inputs always give the same ranking.`,
    '',
    weightsTable(),
    '',
    factorSections(),
    '',
    '## The order, and ties',
    '',
    `The score is the four factors’ points added up. Each factor’s points and the total are rounded to two decimal places before anybody is compared, so two people whose scores are equal to two places are tied. A tie goes to the lower user id, which is arbitrary but never different from one run to the next. Ranks run 1, 2, 3 with no gaps. The people left out are listed in user id order.`,
    '',
    '## A worked example',
    '',
    workedExample(),
    '',
    exampleNotes(),
    '',
    '## What is kept',
    '',
    'Every run is stored with the weights that produced it, every ranked person’s points under each factor, and every excluded person’s reasons. A ranking that nobody can look at again explains nothing, and without the weights an old run could not be read once they changed.',
    '',
    '## What it does not do',
    '',
    '- **It does not look at competencies.** Level and supervision are hard filters; individual competencies are not built.',
    '- **It does not count shifts already worked toward rest.** Only assignments still confirmed are added up, so a week of shifts that have been approved no longer weighs on the next shift’s ranking.',
    '- **It does not measure distance.** Nearness is the three steps above until the system holds where people and facilities are.',
    '- **It does not use pay, a facility’s preferences or who was offered the last shift.** A facility cannot move one person up.',
    '- **It does not learn.** Reliability uses decided outcomes only, as above.',
    '',
    '## Changing a rule',
    '',
    'A weight, a cap or a filter is a change to `src/modules/matching/domain/engine.ts`, with a review and a new snapshot, and then to this page: edit `matching-rules.ts`, run `pnpm tsx scripts/render-matching-rules.ts`, and commit both. The tests refuse a page that disagrees with the engine.',
    '',
  ].join('\n');
}
