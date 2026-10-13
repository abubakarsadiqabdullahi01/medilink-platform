import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import {
  setInitialPassword,
  startRegistration,
  verifyRegistrationPhone,
} from '@/modules/auth/application/registration';
import { createFacility } from '@/modules/facilities/application/facility';
import { createProfile } from '@/modules/practitioners/application/profile';
import { listMatchCandidates } from '@/modules/practitioners/application/candidates';
import { currentConsent, recordConsent } from '@/modules/audit-compliance/application/consent';
import { clearCookies } from './support/cookie-jar';
import { lastOtpCode, startSmsCapture, stopSmsCapture } from './support/sms-capture';
import { createFacilityType, createProfessionalCategory, createState, ensureRole } from './support/fixtures';

/**
 * Who an account is for, decided when the password is set.
 *
 * Every signup used to publish `practitioner.registered`, so a hospital's
 * Medical Director registering her facility was granted the practitioner role
 * and screened against the quack list like a locum, and sat in UNDER_REVIEW
 * for ever because nothing would ever verify her as one.
 */

const PASSWORD = 'kaduna-lantern-4471';
let sequence = 0;

async function signUp(accountType?: 'practitioner' | 'staff', consentToSharing?: boolean) {
  sequence += 1;
  const phone = `0803999${String(1000 + sequence).slice(-4)}`;
  await startRegistration({ phone, fullName: 'Ngozi Okonkwo-Bello' });
  await verifyRegistrationPhone({ phone, code: lastOtpCode() });
  return setInitialPassword({ phone, password: PASSWORD, accountType, consentToSharing });
}

async function registeredEvents(userId: string) {
  return prisma.outboxEvent.count({
    where: { eventType: EVENTS.PractitionerRegistered, aggregateId: userId },
  });
}

beforeEach(() => {
  clearCookies();
  startSmsCapture();
});

afterEach(() => {
  stopSmsCapture();
});

describe('a practitioner signing up', () => {
  it('waits in review and is handed to credentialling, as before', async () => {
    const { userId, accountStatus } = await signUp();

    expect(accountStatus).toBe('UNDER_REVIEW');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).status).toBe('UNDER_REVIEW');
    expect(await registeredEvents(userId)).toBe(1);
  });
});

describe('a staff account', () => {
  it('is active, and is never offered to the practitioner pipeline', async () => {
    const { userId, accountStatus } = await signUp('staff');

    expect(accountStatus).toBe('ACTIVE');
    expect(await registeredEvents(userId)).toBe(0);
    expect(await prisma.userRole.count({ where: { userId } })).toBe(0);
  });

  it('says what it was opened as, in the audit row', async () => {
    const { userId } = await signUp('staff');

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.password_set', entityId: userId },
    });
    expect(row.after).toMatchObject({ status: 'ACTIVE', accountType: 'staff' });
  });

  it('becomes the owner of the facility it registers, and nothing else', async () => {
    await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);
    const { userId } = await signUp('staff');
    const state = await createState();
    const facilityType = await createFacilityType();

    await createFacility({
      name: 'Aso Garden Specialist Hospital',
      facilityTypeId: facilityType.id,
      cacNumber: `RC17${String(sequence).padStart(5, '0')}`,
      stateId: state.id,
      addressLine: 'Plot 27, Garden Close, Wuse II, Abuja',
      contactPhone: '+2348055550100',
      representativeUserId: userId,
      actorId: userId,
    });

    const roles = await prisma.userRole.findMany({ where: { userId }, include: { role: true } });
    expect(roles.map((row) => row.role.key)).toEqual(['facility_owner']);
  });
});

describe('consent to be shown to facilities', () => {
  it('is recorded with the account when the practitioner agrees', async () => {
    const { userId } = await signUp('practitioner', true);

    const consent = await currentConsent(userId);
    const granted = consent.filter((row) => row.granted).map((row) => row.purpose).sort();
    expect(granted).toEqual(['CREDENTIAL_SHARING', 'PROFILE_VISIBILITY']);
    expect(await prisma.auditLog.count({ where: { action: 'consent.granted', scopeId: userId } })).toBe(2);
  });

  it('takes a practitioner out of matching once they withdraw it', async () => {
    const { userId } = await signUp('practitioner', true);
    const category = await createProfessionalCategory();
    await createProfile({ userId, professionalCategoryId: category.id, yearsOfExperience: 4 });

    const before = await listMatchCandidates({ professionalCategoryId: category.id });
    expect(before.map((row) => row.userId)).toContain(userId);

    await recordConsent({
      userId,
      purpose: 'PROFILE_VISIBILITY',
      granted: false,
      note: 'I am taking a break from locum work.',
      actorId: userId,
    });

    const after = await listMatchCandidates({ professionalCategoryId: category.id });
    expect(after.map((row) => row.userId)).not.toContain(userId);
  });

  it('is never recorded for a staff account', async () => {
    const { userId } = await signUp('staff', true);
    expect(await prisma.consentRecord.count({ where: { userId } })).toBe(0);
  });
});
