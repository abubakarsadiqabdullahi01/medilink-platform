/**
 * What each part of "My profile" is for, in one sentence.
 *
 * Kept apart from the sections so the same line serves a tab and a wizard
 * step, rather than the section repeating it above itself in one and being
 * missing from the other.
 */
export const INTRO = {
  profile:
    'Your profession and where you are based. The matcher scores proximity against them, so they decide which shifts you are offered.',
  availability:
    'A standing weekly pattern, the odd night or day you are free, and the dates you are away. The matcher reads all three — a shift you are not available for is never offered to you.',
  credentials:
    'Every mandatory credential for your profession has to be verified before you can be offered work. A reviewer checks each one by hand.',
  privacy:
    'What Medilink holds about you, what it was permitted to do with it, and how to change your mind.',
} as const;
