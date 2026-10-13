import { describe, expect, it } from 'vitest';
import {
  applicationGaps,
  applicationState,
  describeGaps,
  type ApplicationFacts,
} from './application-review';

const complete: ApplicationFacts = {
  hasProfile: true,
  hasAvailability: true,
  mandatoryCredentialTypeIds: ['licence', 'nysc'],
  suppliedCredentialTypeIds: ['licence', 'nysc'],
};

describe('applicationGaps', () => {
  it('is empty when everything of theirs is done', () => {
    expect(applicationGaps(complete)).toEqual([]);
  });

  it('names each thing that is missing, in the order they are met', () => {
    expect(
      applicationGaps({
        hasProfile: false,
        hasAvailability: false,
        mandatoryCredentialTypeIds: ['licence'],
        suppliedCredentialTypeIds: [],
      }),
    ).toEqual(['details', 'availability', 'documents']);
  });

  it('wants one document short of the set, not none', () => {
    expect(applicationGaps({ ...complete, suppliedCredentialTypeIds: ['licence'] })).toEqual([
      'documents',
    ]);
  });

  it('does not ask for documents a profession does not require', () => {
    expect(
      applicationGaps({
        ...complete,
        mandatoryCredentialTypeIds: [],
        suppliedCredentialTypeIds: [],
      }),
    ).toEqual([]);
  });

  it('ignores documents supplied that nobody required', () => {
    expect(
      applicationGaps({ ...complete, suppliedCredentialTypeIds: ['licence', 'nysc', 'x'] }),
    ).toEqual([]);
  });
});

describe('applicationState', () => {
  const at = new Date('2026-10-12T10:00:00Z');

  it('is a draft while something of theirs is missing', () => {
    expect(
      applicationState({ gaps: ['documents'], submittedForReviewAt: null, eligible: false }),
    ).toBe('DRAFT');
  });

  it('is ready once all of theirs is done and they have not said so', () => {
    expect(applicationState({ gaps: [], submittedForReviewAt: null, eligible: false })).toBe(
      'READY',
    );
  });

  it('is waiting once they have submitted', () => {
    expect(applicationState({ gaps: [], submittedForReviewAt: at, eligible: false })).toBe(
      'WAITING',
    );
  });

  it('is approved when they can be matched, even if they never submitted', () => {
    // Accounts that predate the button must not be asked to press it.
    expect(
      applicationState({ gaps: ['details'], submittedForReviewAt: null, eligible: true }),
    ).toBe('APPROVED');
  });
});

describe('describeGaps', () => {
  it('reads as a sentence', () => {
    expect(describeGaps(['documents'])).toBe('your documents');
    expect(describeGaps(['details', 'documents'])).toBe('your details and your documents');
    expect(describeGaps(['details', 'availability', 'documents'])).toBe(
      'your details, when you can work and your documents',
    );
  });
});
