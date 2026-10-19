import { describe, expect, it } from 'vitest';
import {
  credentialNextStep,
  credentialTimeline,
  daysUntilExpiry,
  expiryPhrase,
  expiryTone,
} from './credential-timing';

// 18 October 2026, 10:00 in Lagos.
const NOW = new Date('2026-10-18T09:00:00Z');

describe('daysUntilExpiry', () => {
  it('counts Lagos calendar days from the date printed on the document', () => {
    expect(daysUntilExpiry({ documentExpiresOn: '2026-10-30' }, NOW)).toBe(12);
    expect(daysUntilExpiry({ documentExpiresOn: '2026-10-18' }, NOW)).toBe(0);
    expect(daysUntilExpiry({ documentExpiresOn: '2026-10-09' }, NOW)).toBe(-9);
  });

  it('is still today late in the evening in Lagos, when UTC has not turned over', () => {
    // 23:30 in Lagos on the 18th is 22:30 UTC on the 18th.
    expect(
      daysUntilExpiry({ documentExpiresOn: '2026-10-18' }, new Date('2026-10-18T22:30:00Z')),
    ).toBe(0);
    // 00:30 in Lagos on the 19th is 23:30 UTC on the 18th: already tomorrow here.
    expect(
      daysUntilExpiry({ documentExpiresOn: '2026-10-19' }, new Date('2026-10-18T23:30:00Z')),
    ).toBe(0);
  });

  it('falls back to the estimate, read as a Lagos date, when no date was read from the document', () => {
    expect(daysUntilExpiry({ expiresAt: '2026-10-20T00:00:00.000Z' }, NOW)).toBe(2);
  });

  it('prefers the document to the estimate', () => {
    expect(
      daysUntilExpiry(
        { documentExpiresOn: '2026-11-01', expiresAt: '2026-10-20T00:00:00.000Z' },
        NOW,
      ),
    ).toBe(14);
  });

  it('is null when there is no date at all', () => {
    expect(daysUntilExpiry({}, NOW)).toBeNull();
    expect(daysUntilExpiry({ expiresAt: null, documentExpiresOn: null }, NOW)).toBeNull();
  });
});

describe('expiryPhrase and expiryTone', () => {
  it('says it as a sentence', () => {
    expect(expiryPhrase(12)).toBe('expires in 12 days');
    expect(expiryPhrase(1)).toBe('expires tomorrow');
    expect(expiryPhrase(0)).toBe('expires today');
    expect(expiryPhrase(-1)).toBe('expired yesterday');
    expect(expiryPhrase(-9)).toBe('expired 9 days ago');
  });

  it('warns inside a month and is quiet beyond it', () => {
    expect(expiryTone(-1)).toBe('danger');
    expect(expiryTone(0)).toBe('warning');
    expect(expiryTone(30)).toBe('warning');
    expect(expiryTone(31)).toBeUndefined();
  });
});

describe('credentialNextStep', () => {
  it('says whose move it is for every status', () => {
    expect(credentialNextStep('PENDING').theirMove).toBe(false);
    expect(credentialNextStep('VERIFIED').theirMove).toBe(false);
    expect(credentialNextStep('MORE_INFO_REQUESTED').theirMove).toBe(true);
    expect(credentialNextStep('REJECTED').theirMove).toBe(true);
    expect(credentialNextStep('EXPIRED').theirMove).toBe(true);
  });

  it('promises no turnaround', () => {
    for (const status of ['PENDING', 'MORE_INFO_REQUESTED', 'VERIFIED', 'REJECTED', 'EXPIRED']) {
      expect(credentialNextStep(status).says).not.toMatch(
        /\b(hours?|days?|minutes?|soon|quickly)\b/i,
      );
    }
  });
});

describe('credentialTimeline', () => {
  const base = { createdAt: '2026-10-10T08:00:00Z', reviewedAt: '2026-10-12T10:30:00Z' };

  it('starts with the submission and waits for a reviewer', () => {
    const steps = credentialTimeline({ ...base, status: 'PENDING', reviewedAt: null }, NOW);
    expect(steps.map((s) => [s.id, s.state])).toEqual([
      ['submitted', 'done'],
      ['review', 'current'],
    ]);
  });

  it('shows what a reviewer asked for, and that the next move is the practitioner’s', () => {
    const steps = credentialTimeline(
      { ...base, status: 'MORE_INFO_REQUESTED', reviewNotes: 'Upload the schedule page.' },
      NOW,
    );
    expect(steps.map((s) => s.id)).toEqual(['submitted', 'asked', 'answer']);
    expect(steps[1]?.detail).toBe('Upload the schedule page.');
    expect(steps[2]?.state).toBe('current');
  });

  it('puts the expiry after the verification and marks a near one', () => {
    const steps = credentialTimeline(
      { ...base, status: 'VERIFIED', documentExpiresOn: '2026-10-30' },
      NOW,
    );
    const expiry = steps.at(-1)!;
    expect(expiry.id).toBe('expiry');
    expect(expiry.title).toBe('Expires in 12 days');
    expect(expiry.state).toBe('current');
  });

  it('leaves the expiry out when nothing says when it lapses', () => {
    const steps = credentialTimeline({ ...base, status: 'VERIFIED' }, NOW);
    expect(steps.map((s) => s.id)).toEqual(['submitted', 'verified']);
  });

  it('marks a refusal as a problem and keeps the reviewer’s words', () => {
    const steps = credentialTimeline(
      { ...base, status: 'REJECTED', reviewNotes: 'Illegible.' },
      NOW,
    );
    expect(steps[1]).toMatchObject({ id: 'refused', state: 'problem', detail: 'Illegible.' });
  });

  it('leaves the reviewer’s words out when the caller already shows them', () => {
    const asked = credentialTimeline(
      { ...base, status: 'MORE_INFO_REQUESTED', reviewNotes: 'Upload the schedule page.' },
      NOW,
      { notes: false },
    );
    expect(asked[1]?.detail).toBeUndefined();
    const refused = credentialTimeline(
      { ...base, status: 'REJECTED', reviewNotes: 'Illegible.' },
      NOW,
      { notes: false },
    );
    expect(refused[1]?.detail).toBeUndefined();
  });

  it('says so when a reviewer refused without a note', () => {
    const steps = credentialTimeline({ ...base, status: 'REJECTED', reviewNotes: null }, NOW);
    expect(steps[1]?.detail).toBe('The reviewer gave no note.');
  });
});
