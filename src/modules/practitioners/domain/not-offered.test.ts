// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REGISTRATION_REVIEW_DAYS, eligibilityBlockers, type EligibilityInput } from './eligibility';
import {
  REASON_GUIDE,
  credentialNeeds,
  headline,
  reasonLines,
  type CredentialNeed,
  type NotOfferedView,
} from './not-offered';

/**
 * M02-07: the practitioner is told every reason they are not being offered shifts, who can clear
 * each, and what to do about the ones that are theirs.
 *
 * The failure it exists for is a reassuring wrong answer. A document that has been sent and is
 * waiting for an officer used to read "has not been submitted yet", which sends somebody to submit
 * it again; a practitioner who had turned off being shown to facilities, or never said when they
 * can work, read "You can be offered shifts" and was never offered one.
 */

const ROOT = join(__dirname, '../../../..');

const LICENCE = { id: 'type-licence', name: 'Practising licence' };
const NIN = { id: 'type-nin', name: 'National identity number slip' };

const submission = (
  credentialTypeId: string,
  status: 'PENDING' | 'MORE_INFO_REQUESTED' | 'REJECTED' | 'VERIFIED' | 'EXPIRED',
  createdAt: string,
  reviewNotes: string | null = null,
) => ({ credentialTypeId, status, createdAt: new Date(createdAt), reviewNotes });

