import type { EligibilityBlocker } from './eligibility';

/**
 * Why a practitioner is not being offered shifts, who can put each reason right, and what to do
 * about the ones that are theirs (M02-07). Pure, no database, shared by the server that decides
 * what to send and the screens that say it.
 *
 * The eligibility rule answers "may this person be matched". That is not the whole of "will they
 * be offered a shift": somebody who has turned off being shown to facilities, or who has never said
 * when they can work, is eligible and is never offered anything. An overview that answered "You can
 * be offered shifts" to them was reassuring and wrong, so those two sit beside the blockers here.
 *
 * And a document that has been sent and is waiting for an officer is not "not submitted yet": the
 * rule collapses sent, sent back, refused, expired and never sent into one blocker, and the
 * practitioner needs to know which, and for which document.
 */

/** Reasons that keep an approved practitioner from being offered work. */
export type ExtraReason = 'consent_withdrawn' | 'no_availability';

export type NotOfferedReason = EligibilityBlocker | ExtraReason;

/** Who can clear it. Half of what stands in a practitioner's way is not theirs to fix. */
export type Owner = 'you' | 'medilink';

export interface ReasonGuide {
  owner: Owner;
  says: string;
  /** Where the practitioner clears it. Present exactly when it is theirs. */
  href?: string;
  action?: string;
}

const CREDENTIALS = '/practitioner/profile?tab=credentials';

/**
 * What each reason means. The ones Medilink clears carry no button: identity and professional
 * registration are recorded by a compliance officer, on purpose, since "a practitioner does not
 * verify their own identity, which is the whole point", and a button the practitioner cannot use
 * to change anything would only mislead them.
 */
export const REASON_GUIDE: Record<NotOfferedReason, ReasonGuide> = {
  account_not_usable: {
    owner: 'medilink',
    says: 'This account is not active, which stops everything else. Medilink has to lift that first.',
  },
  profile_incomplete: {
    owner: 'you',
    says: 'Your profile is missing something the matcher needs.',
    href: '/practitioner/profile?tab=profile',
    action: 'Finish your profile',
  },
  identity_unverified: {
    owner: 'medilink',
    says: 'Your NIN has not been recorded yet. A compliance officer does that once they have seen your identity slip.',
  },
  identity_name_mismatch: {
    owner: 'medilink',
    says: 'The name on your NIN does not match the name on this account. Medilink has to settle which is right before you can be matched.',
  },
  registration_missing: {
    owner: 'medilink',
    says: 'Your professional registration is not on record. An officer records it against your licence.',
  },
  registration_not_active: {
    owner: 'medilink',
    says: 'The registration on record is not currently active. If you have renewed your licence, tell Medilink so it can be re-recorded.',
  },
  registration_evidence_stale: {
    owner: 'medilink',
    says: 'Your registration was last confirmed too long ago and is due a re-check by Medilink.',
  },
  credential_missing: {
    owner: 'you',
    says: 'A credential your profession requires has not been submitted yet.',
    href: CREDENTIALS,
    action: 'Submit it',
  },
  credential_expired: {
    owner: 'you',
    says: 'One of your credentials has expired, so it no longer counts.',
    href: CREDENTIALS,
    action: 'Submit the current one',
  },
  screening_not_clear: {
    owner: 'medilink',
    says: 'A screening check is still open. Medilink resolves this one.',
  },
  consent_withdrawn: {
    owner: 'you',
    says: 'You have turned off sharing your profile or documents with facilities, so you are left out when shifts are matched. Nothing else is wrong.',
    href: '/practitioner/privacy',
    action: 'Change it',
  },
  no_availability: {
    owner: 'you',
    says: 'You have not said when you can work, so there is nothing to match a shift against.',
    href: '/practitioner/profile?tab=availability',
    action: 'Say when you can work',
  },
};

/** Where one required document stands. */
export type CredentialState = 'not_submitted' | 'waiting' | 'sent_back' | 'rejected' | 'expired';

export interface CredentialNeed {
  credentialTypeId: string;
  name: string;
  state: CredentialState;
  /** What the officer wrote when they sent it back or refused it; null otherwise. */
  note: string | null;
}

interface SubmissionRow {
  credentialTypeId: string;
  status: string;
  createdAt: Date;
  reviewNotes: string | null;
}

/**
 * The required documents that are still outstanding, and the state of each.
 *
 * A document that has been verified, whatever else was sent before it, is not outstanding: that is
 * the same reading the rule takes, where a renewed licence leaves the old row expired on the
 * record. Otherwise the latest answer decides, so a replacement that is waiting replaces the
 * refusal it follows. Outstanding exactly when the rule reports `credential_missing`; a test holds
 * the two together over every combination.
 */
