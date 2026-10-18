// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { smsProblems } from '@/modules/notifications/domain/sms-hygiene';
import { smsEncoding } from '@/lib/sms-text';
import {
  INVITABLE_ROLES,
  INVITATION_LIMITS,
  INVITATION_VALID_DAYS,
  effectiveStatus,
  expiryFrom,
  invitationText,
  isInvitableRole,
  limitBreached,
} from './staff-invitation';

const NOW = new Date('2026-10-17T10:00:00Z');
const none = { inviterLastHour: 0, facilityLastDay: 0, numberLastDay: 0 };

describe('who a facility may invite', () => {
  it('is its own staff roles and nothing a facility cannot give', () => {
    expect([...INVITABLE_ROLES]).toEqual(['facility_administrator', 'facility_owner']);
    for (const role of INVITABLE_ROLES) {
      expect(isInvitableRole(role)).toBe(true);
      // Nothing that is Medilink's to hold: an invitation is answered from a stranger's phone.
      for (const platformOnly of ['config.manage', 'facility.verify', 'sanction.apply', 'system.manage', 'data.erase']) {
        expect(ROLE_PERMISSIONS[role], `${role} must not carry ${platformOnly}`).not.toContain(platformOnly);
      }
    }
  });

  it.each(['super_administrator', 'administrator', 'practitioner', 'made_up', ''])(
    'does not include %s',
    (role) => {
      expect(isInvitableRole(role)).toBe(false);
    },
  );

  it('names only roles that exist', () => {
    for (const role of INVITABLE_ROLES) expect(role in ROLE_PERMISSIONS).toBe(true);
    expect(Object.keys(PERMISSIONS)).toContain('role.grant');
  });
});

describe('how many invitations may go', () => {
  it('lets one more go while every count is under its ceiling', () => {
    expect(
      limitBreached({
        inviterLastHour: INVITATION_LIMITS.perInviterPerHour - 1,
        facilityLastDay: INVITATION_LIMITS.perFacilityPerDay - 1,
        numberLastDay: INVITATION_LIMITS.perNumberPerDay - 1,
      }),
    ).toBeNull();
    expect(limitBreached(none)).toBeNull();
  });

  it('stops the person who has sent their ten in the hour, and says so', () => {
    const breach = limitBreached({ ...none, inviterLastHour: INVITATION_LIMITS.perInviterPerHour });
    expect(breach?.limit).toBe('inviter');
    expect(breach?.message).toMatch(/last hour/);
  });

  it('stops the facility that has sent its twenty in the day', () => {
    const breach = limitBreached({ ...none, facilityLastDay: INVITATION_LIMITS.perFacilityPerDay });
    expect(breach?.limit).toBe('facility');
    expect(breach?.message).toMatch(/tomorrow/);
  });

  it('stops a number being invited by several facilities in the day, without saying who', () => {
    const breach = limitBreached({ ...none, numberLastDay: INVITATION_LIMITS.perNumberPerDay });
    expect(breach?.limit).toBe('number');
    expect(breach?.message).not.toMatch(/\d{4}/);
  });

  it('names the narrowest ceiling first when several are reached', () => {
    expect(
      limitBreached({
        inviterLastHour: INVITATION_LIMITS.perInviterPerHour,
        facilityLastDay: INVITATION_LIMITS.perFacilityPerDay,
        numberLastDay: INVITATION_LIMITS.perNumberPerDay,
      })?.limit,
    ).toBe('inviter');
  });
});

describe('how long an invitation lasts', () => {
  it('is seven days from now', () => {
    expect(INVITATION_VALID_DAYS).toBe(7);
    expect(expiryFrom(NOW).toISOString()).toBe('2026-10-24T10:00:00.000Z');
  });

  it('is pending until the moment it expires, and expired from then on', () => {
    const expiresAt = expiryFrom(NOW);
    expect(effectiveStatus({ status: 'PENDING', expiresAt }, new Date(expiresAt.getTime() - 1))).toBe('PENDING');
    expect(effectiveStatus({ status: 'PENDING', expiresAt }, expiresAt)).toBe('EXPIRED');
    expect(effectiveStatus({ status: 'PENDING', expiresAt }, new Date(expiresAt.getTime() + 1))).toBe('EXPIRED');
  });

  it('does not turn an answered or cancelled invitation into an expired one', () => {
    const expiresAt = new Date(NOW.getTime() - 1000);
    for (const status of ['ACCEPTED', 'DECLINED', 'CANCELLED'] as const) {
      expect(effectiveStatus({ status, expiresAt }, NOW)).toBe(status);
    }
    expect(effectiveStatus({ status: 'EXPIRED', expiresAt }, NOW)).toBe('EXPIRED');
  });
});

describe('the text the invited person receives', () => {
  it('says who invited them, to what and how to answer, in plain characters', () => {
    const text = invitationText({ facilityName: 'Aso Garden Specialist Hospital', roleKey: 'facility_administrator' });
    expect(text).toContain('Aso Garden Specialist Hospital');
    expect(text).toContain('a facility administrator');
    expect(text).toContain('Register or sign in with this number');
    expect(text).toContain(`${INVITATION_VALID_DAYS} days`);
    expect(text.endsWith('Medilink.')).toBe(true);
  });

  it('says an owner for the owner role', () => {
    expect(invitationText({ facilityName: 'Aso Garden', roleKey: 'facility_owner' })).toContain('as an owner');
  });

  it('holds to the rules every text holds to, with a long name', () => {
    const name = 'The Federal Medical Centre and Teaching Hospital of the Niger Delta and Surrounding Communities';
    for (const roleKey of INVITABLE_ROLES) {
      const text = invitationText({ facilityName: name, roleKey });
      expect(smsProblems(text)).toEqual([]);
      expect(smsEncoding(text).encoding).toBe('GSM-7');
      expect(smsEncoding(text).segments).toBeLessThanOrEqual(3);
    }
  });

  it('carries no link, no email and no phone number', () => {
    const text = invitationText({ facilityName: 'Aso Garden', roleKey: 'facility_owner' });
    expect(text).not.toMatch(/https?:|www\.|@|\+234|0[789]\d{9}/i);
  });
});