describe('what each reason says, and who clears it', () => {
  it('has an entry for every eligibility blocker, read from the rule itself', () => {
    // The rule is the source: a blocker added there without a sentence here would reach the
    // practitioner as the code with its underscores taken out.
    const source = readFileSync(join(ROOT, 'src/modules/practitioners/domain/eligibility.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const union = source.slice(source.indexOf('export type EligibilityBlocker'), source.indexOf('export type UserStatusValue'));
    const named = new Set([
      ...[...union.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!),
      ...[...source.matchAll(/blockers\.push\('([a-z_]+)'\)/g)].map((match) => match[1]!),
    ]);

    expect(named.size).toBeGreaterThanOrEqual(10);
    for (const code of named) expect(REASON_GUIDE, code).toHaveProperty(code);
  });

  it('says something a person can read for each, and does not blame the practitioner for what is Medilink’s', () => {
    for (const [code, guide] of Object.entries(REASON_GUIDE)) {
      expect(guide.says.length, code).toBeGreaterThan(30);
      expect(guide.says, code).not.toMatch(/_/);
      if (guide.owner === 'you') {
        // What is theirs says where to go and what to press.
        expect(guide.href, code).toMatch(/^\/practitioner\//);
        expect(guide.action, code).toBeTruthy();
      } else {
        // What is Medilink's offers no button: there is nothing for them to press.
        expect(guide.href, code).toBeUndefined();
        expect(guide.action, code).toBeUndefined();
      }
    }
  });

  it('puts identity, registration, screening and the account with Medilink, and profile and documents with the practitioner', () => {
    const owners = Object.fromEntries(Object.entries(REASON_GUIDE).map(([code, guide]) => [code, guide.owner]));
    for (const code of [
      'account_not_usable',
      'identity_unverified',
      'identity_name_mismatch',
      'registration_missing',
      'registration_not_active',
      'registration_evidence_stale',
      'screening_not_clear',
    ]) {
      expect(owners[code], code).toBe('medilink');
    }
    for (const code of ['profile_incomplete', 'credential_missing', 'credential_expired', 'consent_withdrawn', 'no_availability']) {
      expect(owners[code], code).toBe('you');
    }
  });
});

describe('which documents are still needed, and where each stands', () => {
  const needs = (required: { id: string; name: string }[], submissions: ReturnType<typeof submission>[]) =>
    credentialNeeds({ required, submissions });

  it('is every required document when nothing has been sent', () => {
    expect(needs([LICENCE, NIN], [])).toEqual<CredentialNeed[]>([
      { credentialTypeId: LICENCE.id, name: LICENCE.name, state: 'not_submitted', note: null },
      { credentialTypeId: NIN.id, name: NIN.name, state: 'not_submitted', note: null },
    ]);
  });

  it('says a document that has been sent is waiting, not missing', () => {
    expect(needs([LICENCE], [submission(LICENCE.id, 'PENDING', '2026-10-01')])).toEqual([
      { credentialTypeId: LICENCE.id, name: LICENCE.name, state: 'waiting', note: null },
    ]);
  });

  it('carries what the officer asked for, or why it was not accepted', () => {
    expect(
      needs([LICENCE], [submission(LICENCE.id, 'MORE_INFO_REQUESTED', '2026-10-01', 'The photograph is not clear enough to read.')]),
    ).toEqual([
      { credentialTypeId: LICENCE.id, name: LICENCE.name, state: 'sent_back', note: 'The photograph is not clear enough to read.' },
    ]);
    expect(needs([LICENCE], [submission(LICENCE.id, 'REJECTED', '2026-10-01', 'Expired in 2024.')])).toEqual([
      { credentialTypeId: LICENCE.id, name: LICENCE.name, state: 'rejected', note: 'Expired in 2024.' },
    ]);
  });

  it('says an expired one has expired', () => {
    expect(needs([LICENCE], [submission(LICENCE.id, 'EXPIRED', '2026-01-01')])[0]).toMatchObject({ state: 'expired' });
  });

  it('is nothing for a document that has been verified', () => {
    expect(needs([LICENCE, NIN], [submission(LICENCE.id, 'VERIFIED', '2026-10-01'), submission(NIN.id, 'VERIFIED', '2026-10-01')])).toEqual([]);
  });

  it('counts a verified one even when an older one of the same type was refused or expired', () => {
    expect(
      needs(
        [LICENCE],
        [
          submission(LICENCE.id, 'REJECTED', '2026-08-01', 'Blurred.'),
          submission(LICENCE.id, 'EXPIRED', '2026-02-01'),
          submission(LICENCE.id, 'VERIFIED', '2026-09-01'),
        ],
      ),
    ).toEqual([]);
  });

  it('goes by the latest answer: a replacement waiting replaces the refusal it follows', () => {
    expect(
      needs([LICENCE], [submission(LICENCE.id, 'REJECTED', '2026-08-01', 'Blurred.'), submission(LICENCE.id, 'PENDING', '2026-09-01')])[0],
    ).toMatchObject({ state: 'waiting', note: null });
    expect(
      needs([LICENCE], [submission(LICENCE.id, 'PENDING', '2026-08-01'), submission(LICENCE.id, 'REJECTED', '2026-09-01', 'Wrong document.')])[0],
    ).toMatchObject({ state: 'rejected', note: 'Wrong document.' });
  });

  it('does not depend on the order the rows arrive in', () => {
    const rows = [
      submission(LICENCE.id, 'REJECTED', '2026-08-01', 'Blurred.'),
      submission(LICENCE.id, 'PENDING', '2026-09-01'),
    ];
    expect(needs([LICENCE], rows)).toEqual(needs([LICENCE], [...rows].reverse()));
  });

  it('ignores a document the profession does not require', () => {
    expect(needs([LICENCE], [submission('type-other', 'REJECTED', '2026-09-01', 'No.')])).toEqual([
      { credentialTypeId: LICENCE.id, name: LICENCE.name, state: 'not_submitted', note: null },
    ]);
  });

  it('is empty exactly when the rule says no document is missing, for every combination of what has been sent', () => {
    // The explanation must never disagree with the rule that decides eligibility: it is derived
    // from the same rows, and this holds the two together across every case rather than a sample.
    const statuses = [null, 'PENDING', 'MORE_INFO_REQUESTED', 'REJECTED', 'VERIFIED', 'EXPIRED'] as const;
    const base: EligibilityInput = {
      userStatus: 'ACTIVE',
      hasProfile: true,
      identity: { nameMatch: true },
      screening: { status: 'CLEAR' },
      registration: {
        registrationStatus: 'ACTIVE',
        expiresAt: new Date('2027-09-01T12:00:00Z'),
        deletedAt: null,
        evidenceRetrievedAt: new Date('2026-09-01T12:00:00Z'),
      },
      registrationReviewDays: DEFAULT_REGISTRATION_REVIEW_DAYS,
      requiredCredentialTypeIds: [LICENCE.id, NIN.id],
      verifiedCredentialTypeIds: [],
      expiredCredentialTypeIds: [],
    };

    let cases = 0;
    for (const older of statuses) {
      for (const newer of statuses) {
        for (const other of statuses) {
          const rows: ReturnType<typeof submission>[] = [];
          if (older) rows.push(submission(LICENCE.id, older, '2026-06-01'));
          if (newer) rows.push(submission(LICENCE.id, newer, '2026-09-01'));
          if (other) rows.push(submission(NIN.id, other, '2026-09-01'));

          // What the application hands the rule: only verified and expired rows count there.
          const verified = [...new Set(rows.filter((row) => row.status === 'VERIFIED').map((row) => row.credentialTypeId))];
          const expired = [...new Set(rows.filter((row) => row.status === 'EXPIRED').map((row) => row.credentialTypeId))];
          const blockers = eligibilityBlockers({ ...base, verifiedCredentialTypeIds: verified, expiredCredentialTypeIds: expired });

          const outstanding = needs([LICENCE, NIN], rows);
          expect(outstanding.length > 0, JSON.stringify(rows)).toBe(blockers.includes('credential_missing'));
          cases += 1;
        }
      }
    }
    expect(cases).toBe(216);
  });
});

describe('the lines the practitioner reads', () => {
  const view = (over: Partial<NotOfferedView> = {}): NotOfferedView => ({
    eligible: false,
    blockers: [],
    credentials: [],
    alsoStopsOffers: [],
    ...over,
  });

  it('is nothing when nothing is wrong', () => {
    expect(reasonLines(view({ eligible: true }))).toEqual([]);
    expect(headline(view({ eligible: true }))).toBe('offered');
  });

  it('gives each blocker its sentence and its owner', () => {
    const lines = reasonLines(view({ blockers: ['identity_unverified', 'profile_incomplete'] }));
    expect(lines.map((line) => [line.code, line.owner])).toEqual([
      ['identity_unverified', 'medilink'],
      ['profile_incomplete', 'you'],
    ]);
    expect(lines[1]).toMatchObject({ href: '/practitioner/profile?tab=profile', action: 'Finish your profile' });
    expect(lines[0]!.href).toBeUndefined();
  });

  it('names the document instead of saying "a credential your profession requires"', () => {
    const lines = reasonLines(
      view({
        blockers: ['credential_missing'],
        credentials: [{ credentialTypeId: LICENCE.id, name: LICENCE.name, state: 'not_submitted', note: null }],
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toContain('Practising licence');
    expect(lines[0]).toMatchObject({ owner: 'you', action: 'Submit it', href: '/practitioner/profile?tab=credentials' });
  });

  it('puts a document that is waiting on Medilink’s side, with nothing to press', () => {
    const [line] = reasonLines(
      view({
        blockers: ['credential_missing'],
        credentials: [{ credentialTypeId: LICENCE.id, name: LICENCE.name, state: 'waiting', note: null }],
      }),
    );
    expect(line).toMatchObject({ owner: 'medilink' });
    expect(line!.text).toMatch(/waiting/i);
    expect(line!.text).not.toMatch(/not been submitted/i);
    expect(line!.href).toBeUndefined();
    expect(line!.action).toBeUndefined();
  });

  it('says what the officer asked for, in their words, and offers to send it', () => {
    const [sentBack, rejected] = reasonLines(
      view({
        blockers: ['credential_missing'],
        credentials: [
          { credentialTypeId: LICENCE.id, name: LICENCE.name, state: 'sent_back', note: 'The photograph is not clear enough to read.' },
          { credentialTypeId: NIN.id, name: NIN.name, state: 'rejected', note: 'Not the right slip.' },
        ],
      }),
    );
    expect(sentBack!.text).toContain('The photograph is not clear enough to read.');
    expect(sentBack).toMatchObject({ owner: 'you' });
    expect(rejected!.text).toContain('Not the right slip.');
    expect(rejected).toMatchObject({ owner: 'you', action: 'Send a new one' });
  });

  it('does not repeat the general sentence beside the specific ones, and shows both blockers once each', () => {
    const lines = reasonLines(
      view({
        blockers: ['credential_expired', 'credential_missing', 'screening_not_clear'],
        credentials: [{ credentialTypeId: LICENCE.id, name: LICENCE.name, state: 'expired', note: null }],
      }),
    );
    expect(lines.map((line) => line.code)).toEqual(['credential_expired', 'screening_not_clear']);
  });

  it('falls back to the general sentence when the rule says a document is missing and the detail did not arrive', () => {
    const lines = reasonLines(view({ blockers: ['credential_missing'], credentials: undefined }));
    expect(lines.map((line) => line.code)).toEqual(['credential_missing']);
  });

  it('adds what stops offers although the account is approved: sharing turned off, and no availability', () => {
    const lines = reasonLines(view({ eligible: true, alsoStopsOffers: ['consent_withdrawn', 'no_availability'] }));
    expect(lines.map((line) => [line.code, line.owner])).toEqual([
      ['consent_withdrawn', 'you'],
      ['no_availability', 'you'],
    ]);
    expect(lines[0]).toMatchObject({ href: '/practitioner/privacy' });
    expect(lines[1]).toMatchObject({ href: '/practitioner/profile?tab=availability' });
  });

  it('says an unrecognised code in words rather than dropping it', () => {
    const [line] = reasonLines(view({ blockers: ['a_new_blocker'] }));
    expect(line).toMatchObject({ code: 'a_new_blocker', owner: 'medilink' });
    expect(line!.text).toBe('A new blocker.');
  });

  it('never claims you can be offered shifts while anything stops it', () => {
    expect(headline(view({ eligible: false, blockers: ['identity_unverified'] }))).toBe('not_eligible');
    expect(headline(view({ eligible: true, alsoStopsOffers: ['no_availability'] }))).toBe('approved_but_not_offered');
    expect(headline(view({ eligible: true, alsoStopsOffers: [] }))).toBe('offered');
    // Both: the account is the first thing to put right.
    expect(headline(view({ eligible: false, blockers: ['profile_incomplete'], alsoStopsOffers: ['consent_withdrawn'] }))).toBe('not_eligible');
  });
});