export function credentialNeeds(input: {
  required: { id: string; name: string }[];
  submissions: SubmissionRow[];
}): CredentialNeed[] {
  const needs: CredentialNeed[] = [];

  for (const type of input.required) {
    const rows = input.submissions.filter((row) => row.credentialTypeId === type.id);
    if (rows.some((row) => row.status === 'VERIFIED')) continue;

    const latest = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const base = { credentialTypeId: type.id, name: type.name };

    if (!latest) {
      needs.push({ ...base, state: 'not_submitted', note: null });
    } else if (latest.status === 'MORE_INFO_REQUESTED') {
      needs.push({ ...base, state: 'sent_back', note: latest.reviewNotes });
    } else if (latest.status === 'REJECTED') {
      needs.push({ ...base, state: 'rejected', note: latest.reviewNotes });
    } else if (latest.status === 'EXPIRED') {
      needs.push({ ...base, state: 'expired', note: null });
    } else {
      // Sent and not yet decided.
      needs.push({ ...base, state: 'waiting', note: null });
    }
  }

  return needs;
}

/** What the server sends. `credentials` and `alsoStopsOffers` are absent from an older response. */
export interface NotOfferedView {
  eligible: boolean;
  blockers: string[];
  credentials?: CredentialNeed[];
  alsoStopsOffers?: string[];
}

export interface ReasonLine {
  code: string;
  owner: Owner;
  text: string;
  href?: string;
  action?: string;
}

/** An unknown code in words, rather than dropped or shown with its underscores. */
function wordsOf(code: string): string {
  const spaced = code.replace(/_/g, ' ').trim();
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}.`;
}

const CREDENTIAL_BLOCKERS = ['credential_missing', 'credential_expired'];

function credentialLine(need: CredentialNeed): ReasonLine {
  const code = need.state === 'expired' ? 'credential_expired' : 'credential_missing';
  const noted = need.note ? ` They wrote: “${need.note}”` : '';

  switch (need.state) {
    case 'not_submitted':
      return {
        code,
        owner: 'you',
        text: `${need.name}: not submitted yet.`,
        href: CREDENTIALS,
        action: 'Submit it',
      };
    case 'waiting':
      return {
        code,
        owner: 'medilink',
        text: `${need.name}: sent, and waiting for a Medilink officer to review it. There is nothing for you to do.`,
      };
    case 'sent_back':
      return {
        code,
        owner: 'you',
        text: `${need.name}: Medilink needs something more before it can decide.${noted}`,
        href: CREDENTIALS,
        action: 'Send what they asked for',
      };
    case 'rejected':
      return {
        code,
        owner: 'you',
        text: `${need.name}: not accepted.${noted}`,
        href: CREDENTIALS,
        action: 'Send a new one',
      };
    case 'expired':
      return {
        code,
        owner: 'you',
        text: `${need.name}: has expired, so it no longer counts.`,
        href: CREDENTIALS,
        action: 'Submit the current one',
      };
  }
}

/**
 * Every reason, once each, in the order they come: the rule's blockers, then what else stops
 * offers. The general sentence about documents gives way to a line for each document, which says
 * which one and where it stands; when the detail did not arrive the general sentence stays.
 */
export function reasonLines(view: NotOfferedView): ReasonLine[] {
  const lines: ReasonLine[] = [];
  const specific = (view.credentials ?? []).map(credentialLine);
  let credentialsWritten = false;

  for (const code of view.blockers) {
    if (CREDENTIAL_BLOCKERS.includes(code) && specific.length > 0) {
      if (!credentialsWritten) {
        lines.push(...specific);
        credentialsWritten = true;
      }
      continue;
    }
    const guide = REASON_GUIDE[code as NotOfferedReason];
    if (!guide) {
      lines.push({ code, owner: 'medilink', text: wordsOf(code) });
      continue;
    }
    lines.push({ code, owner: guide.owner, text: guide.says, href: guide.href, action: guide.action });
  }

  for (const code of view.alsoStopsOffers ?? []) {
    const guide = REASON_GUIDE[code as NotOfferedReason];
    if (!guide) {
      lines.push({ code, owner: 'medilink', text: wordsOf(code) });
      continue;
    }
    lines.push({ code, owner: guide.owner, text: guide.says, href: guide.href, action: guide.action });
  }

  return lines;
}

/**
 * What to tell the practitioner first. "Offered" is said only when nothing at all stands in the
 * way; an approved account that will still not be offered work is its own answer.
 */
export function headline(view: NotOfferedView): 'offered' | 'approved_but_not_offered' | 'not_eligible' {
  if (!view.eligible) return 'not_eligible';
  return (view.alsoStopsOffers ?? []).length > 0 ? 'approved_but_not_offered' : 'offered';
}
