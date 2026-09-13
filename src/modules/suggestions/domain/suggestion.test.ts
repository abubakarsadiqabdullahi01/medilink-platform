import { describe, expect, it } from 'vitest';
import {
  CLOSED_STATUSES,
  DECLINE_REASON_AREA,
  SUGGESTION_AREAS,
  isClosed,
  submitBlockers,
  triageBlockers,
} from './suggestion';

describe('submitting', () => {
  it('accepts anything with a few words in it', () => {
    // A low bar on purpose: the cost of a thin suggestion is one row, and the
    // cost of a form that argues with people is every one they do not file.
    expect(submitBlockers({ body: 'Matching never offers me night shifts.' })).toEqual([]);
  });

  it('refuses an empty one', () => {
    expect(submitBlockers({ body: '   ' })).toEqual(['body_missing']);
  });
});

describe('triaging', () => {
  it('moves along the queue without a response', () => {
    // Housekeeping, not an answer.
    for (const next of ['TRIAGED', 'PLANNED'] as const) {
      expect(triageBlockers({ status: 'NEW', next, response: '' }), next).toEqual([]);
    }
  });

  it('requires a response to finish with one', () => {
    // A declined suggestion with no reason is how a pilot teaches people to
    // stop bothering.
    for (const next of ['DONE', 'DECLINED'] as const) {
      expect(triageBlockers({ status: 'NEW', next, response: '' }), next).toContain(
        'response_required',
      );
    }
  });

  it('accepts a closing move that carries one', () => {
    expect(
      triageBlockers({
        status: 'PLANNED',
        next: 'DONE',
        response: 'Shipped in the September release.',
      }),
    ).toEqual([]);
  });

  it('will not reopen something already finished', () => {
    for (const status of CLOSED_STATUSES) {
      expect(
        triageBlockers({ status, next: 'PLANNED', response: 'Changed our mind about this.' }),
        status,
      ).toContain('already_closed');
    }
  });

  it('refuses a move to the status it is already in', () => {
    expect(triageBlockers({ status: 'PLANNED', next: 'PLANNED', response: '' })).toContain(
      'same_status',
    );
  });
});

describe('the shape of the log', () => {
  it('treats done and declined as finished and nothing else', () => {
    expect(CLOSED_STATUSES).toEqual(['DONE', 'DECLINED']);
    expect(isClosed('NEW')).toBe(false);
    expect(isClosed('PLANNED')).toBe(false);
    expect(isClosed('DONE')).toBe(true);
  });

  it('files a decline reason under matching', () => {
    // A practitioner declining an invitation is, by construction, telling you
    // about what you offered and how. Guessing a finer area from free text
    // would be inventing data.
    expect(DECLINE_REASON_AREA).toBe('MATCHING');
    expect(SUGGESTION_AREAS).toContain(DECLINE_REASON_AREA);
  });

  it('names every area exactly once', () => {
    expect(new Set(SUGGESTION_AREAS).size).toBe(SUGGESTION_AREAS.length);
  });
});
