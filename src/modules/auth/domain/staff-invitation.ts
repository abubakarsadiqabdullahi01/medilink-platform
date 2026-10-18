import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';

/**
 * Inviting somebody to work for a facility: the rules that need no database (M04-06).
 *
 * A facility owner could give a registered person a role by finding them by phone, and the person
 * was never asked: a practitioner could be made a hospital's administrator without knowing. An
 * invitation is the same grant with the person's answer in the middle, and it works for somebody
 * who has not registered yet, who is told by one text and finds the invitation waiting when they
 * do.
 */

/** How long an invitation can be answered. A week: long enough to register, short enough not to linger. */
export const INVITATION_VALID_DAYS = 7;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The roles a facility can invite somebody to.
 *
 * Named, not derived: a role invited to is a role that arrives with one answer from a stranger's
 * phone, so a role added to the catalogue later is not invitable until somebody says so here.
 * Never a platform role, which no facility gives.
 */
export const INVITABLE_ROLES = ['facility_administrator', 'facility_owner'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(roleKey: string): roleKey is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(roleKey) && roleKey in ROLE_PERMISSIONS;
}

/**
 * What a text may cost the platform and what a stranger's phone may be made to receive.
 *
 * Each invitation is a text to a number the facility typed, and nothing proves the number belongs
 * to anybody who wants it. Three ceilings, because each stops a different thing: one person
 * sending in a burst, one facility sending to a list, and one number being sent to by many
 * facilities, which is how a relay for unwanted texts would be built from a hospital's name.
 */
export const INVITATION_LIMITS = {
  perInviterPerHour: 10,
  perFacilityPerDay: 20,
  perNumberPerDay: 3,
} as const;

export interface InvitationCounts {
  /** Invitations this person has sent in the last hour. */
  inviterLastHour: number;
  /** Invitations this facility has sent in the last day. */
  facilityLastDay: number;
  /** Invitations to this number, from any facility, in the last day. */
  numberLastDay: number;
}

export type LimitBreach = { limit: 'inviter' | 'facility' | 'number'; message: string };

/** The ceiling that is reached, in plain words, or null when one more may go. */
export function limitBreached(counts: InvitationCounts): LimitBreach | null {
  if (counts.inviterLastHour >= INVITATION_LIMITS.perInviterPerHour) {
    return {
      limit: 'inviter',
      message: `You have sent ${INVITATION_LIMITS.perInviterPerHour} invitations in the last hour. Try again later.`,
    };
  }
  if (counts.facilityLastDay >= INVITATION_LIMITS.perFacilityPerDay) {
    return {
      limit: 'facility',
      message: `This facility has sent ${INVITATION_LIMITS.perFacilityPerDay} invitations today. Try again tomorrow, or ask Medilink.`,
    };
  }
  if (counts.numberLastDay >= INVITATION_LIMITS.perNumberPerDay) {
    return {
      limit: 'number',
      message: 'That number has been invited several times today already. Try again tomorrow.',
    };
  }
  return null;
}

export const WINDOWS = { hourMs: HOUR_MS, dayMs: DAY_MS } as const;

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';

export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + INVITATION_VALID_DAYS * DAY_MS);
}

/**
 * What an invitation is now. A pending one past its date is expired whether or not anything has
 * written that down, so nothing depends on a sweep having run: the lists, and the answer a person
 * gets, read the clock.
 */
export function effectiveStatus(
  invitation: { status: InvitationStatus; expiresAt: Date },
  now: Date,
): InvitationStatus {
  if (invitation.status === 'PENDING' && invitation.expiresAt.getTime() <= now.getTime()) {
    return 'EXPIRED';
  }
  return invitation.status;
}

const ROLE_WORDS: Record<InvitableRole, string> = {
  facility_administrator: 'a facility administrator',
  facility_owner: 'an owner',
};

/** The role as it reads in a sentence. */
export function roleWords(roleKey: string): string {
  return isInvitableRole(roleKey) ? ROLE_WORDS[roleKey] : 'staff';
}

/**
 * The text the invited person receives.
 *
 * Fixed words around the facility's name and the role, and nothing a facility can type freely:
 * a message box that sent to any number would be the relay the limits above exist to prevent.
 * No phone number and no link, so nothing in it can be forwarded as a way in; the person answers
 * by signing in with the number it came to, which is what the invitation is bound to.
 */
export function invitationText(input: { facilityName: string; roleKey: string }): string {
  return `${input.facilityName} has invited you to join its team on Medilink as ${roleWords(input.roleKey)}. Register or sign in with this number to answer. It lasts ${INVITATION_VALID_DAYS} days. Medilink.`;
}
