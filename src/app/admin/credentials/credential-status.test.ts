import { describe, expect, it } from 'vitest';
import { CredentialSubmissionStatus } from '@prisma/client';
import {
  CREDENTIAL_STATUSES,
  canDecide,
  isAwaitingPractitioner,
  needsReason,
  type CredentialStatus,
} from './credential-status';

describe('credential statuses', () => {
  it('are exactly the ones the schema has', () => {
    expect(CREDENTIAL_STATUSES.map(([value]) => value).sort()).toEqual(
      Object.values(CredentialSubmissionStatus).sort(),
    );
  });

  it('can be decided only while PENDING, which is all the server accepts', () => {
    const decidable = CREDENTIAL_STATUSES.map(([value]) => value).filter((value) =>
      canDecide(value),
    );
    expect(decidable).toEqual(['PENDING']);
  });

  it('waits on the practitioner only once more has been asked of them', () => {
    const waiting = CREDENTIAL_STATUSES.map(([value]) => value as CredentialStatus).filter(
      isAwaitingPractitioner,
    );
    expect(waiting).toEqual(['MORE_INFO_REQUESTED']);
  });

  it('asks for a reason to reject or to ask for more, and not to approve', () => {
    expect(needsReason('approve')).toBe(false);
    expect(needsReason('reject')).toBe(true);
    expect(needsReason('request_info')).toBe(true);
  });
});
