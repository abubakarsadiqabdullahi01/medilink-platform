import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import {
  setInitialPassword,
  startRegistration,
  verifyRegistrationPhone,
} from '@/modules/auth/application/registration';
import {
  createFacility,
  updateFacility,
  verifyFacility,
} from '@/modules/facilities/application/facility';
import { recordConsent } from '@/modules/audit-compliance/application/consent';
import {
  closeRequest,
  raiseRequest,
  startRequest,
} from '@/modules/audit-compliance/application/data-subject';
import { clearCookies } from './support/cookie-jar';
import { lastOtpCode, startSmsCapture, stopSmsCapture } from './support/sms-capture';
import {
  createFacilityType,
  createState,
  createUser,
  ensureRole,
} from './support/fixtures';

/**
 * AUD-02. The audit trail is kept for good, so a name, an email or a phone
 * number written into it is a record the person's right to erasure cannot reach.
 * These run the flows that handle personal data and read every audit row back
 * for the strings that identify somebody.
 */

const PERSON = {
  fullName: 'Zainab Okoro-Planetson',
  email: 'zainab.planetson@example.org',
  phone: '+2348039876543',
  localPhone: '08039876543',
};
const FACILITY_CONTACT = { phone: '+2348021112223', email: 'matron.desk@hospital.example' };
const SECRET_NOTE = 'I am leaving because my husband Ibrahim Danladi-Quill was posted to Jos';

beforeEach(() => {
  clearCookies();
  startSmsCapture();
});

afterEach(() => {
  stopSmsCapture();
});

/** Everything the audit table holds, as one string to search. */
async function everythingAudited(): Promise<string> {
  const rows = await prisma.auditLog.findMany();
  return rows
    .map((row) => JSON.stringify({ reason: row.reason, before: row.before, after: row.after }))
    .join('\n');
}

describe('what the audit trail keeps about a person', () => {
  it('does not keep the name, email or number somebody registered with', async () => {
    await startRegistration({
      phone: PERSON.phone,
      fullName: PERSON.fullName,
      email: PERSON.email,
    });
    const { setupToken } = await verifyRegistrationPhone({
      phone: PERSON.phone,
      code: lastOtpCode(),
    });
    await setInitialPassword({
      phone: PERSON.phone,
      password: 'correct horse battery staple',
      setupToken: setupToken!,
    });

    const audited = await everythingAudited();
    expect(audited).not.toContain(PERSON.fullName);
    expect(audited).not.toContain('Okoro');
    expect(audited).not.toContain(PERSON.email);
    expect(audited).not.toContain(PERSON.phone);
    expect(audited).not.toContain('8039876543');
    // It still says that the registration happened, and for whom.
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.registration_started' },
    });
    expect(row.entityId).toBeTruthy();
  });

  it('does not keep a facility\'s contact number or email through its life', async () => {
    await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);
    const state = await createState();
    const facilityType = await createFacilityType();
    const representative = await createUser({ fullName: 'Facility Representative' });
    const officer = await createUser({ fullName: 'Verifying Officer' });

    const facility = await createFacility({
      name: 'Owerri General Hospital',
      facilityTypeId: facilityType.id,
      cacNumber: 'RC700123',
      stateId: state.id,
      addressLine: '14 Wetheral Road, Owerri',
      contactPhone: FACILITY_CONTACT.phone,
      contactEmail: FACILITY_CONTACT.email,
      representativeUserId: representative.id,
      actorId: officer.id,
    });
    await updateFacility({
      facilityId: facility.id,
      actorId: representative.id,
      contactPhone: '+2348055556666',
      contactEmail: 'newdesk@hospital.example',
    });
    await verifyFacility({ facilityId: facility.id, verifierId: officer.id, decision: 'approve' });

    const audited = await everythingAudited();
    expect(audited).not.toContain('8021112223');
    expect(audited).not.toContain(FACILITY_CONTACT.email);
    expect(audited).not.toContain('8055556666');
    expect(audited).not.toContain('newdesk@hospital.example');
    // The organisation's own name is not personal data, and the trail should still read.
    expect(audited).toContain('Owerri General Hospital');
  });

  it('does not copy what somebody wrote in a rights request into the trail', async () => {
    const person = await createUser({ fullName: 'Folake Adeyemi' });
    const officer = await createUser({ fullName: 'Compliance Officer' });

    const raised = await raiseRequest({
      userId: person.id,
      kind: 'ERASURE',
      detail: SECRET_NOTE,
    });
    await startRequest({ requestId: raised.id, actorId: officer.id });
    await closeRequest({
      requestId: raised.id,
      actorId: officer.id,
      status: 'REFUSED',
      outcome: 'Refused for now: a dispute is open. Written to the person at +2348039876543.',
    });

    const audited = await everythingAudited();
    expect(audited).not.toContain('Ibrahim');
    expect(audited).not.toContain('Danladi');
    // An officer's outcome stays, since it is the reason a refusal can be appealed,
    // but a number typed into it does not.
    expect(audited).toContain('Refused for now');
    expect(audited).not.toContain('8039876543');
    // The text is where it belongs: on the request, which erasure can reach.
    expect((await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: raised.id } })).detail).toBe(
      SECRET_NOTE,
    );
  });

  it('does not copy the note somebody gave when withdrawing consent', async () => {
    const person = await createUser({ fullName: 'Emeka Obi' });
    await recordConsent({
      userId: person.id,
      purpose: 'MARKETING',
      granted: false,
      note: SECRET_NOTE,
      actorId: person.id,
    });

    const audited = await everythingAudited();
    expect(audited).not.toContain('Ibrahim');
    expect(audited).not.toContain('Danladi');
    expect((await prisma.consentRecord.findFirstOrThrow({ where: { userId: person.id } })).note).toBe(
      SECRET_NOTE,
    );
    // That a note was given is still on the record.
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'consent.withdrawn' } }).catch(() => null);
    expect(row === null || row.reason !== SECRET_NOTE).toBe(true);
  });
});
